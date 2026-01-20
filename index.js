'use strict';

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const Stripe = require('stripe');
const { Firestore } = require('@google-cloud/firestore');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { aifesPageHTML } = require('./aifes_page');

// Discord招待リンクの既定値
const DEFAULT_DISCORD_INVITE_URL = 'https://discord.gg/22Ah4EypVK';

// ------- 環境変数の取得と整形 -------
const CFG = {
  STRIPE_MODE: process.env.STRIPE_MODE || 'test', // 'test' | 'live'

  STRIPE_SECRET_KEY_TEST: process.env.STRIPE_SECRET_KEY_TEST || '',
  STRIPE_WEBHOOK_SECRET_TEST: process.env.STRIPE_WEBHOOK_SECRET_TEST || '',
  STRIPE_PRICE_ID_MONTHLY_TEST: process.env.STRIPE_PRICE_ID_MONTHLY_TEST || '',
  STRIPE_PRICE_ID_YEARLY_TEST: process.env.STRIPE_PRICE_ID_YEARLY_TEST || '',
  STRIPE_PRICE_ID_STUDENT_TEST: process.env.STRIPE_PRICE_ID_STUDENT_TEST || '',
  STRIPE_ADDITIONAL_PRICE_IDS_TEST: process.env.STRIPE_ADDITIONAL_PRICE_IDS_TEST || '',

  STRIPE_SECRET_KEY_LIVE: process.env.STRIPE_SECRET_KEY_LIVE || '',
  STRIPE_WEBHOOK_SECRET_LIVE: process.env.STRIPE_WEBHOOK_SECRET_LIVE || '',
  STRIPE_PRICE_ID_MONTHLY_LIVE: process.env.STRIPE_PRICE_ID_MONTHLY_LIVE || '',
  STRIPE_PRICE_ID_YEARLY_LIVE: process.env.STRIPE_PRICE_ID_YEARLY_LIVE || '',
  STRIPE_PRICE_ID_STUDENT_LIVE: process.env.STRIPE_PRICE_ID_STUDENT_LIVE || '',
  STRIPE_ADDITIONAL_PRICE_IDS_LIVE: process.env.STRIPE_ADDITIONAL_PRICE_IDS_LIVE || '',

  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || '',
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || '',
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID || '',
  DISCORD_PRO_ROLE_ID: process.env.DISCORD_PRO_ROLE_ID || '',
  DISCORD_GUILD_INVITE_URL: process.env.DISCORD_GUILD_INVITE_URL || DEFAULT_DISCORD_INVITE_URL,

  OAUTH_STATE_SECRET: process.env.OAUTH_STATE_SECRET || '',
  SCHEDULER_TOKEN: process.env.SCHEDULER_TOKEN || '',

  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || ''
};

function assertEnv() {
  const required = [
    'STRIPE_MODE',
    'DISCORD_CLIENT_ID','DISCORD_CLIENT_SECRET','DISCORD_BOT_TOKEN',
    'DISCORD_GUILD_ID','DISCORD_PRO_ROLE_ID','DISCORD_GUILD_INVITE_URL',
    'OAUTH_STATE_SECRET','SCHEDULER_TOKEN'
  ];
  required.forEach(k => {
    if (!CFG[k]) {
      console.warn(`Missing ENV: ${k}`);
    }
  });
}
assertEnv();
console.log('[config] Discord Guild Invite URL:', CFG.DISCORD_GUILD_INVITE_URL);

// デバッグ: Discord Client Secretの確認
console.log('[debug] Discord Client Secret loaded:', CFG.DISCORD_CLIENT_SECRET ? `${CFG.DISCORD_CLIENT_SECRET.substring(0, 4)}...` : 'MISSING');

function modePick(testVal, liveVal) {
  return CFG.STRIPE_MODE === 'live' ? liveVal : testVal;
}

function parsePriceList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

const STRIPE_SECRET_KEY = modePick(CFG.STRIPE_SECRET_KEY_TEST, CFG.STRIPE_SECRET_KEY_LIVE);
const STRIPE_WEBHOOK_SECRET = modePick(CFG.STRIPE_WEBHOOK_SECRET_TEST, CFG.STRIPE_WEBHOOK_SECRET_LIVE);
const PRICE_IDS = {
  monthly: modePick(CFG.STRIPE_PRICE_ID_MONTHLY_TEST, CFG.STRIPE_PRICE_ID_MONTHLY_LIVE),
  yearly: modePick(CFG.STRIPE_PRICE_ID_YEARLY_TEST, CFG.STRIPE_PRICE_ID_YEARLY_LIVE),
  student: modePick(CFG.STRIPE_PRICE_ID_STUDENT_TEST, CFG.STRIPE_PRICE_ID_STUDENT_LIVE),
  extra: modePick(
    parsePriceList(CFG.STRIPE_ADDITIONAL_PRICE_IDS_TEST),
    parsePriceList(CFG.STRIPE_ADDITIONAL_PRICE_IDS_LIVE)
  )
};

const ENTITLED_PRICE_IDS = new Set([
  PRICE_IDS.monthly,
  PRICE_IDS.yearly,
  PRICE_IDS.student,
  ...PRICE_IDS.extra
].filter(Boolean));

if (ENTITLED_PRICE_IDS.size === 0) {
  console.warn('[stripe] No entitled Price IDs configured.');
} else {
  console.log('[stripe] Entitled Price IDs:', Array.from(ENTITLED_PRICE_IDS));
}

// Stripeクライアント
const stripe = new Stripe(STRIPE_SECRET_KEY);

// Firestoreクライアント（ADC/ServiceAccount）
let firestore;
try {
  firestore = new Firestore({ projectId: CFG.GCP_PROJECT_ID });
  console.log('[firestore] Initialized successfully');
} catch (err) {
  console.error('[firestore] Initialization failed:', err);
  firestore = null;
}

// Discordクライアント（最小Intent: Guilds + GuildMembers）
const discord = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember]
});

let discordReady = false;
discord.once('ready', () => {
  console.log(`[discord] Logged in as ${discord.user.tag}`);
  discordReady = true;
});

if (CFG.DISCORD_BOT_TOKEN && CFG.DISCORD_BOT_TOKEN !== 'placeholder') {
  discord.login(CFG.DISCORD_BOT_TOKEN).catch(err => {
    console.error('Discord login failed:', err);
    // Don't exit in production, just log the error
    console.warn('Continuing without Discord bot...');
  });
} else {
  console.warn('Discord bot token not configured, skipping login');
}

// ------- Express 構成 -------
const app = express();
const PORT = process.env.PORT || 8080;

// Stripe Webhookは raw body が必要
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // code = session.id を success_url で渡す設計
        await saveLinkCode(session.id, session.customer);
        console.log(`[webhook] saved link code for session ${session.id}, customer ${session.customer}`);

        // 会社名が入力されていたら顧客名を更新（領収書用）
        if (session.custom_fields && session.custom_fields.length > 0) {
          const companyField = session.custom_fields.find(f => f.key === 'company_name');
          if (companyField && companyField.text && companyField.text.value) {
            await stripe.customers.update(session.customer, {
              name: companyField.text.value
            });
            console.log(`[webhook] updated customer name to: ${companyField.text.value}`);
          }
        }
        break;
      }
      case 'customer.subscription.created': {
        const sub = event.data.object;
        await handleSubChange(sub);
        await maybeMarkTrialUsed(sub);
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await handleSubChange(sub);
        await maybeMarkTrialUsed(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await handleSubChange(sub);
        break;
      }
      default:
        // 他イベントは無視でOK
        break;
    }
    return res.json({ received: true });
  } catch (err) {
    console.error('[webhook] handler error:', err);
    return res.status(500).send('webhook handler error');
  }
});

// 一般JSONは通常のparser
app.use(express.json());

// 静的ファイル配信（ロゴ等）
const path = require('path');
app.use('/public', express.static(path.join(__dirname, 'public')));

// ---- ヘルス & ルート ----
app.get('/healthz', (_req, res) => res.send('ok'));

app.get('/', (_req, res) => {
  const html = `
<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Discord Pro メンバーシップ</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif;
    background: #f8f9fa;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #333;
  }
  .container {
    max-width: 500px;
    text-align: center;
    padding: 48px 24px;
    background: white;
    border-radius: 8px;
    border: 1px solid #e9ecef;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  }
  h1 { font-size: 2.2rem; margin-bottom: 16px; font-weight: 600; }
  .subtitle { font-size: 1.1rem; color: #666; margin-bottom: 32px; }
  .features { text-align: left; margin-bottom: 32px; }
  .feature { display: flex; align-items: center; margin-bottom: 12px; font-size: 1rem; }
  .feature::before { content: "•"; margin-right: 12px; color: #666; font-weight: bold; }
  .btn {
    display: inline-block;
    padding: 14px 28px;
    background: #fff;
    color: #333;
    text-decoration: none;
    border-radius: 4px;
    font-size: 1rem;
    font-weight: 500;
    margin: 8px;
    border: 2px solid #333;
    transition: all 0.2s ease;
  }
  .btn:hover {
    background: #333;
    color: #fff;
  }
  .btn.primary {
    background: #333;
    color: #fff;
  }
  .btn.primary:hover {
    background: #000;
  }
  .cancel-section {
    margin-top: 48px;
    padding-top: 32px;
    border-top: 1px solid #e9ecef;
  }
  .cancel-section h3 {
    font-size: 1.1rem;
    margin-bottom: 16px;
    color: #666;
  }
  .mode-badge {
    position: absolute;
    top: 20px;
    right: 20px;
    padding: 6px 12px;
    background: ${CFG.STRIPE_MODE === 'live' ? '#000' : '#666'};
    color: white;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 500;
  }
</style>
<div class="mode-badge">${CFG.STRIPE_MODE === 'live' ? 'LIVE' : 'TEST'}</div>
<div class="container">
  <h1>Discord Pro</h1>
  <p class="subtitle">プレミアムメンバーシップ</p>

  <div class="features">
    <div class="feature">Pro限定チャンネルアクセス</div>
    <div class="feature">専用サポート</div>
    <div class="feature">月額 ¥5,000</div>
    <div class="feature" style="color: #28a745; font-weight: 600;">学生は月額 ¥2,000（.ac.jp / .edu / .ed.jp）</div>
    <div class="feature">いつでも解約可能</div>
  </div>

  <form id="checkout-form" style="margin-bottom: 16px;">
    <div style="margin-bottom: 16px;">
      <label for="email-input" style="display: block; margin-bottom: 8px; font-weight: 500;">メールアドレス</label>
      <input
        type="email"
        id="email-input"
        placeholder="your@example.com"
        required
        style="width: 100%; padding: 12px 16px; border-radius: 4px; border: 1px solid #e9ecef; font-size: 1rem;"
      >
    </div>
    <button type="submit" class="btn primary" id="checkout-btn">
      今すぐ参加
    </button>
    <div id="error-message" style="color: #dc3545; margin-top: 16px; display: none;"></div>
    <div id="warning-message" style="color: #ff9800; margin-top: 16px; display: none;"></div>
  </form>

  <script>
    document.getElementById('checkout-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const btn = document.getElementById('checkout-btn');
      const email = document.getElementById('email-input').value;
      const errorDiv = document.getElementById('error-message');
      const warningDiv = document.getElementById('warning-message');

      // リセット
      errorDiv.style.display = 'none';
      warningDiv.style.display = 'none';
      btn.disabled = true;
      btn.textContent = '処理中...';

      try {
        const response = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (!response.ok) {
          errorDiv.textContent = data.message || 'エラーが発生しました';
          errorDiv.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '今すぐ参加';
          return;
        }

        if (data.warnings && data.warnings.length > 0) {
          warningDiv.textContent = data.warnings.join('\\n');
          warningDiv.style.display = 'block';
        }

        // Stripe Checkoutページへリダイレクト
        window.location.href = data.url;

      } catch (error) {
        errorDiv.textContent = 'ネットワークエラーが発生しました';
        errorDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '今すぐ参加';
      }
    });
  </script>

  <div class="cancel-section">
    <h3>既存メンバー</h3>
    <p style="margin-bottom: 16px; color: #666;">管理・解約はこちら</p>
    <a class="btn" href="/portal-lookup">請求管理</a>
  </div>
</div>
  `;
  res.type('html').send(html);
});

// 解約・請求管理へのアクセスページ
app.get('/portal-lookup', (req, res) => {
  const html = `
<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>サブスクリプション管理</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif;
    background: #f8f9fa;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #333;
  }
  .container {
    max-width: 500px;
    text-align: center;
    padding: 48px 24px;
    background: white;
    border-radius: 8px;
    border: 1px solid #e9ecef;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  }
  h1 { font-size: 2rem; margin-bottom: 16px; font-weight: 600; }
  .subtitle { font-size: 1rem; color: #666; margin-bottom: 32px; line-height: 1.6; }
  .input-group { margin-bottom: 24px; text-align: left; }
  .input-group label { display: block; margin-bottom: 8px; font-weight: 500; }
  .input-group input {
    width: 100%;
    padding: 12px 16px;
    border-radius: 4px;
    border: 1px solid #e9ecef;
    background: white;
    color: #333;
    font-size: 1rem;
  }
  .input-group input::placeholder { color: #999; }
  .btn {
    display: inline-block;
    padding: 14px 28px;
    background: #fff;
    color: #333;
    text-decoration: none;
    border-radius: 4px;
    font-size: 1rem;
    font-weight: 500;
    margin: 8px;
    border: 2px solid #333;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .btn:hover {
    background: #333;
    color: #fff;
  }
  .btn.primary {
    background: #333;
    color: #fff;
  }
  .btn.primary:hover {
    background: #000;
  }
  .note {
    margin-top: 24px;
    padding: 16px;
    background: #f8f9fa;
    border-radius: 4px;
    font-size: 0.9rem;
    color: #666;
    text-align: left;
  }
</style>
<div class="container">
  <h1>サブスクリプション管理</h1>
  <p class="subtitle">請求情報の確認・解約手続きを行うには、登録時のメールアドレスを入力してください。</p>

  <form action="/portal" method="GET">
    <div class="input-group">
      <label for="email">メールアドレス</label>
      <input type="email" id="email" name="email" placeholder="your@example.com" required>
    </div>
    <button type="submit" class="btn primary">請求管理画面を開く</button>
  </form>

  <div class="note">
    <strong>注意事項</strong><br>
    • 請求管理画面では解約・プラン変更・請求履歴の確認ができます<br>
    • 解約後もサブスク期間終了まではProロールが維持されます<br>
    • 解約時にDiscordからロールが自動で削除されます
  </div>

  <a href="/" class="btn">戻る</a>
</div>
  `;
  res.type('html').send(html);
});

// Stripe 顧客ポータル（メールアドレスベース）
app.get('/portal', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).send('Email required');

  try {
    // メールアドレスで顧客を検索
    const customers = await stripe.customers.list({
      email: email,
      limit: 1
    });

    if (customers.data.length === 0) {
      const html = `
<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>顧客が見つかりません</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif;
    background: #f8f9fa;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #333;
  }
  .container {
    max-width: 500px;
    text-align: center;
    padding: 48px 24px;
    background: white;
    border-radius: 8px;
    border: 1px solid #e9ecef;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  }
  h1 { font-size: 1.8rem; margin-bottom: 16px; font-weight: 600; }
  p { font-size: 1rem; color: #666; margin-bottom: 24px; }
  .btn {
    display: inline-block;
    padding: 14px 28px;
    background: #fff;
    color: #333;
    text-decoration: none;
    border-radius: 4px;
    font-size: 1rem;
    font-weight: 500;
    border: 2px solid #333;
    transition: all 0.2s ease;
  }
  .btn:hover {
    background: #333;
    color: #fff;
  }
</style>
<div class="container">
  <h1>顧客が見つかりません</h1>
  <p>入力されたメールアドレス（${email}）に関連するサブスクリプションが見つかりませんでした。</p>
  <p>メールアドレスを確認して再度お試しください。</p>
  <a href="/portal-lookup" class="btn">戻る</a>
</div>
      `;
      return res.type('html').send(html);
    }

    const customer = customers.data[0];
    const base = getBaseUrl(req);

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: base,
    });

    // Stripe APIから請求履歴を取得
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      limit: 10
    });

    const invoices = await stripe.invoices.list({
      customer: customer.id,
      limit: 10
    });

    // 現在のサブスクリプション情報
    const currentSub = subscriptions.data.find(sub => sub.status === 'active');

    const html = `
<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>サブスクリプション情報</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif;
    background: #f8f9fa;
    min-height: 100vh;
    padding: 24px;
    color: #333;
  }
  .container {
    max-width: 800px;
    margin: 0 auto;
    background: white;
    border-radius: 8px;
    border: 1px solid #e9ecef;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  }
  .header {
    padding: 32px;
    border-bottom: 1px solid #e9ecef;
  }
  .content {
    padding: 32px;
  }
  h1 { font-size: 1.8rem; margin-bottom: 8px; font-weight: 600; }
  .subtitle { font-size: 1rem; color: #666; margin-bottom: 24px; }
  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 24px;
    margin-bottom: 32px;
  }
  .info-card {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 8px;
    border: 1px solid #e9ecef;
  }
  .info-card h3 {
    font-size: 1rem;
    margin-bottom: 12px;
    color: #333;
    font-weight: 600;
  }
  .info-card p {
    font-size: 0.9rem;
    color: #666;
    margin-bottom: 8px;
  }
  .status-active { color: #28a745; font-weight: 600; }
  .status-inactive { color: #dc3545; }
  .table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 24px;
  }
  .table th, .table td {
    padding: 12px;
    text-align: left;
    border-bottom: 1px solid #e9ecef;
  }
  .table th {
    background: #f8f9fa;
    font-weight: 600;
    font-size: 0.9rem;
  }
  .table td {
    font-size: 0.9rem;
  }
  .btn {
    display: inline-block;
    padding: 12px 24px;
    background: #fff;
    color: #333;
    text-decoration: none;
    border-radius: 4px;
    font-size: 0.9rem;
    font-weight: 500;
    border: 2px solid #333;
    transition: all 0.2s ease;
    margin-right: 12px;
  }
  .btn:hover {
    background: #333;
    color: #fff;
  }
  .section {
    margin-bottom: 32px;
  }
  .section h2 {
    font-size: 1.3rem;
    margin-bottom: 16px;
    font-weight: 600;
  }
</style>
<div class="container">
  <div class="header">
    <h1>サブスクリプション情報</h1>
    <p class="subtitle">${email}</p>
  </div>

  <div class="content">
    <div class="section">
      <h2>現在のプラン</h2>
      <div class="info-grid">
        ${currentSub ? `
        <div class="info-card">
          <h3>プラン詳細</h3>
          <p>プラン: Discord Pro 月額</p>
          <p>金額: ¥${(currentSub.items.data[0]?.price?.unit_amount || 0).toLocaleString()}/月</p>
          <p>ステータス: <span class="status-active">有効</span></p>
        </div>
        <div class="info-card">
          <h3>次回請求</h3>
          <p>日付: ${new Date(currentSub.current_period_end * 1000).toLocaleDateString('ja-JP')}</p>
          <p>開始日: ${new Date(currentSub.current_period_start * 1000).toLocaleDateString('ja-JP')}</p>
        </div>
        ` : `
        <div class="info-card">
          <h3>プラン詳細</h3>
          <p class="status-inactive">アクティブなサブスクリプションがありません</p>
        </div>
        `}
      </div>
    </div>

    <div class="section">
      <h2>請求履歴</h2>
      <table class="table">
        <thead>
          <tr>
            <th>日付</th>
            <th>金額</th>
            <th>ステータス</th>
            <th>期間</th>
          </tr>
        </thead>
        <tbody>
          ${invoices.data.map(invoice => `
          <tr>
            <td>${new Date(invoice.created * 1000).toLocaleDateString('ja-JP')}</td>
            <td>¥${(invoice.amount_paid / 100).toLocaleString()}</td>
            <td>${invoice.status === 'paid' ? '支払済み' : invoice.status}</td>
            <td>${invoice.period_start ? new Date(invoice.period_start * 1000).toLocaleDateString('ja-JP') + ' - ' + new Date(invoice.period_end * 1000).toLocaleDateString('ja-JP') : '-'}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div style="border-top: 1px solid #e9ecef; padding-top: 24px;">
      <p style="color: #666; font-size: 0.9rem; margin-bottom: 16px;">
        解約や変更をご希望の場合は、直接お問い合わせください。
      </p>
      <a href="mailto:s.sakuramoto@archi-prisma.co.jp?subject=Discord Pro 解約手続き&body=【Discord Pro 解約希望】%0A%0A■ 登録情報%0A・メールアドレス：${email}%0A・Discord ユーザー名：%0A・Discord ID（数字）：%0A%0A■ 解約希望日%0A・いつから解約したいですか：%0A%0A■ 解約理由（任意）%0A・理由があれば教えてください：%0A%0A■ その他%0A・ご質問やご要望があれば：%0A%0A※このメールに返信いただければ解約手続きを開始いたします。" class="btn">解約手続きのお問い合わせ</a>
      <a href="/" class="btn">ホームに戻る</a>
    </div>
  </div>
</div>
    `;
    res.type('html').send(html);
  } catch (error) {
    console.error('[portal] error:', error);
    const html = `
<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>エラー</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif;
    background: #f8f9fa;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #333;
  }
  .container {
    max-width: 500px;
    text-align: center;
    padding: 48px 24px;
    background: white;
    border-radius: 8px;
    border: 1px solid #e9ecef;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  }
  h1 { font-size: 1.8rem; margin-bottom: 16px; font-weight: 600; color: #dc3545; }
  p { font-size: 1rem; color: #666; margin-bottom: 24px; }
  .btn {
    display: inline-block;
    padding: 14px 28px;
    background: #fff;
    color: #333;
    text-decoration: none;
    border-radius: 4px;
    font-size: 1rem;
    font-weight: 500;
    border: 2px solid #333;
    transition: all 0.2s ease;
  }
  .btn:hover {
    background: #333;
    color: #fff;
  }
</style>
<div class="container">
  <h1>エラーが発生しました</h1>
  <p>請求管理ページへのアクセス中にエラーが発生しました。時間をおいて再度お試しください。</p>
  <a href="/portal-lookup" class="btn">戻る</a>
</div>
    `;
    res.status(500).type('html').send(html);
  }
});

// Checkout Session作成API（二重契約・トライアル再利用防止付き）
app.post('/api/create-checkout-session', async (req, res) => {
  const { email, priceId, mode } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  // 学生ドメインチェック
  const isStudent = isStudentEmail(email);

  // priceIdのデフォルトは学生ドメインなら学生プラン、そうでなければ月額プラン
  const selectedPriceId = priceId || (isStudent ? PRICE_IDS.student : PRICE_IDS.monthly);
  const checkoutMode = mode || 'subscription';

  if (isStudent) {
    console.log(`[checkout] Student email detected: ${email}, using student price`);
  }

  try {
    // 1. 既存のCustomerを検索
    const existingCustomers = await stripe.customers.list({
      email: email,
      limit: 1
    });

    let customer = existingCustomers.data[0];
    let warnings = [];

    if (customer) {
      console.log(`[checkout] Found existing customer: ${customer.id}`);

      // 2. 二重契約チェック: アクティブなサブスクリプションがあるか
      const existingSubs = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'active',
        limit: 10
      });

      // 対象のPriceが含まれているアクティブなサブスクリプションがあるか
      const hasActiveSub = existingSubs.data.some(sub => {
        return sub.items.data.some(item => ENTITLED_PRICE_IDS.has(item.price.id));
      });

      if (hasActiveSub) {
        return res.status(400).json({
          error: 'duplicate_subscription',
          message: '既にアクティブなサブスクリプションが存在します。複数のサブスクリプションを契約することはできません。'
        });
      }

      // 3. トライアル再利用チェック（クーポン利用時のため保持）
      if (hasCustomerUsedTrial(customer)) {
        warnings.push('このメールアドレスは既に無料トライアルを利用しています。クーポンを使用した場合も通常価格での契約となります。');
        console.log(`[checkout] Customer ${customer.id} has already used trial`);
      }
    } else {
      console.log(`[checkout] Creating new customer for email: ${email}`);
    }

    // 4. Checkout Session作成
    const base = getBaseUrl(req);
    const sessionParams = {
      mode: checkoutMode,
      customer: customer ? customer.id : undefined,
      customer_email: customer ? undefined : email,
      line_items: [
        {
          price: selectedPriceId,
          quantity: 1
        }
      ],
      billing_address_collection: 'required',
      custom_fields: [
        {
          key: 'company_name',
          label: {
            type: 'custom',
            custom: '会社名（入力すると領収書の宛名になります）'
          },
          type: 'text',
          optional: true
        }
      ],
      success_url: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?canceled=true`,
      metadata: {
        source: 'api_checkout'
      }
    };

    // トライアル設定: デフォルトではトライアルなし（クーポンで対応）
    if (checkoutMode === 'subscription') {
      sessionParams.subscription_data = {
        trial_period_days: 0
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.json({
      url: session.url,
      sessionId: session.id,
      warnings: warnings.length > 0 ? warnings : undefined
    });

  } catch (error) {
    console.error('[checkout] Error creating session:', error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Checkout Sessionの作成中にエラーが発生しました。'
    });
  }
});

// サンクスページ（「連携」ボタンあり）
app.get('/success', async (req, res) => {
  const code = req.query.session_id || req.query.code;
  if (!code) return res.status(400).send('session_id or code is required');
  const base = getBaseUrl(req);
  const linkUrl = `${base}/oauth/discord/start?code=${encodeURIComponent(code)}`;
  const portalUrl = `${base}/portal?code=${encodeURIComponent(code)}`;
  const invite = CFG.DISCORD_GUILD_INVITE_URL;
  const html = `
<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>決済完了 | Discord Pro</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif;
    background: #f8f9fa;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #333;
  }
  .container {
    max-width: 600px;
    text-align: center;
    padding: 48px 24px;
    background: white;
    border-radius: 8px;
    border: 1px solid #e9ecef;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  }
  h1 { font-size: 2.2rem; margin-bottom: 16px; font-weight: 600; }
  .subtitle { font-size: 1.1rem; color: #666; margin-bottom: 32px; }
  .steps {
    background: #f8f9fa;
    border-radius: 8px;
    padding: 32px;
    margin-bottom: 32px;
    text-align: left;
  }
  .steps h2 { font-size: 1.3rem; margin-bottom: 20px; text-align: center; }
  .step {
    display: flex;
    align-items: center;
    margin-bottom: 16px;
    padding: 16px;
    background: white;
    border-radius: 4px;
    border: 1px solid #e9ecef;
    font-size: 1rem;
  }
  .step-number {
    background: #333;
    color: white;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    margin-right: 16px;
    flex-shrink: 0;
    font-size: 0.9rem;
  }
  .btn {
    display: inline-block;
    padding: 14px 28px;
    background: #fff;
    color: #333;
    text-decoration: none;
    border-radius: 4px;
    font-size: 1rem;
    font-weight: 500;
    margin: 8px;
    border: 2px solid #333;
    transition: all 0.2s ease;
  }
  .btn:hover {
    background: #333;
    color: #fff;
  }
  .btn.primary {
    background: #333;
    color: #fff;
  }
  .btn.primary:hover {
    background: #000;
  }
  .actions { margin-bottom: 32px; }
  .manage-section {
    padding-top: 32px;
    border-top: 1px solid #e9ecef;
  }
  .note {
    background: #f8f9fa;
    border-radius: 4px;
    padding: 20px;
    margin-top: 24px;
    font-size: 0.9rem;
    color: #666;
    text-align: left;
  }
</style>
<div class="container">
  <h1>決済完了</h1>
  <p class="subtitle">Discord Pro メンバーシップが有効になりました</p>

  <div class="steps">
    <h2>次の手順</h2>
    <div class="step">
      <div class="step-number">1</div>
      <div>Discordサーバーに参加（未参加の方のみ）</div>
    </div>
    <div class="step">
      <div class="step-number">2</div>
      <div>アカウント連携でProロールを取得</div>
    </div>
  </div>

  <div class="actions">
    <a class="btn primary" href="${invite}" target="_blank" rel="noopener">
      Discordサーバーに参加
    </a>
    <a class="btn" href="${linkUrl}">
      アカウント連携
    </a>
  </div>

  <div class="manage-section">
    <h3 style="margin-bottom: 16px; color: #666;">サブスクリプション管理</h3>
    <a class="btn" href="mailto:s.sakuramoto@archi-prisma.co.jp?subject=Discord Pro 解約手続き&body=【Discord Pro 解約希望】%0A%0A■ 登録情報%0A・メールアドレス：%0A・Discord ユーザー名：%0A・Discord ID（数字）：%0A%0A■ 解約希望日%0A・いつから解約したいですか：%0A%0A■ 解約理由（任意）%0A・理由があれば教えてください：%0A%0A■ その他%0A・ご質問やご要望があれば：%0A%0A※このメールに返信いただければ解約手続きを開始いたします。">解約手続きのお問い合わせ</a>
  </div>

  <div class="note">
    <strong>注意事項</strong><br>
    • Discord認可画面で「アカウントにアクセス（ユーザー名）」と表示されます<br>
    • 連携完了後、サーバーで「@pro」ロールが自動付与されます<br>
    • 解約後もサブスク期間終了まではProロールが維持されます
  </div>
</div>
  `;
  res.type('html').send(html);
});

// Stripe 顧客ポータル（解約など）
app.get('/portal', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('code required');
  try {
    const session = await stripe.checkout.sessions.retrieve(String(code));
    const customer = session.customer;
    if (!customer) return res.status(400).send('customer not found for this code');
    const base = getBaseUrl(req);
    const portal = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${base}/success?code=${encodeURIComponent(String(code))}`
    });
    res.redirect(portal.url);
  } catch (e) {
    console.error('[portal] error:', e);
    res.status(500).send('failed to create portal session');
  }
});

// Discord OAuth start（identifyのみ）
app.get('/oauth/discord/start', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    console.error('[oauth] No code provided in request');
    return res.status(400).send('code (CHECKOUT_SESSION_ID) required');
  }

  const base = getBaseUrl(req);
  const redirect = `${base}/oauth/discord/callback`;
  const state = makeState(String(code));

  // 詳細なデバッグ情報
  console.log('=== DISCORD OAUTH START ===');
  console.log('[oauth] Request headers:', req.headers);
  console.log('[oauth] Base URL:', base);
  console.log('[oauth] Client ID:', CFG.DISCORD_CLIENT_ID);
  console.log('[oauth] Redirect URI:', redirect);
  console.log('[oauth] State:', state);
  console.log('[oauth] Session code:', code);

  try {
    const url = new URL('https://discord.com/api/oauth2/authorize');
    url.searchParams.set('client_id', CFG.DISCORD_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('state', state);

    console.log('[oauth] Full Discord OAuth URL:', url.toString());
    console.log('=== REDIRECTING TO DISCORD ===');

    res.redirect(url.toString());
  } catch (error) {
    console.error('[oauth] Error building Discord URL:', error);
    res.status(500).send('Internal server error building OAuth URL');
  }
});

// Discord OAuth callback
app.get('/oauth/discord/callback', async (req, res) => {
  console.log('=== DISCORD OAUTH CALLBACK ===');
  console.log('[oauth] Full query params:', req.query);
  console.log('[oauth] Request URL:', req.url);

  const { code, state, error, error_description } = req.query;

  // Discord側でエラーが発生した場合
  if (error) {
    console.error('[oauth] Discord OAuth error:', { error, error_description });
    const errorMsg = `Discord OAuth Error: ${error}${error_description ? ` - ${error_description}` : ''}`;
    return res.status(400).send(errorMsg);
  }

  if (!code || !state) {
    console.error('[oauth] Missing parameters:', {
      code: !!code,
      state: !!state,
      received_params: Object.keys(req.query)
    });
    return res.status(400).send('Missing required parameters (code or state)');
  }

  let sessionId;
  try {
    sessionId = parseState(String(state));
    console.log('[oauth] Successfully parsed session ID:', sessionId);
  } catch (e) {
    console.error('[oauth] State parsing failed:', {
      state: state,
      error: e.message,
      stack: e.stack
    });
    return res.status(400).send('Invalid state parameter');
  }

  const base = getBaseUrl(req);
  const redirect = `${base}/oauth/discord/callback`;

  try {
    // デバッグ: 送信パラメータをログ出力
    const tokenParams = {
      client_id: CFG.DISCORD_CLIENT_ID,
      client_secret: CFG.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: redirect
    };
    console.log('[oauth] Token exchange parameters:', {
      client_id: tokenParams.client_id,
      client_secret: tokenParams.client_secret ? `${tokenParams.client_secret.substring(0, 4)}...` : 'MISSING',
      grant_type: tokenParams.grant_type,
      code: tokenParams.code ? `${tokenParams.code.substring(0, 8)}...` : 'MISSING',
      redirect_uri: tokenParams.redirect_uri
    });

    // トークン交換
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(tokenParams)
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      throw new Error(`${tokenRes.status} ${t}`);
    }
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // ユーザー取得（identify）
    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const me = await meRes.json();
    const discordUserId = me.id;
    if (!discordUserId) throw new Error('discord user id missing');

    // CHECKOUT_SESSION_ID -> customer
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const customerId = session.customer;
    if (!customerId) throw new Error('customer not found for session');

    // Firestore: linkCodes 保存（存在しない場合も保険）
    await saveLinkCode(sessionId, customerId);

    // Firestore: users/{discordUserId}
    await firestore.collection('users').doc(discordUserId).set({
      customerId,
      linkedAt: Date.now(),
      updatedAt: Date.now(),
      lastSyncAt: 0
    }, { merge: true });

    // Stripeの購読状態でロール同期
    const entitled = await isCustomerEntitled(customerId);
    await ensureRole(discordUserId, entitled, `oauth_link entitle=${entitled}`);

    const html = `
<!doctype html><meta charset="utf-8">
<title>Discord連携完了</title>
<style>
body{font-family:system-ui,-apple-system,"Noto Sans JP",sans-serif;max-width:720px;margin:48px auto;line-height:1.8}
a.btn{display:inline-block;padding:12px 18px;border:1px solid #333;text-decoration:none;margin-right:12px}
</style>
<h1>Discord連携が完了しました</h1>
<p>サーバ内で <b>@pro</b> ロールを${entitled ? '付与' : '剥奪'}しました。</p>
<p><a class="btn" href="${CFG.DISCORD_GUILD_INVITE_URL}" target="_blank" rel="noopener">サーバを開く</a>
<a class="btn" href="${base}/success?code=${encodeURIComponent(sessionId)}">戻る</a></p>
<p>もしロールが反映されない場合：1分待ってリロード、または管理者が再同期を実行してください。</p>
`;
    res.type('html').send(html);
  } catch (e) {
    console.error('[oauth] error:', e);
    res.status(500).send('OAuth link failed');
  }
});

// 管理用：1日1回の再同期（Cloud Schedulerから叩く）
app.post('/admin/resync', async (req, res) => {
  const token = req.header('X-CRON-SECRET');
  if (token !== CFG.SCHEDULER_TOKEN) return res.status(401).send('unauthorized');

  try {
    const snapshot = await firestore.collection('users').get();
    let ok = 0, ng = 0;
    for (const doc of snapshot.docs) {
      const userId = doc.id;
      const { customerId } = doc.data();
      if (!customerId) { ng++; continue; }
      try {
        const entitled = await isCustomerEntitled(customerId);
        await ensureRole(userId, entitled, `cron_resync entitle=${entitled}`);
        await doc.ref.set({ lastSyncAt: Date.now(), updatedAt: Date.now() }, { merge: true });
        ok++;
      } catch (e) {
        console.error('[resync] user error:', userId, e);
        ng++;
      }
    }
    res.json({ ok, ng, total: ok + ng });
  } catch (e) {
    console.error('[resync] error:', e);
    res.status(500).send('resync failed');
  }
});

// 管理用：Discord招待リンクを作成
app.get('/admin/create-invite', async (req, res) => {
  const token = req.query.token;
  if (token !== CFG.SCHEDULER_TOKEN) return res.status(401).send('unauthorized');

  try {
    if (!discordReady) {
      return res.status(503).json({ error: 'Discord bot not ready' });
    }

    const guild = await discord.guilds.fetch(CFG.DISCORD_GUILD_ID);

    // すべてのチャンネルをフェッチ
    await guild.channels.fetch();

    // デバッグ：全チャンネルをログ出力
    console.log('[admin] Available channels:');
    guild.channels.cache.forEach(ch => {
      console.log(`  - ${ch.name} (${ch.type}) - Text: ${ch.isTextBased()}`);
    });

    // 一般チャンネルを探す（最初のテキストチャンネル）
    let channel = guild.channels.cache.find(ch => ch.isTextBased());

    if (!channel) {
      return res.status(500).json({
        error: 'No text channel found',
        availableChannels: guild.channels.cache.map(ch => ({ name: ch.name, type: ch.type }))
      });
    }

    console.log('[admin] Using channel:', channel.name);

    // 招待リンクを作成（無期限、無制限）
    const invite = await channel.createInvite({
      maxAge: 0,        // 無期限
      maxUses: 0,       // 無制限
      unique: true,     // 新しいリンクを作成
      reason: 'Created by admin API'
    });

    console.log('[admin] Created new invite:', invite.url);

    res.json({
      success: true,
      inviteUrl: invite.url,
      inviteCode: invite.code,
      channel: channel.name,
      expiresAt: invite.expiresAt || 'Never',
      maxUses: invite.maxUses || 'Unlimited'
    });

  } catch (e) {
    console.error('[admin] create-invite error:', e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// ------- ユーティリティ -------

function isStudentEmail(email) {
  if (!email) return false;
  const emailLower = email.toLowerCase();
  const studentDomains = ['.ac.jp', '.edu', '.ed.jp'];
  return studentDomains.some(domain => emailLower.endsWith(domain));
}

function getBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  const host = (req.headers['x-forwarded-host'] || req.headers['host']);
  return `${proto}://${host}`;
}

function makeState(code) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${code}|${nonce}`;
  const h = crypto.createHmac('sha256', CFG.OAUTH_STATE_SECRET).update(payload).digest('hex');
  const raw = `${payload}|${h}`;
  return Buffer.from(raw).toString('base64url');
}
function parseState(state) {
  const raw = Buffer.from(state, 'base64url').toString();
  const [code, nonce, sig] = raw.split('|');
  const expect = crypto.createHmac('sha256', CFG.OAUTH_STATE_SECRET).update(`${code}|${nonce}`).digest('hex');
  if (expect !== sig) throw new Error('bad state signature');
  return code; // sessionId
}

function hasCustomerUsedTrial(customer) {
  if (!customer || !customer.metadata) return false;
  const value = customer.metadata.trial_used;
  return typeof value === 'string' ? value.toLowerCase() === 'true' : Boolean(value);
}

async function maybeMarkTrialUsed(subscription) {
  if (!subscription) return;
  if (subscription.status !== 'trialing') return;
  if (!subscription.trial_end || subscription.trial_end * 1000 < Date.now()) return;
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;
  if (!customerId) return;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (hasCustomerUsedTrial(customer)) return;
    const metadata = {
      ...(customer.metadata || {}),
      trial_used: 'true',
      trial_used_at: new Date().toISOString(),
      trial_subscription_id: subscription.id
    };
    await stripe.customers.update(customerId, { metadata });
    console.log(`[trial] marked usage for ${customerId}`);
  } catch (err) {
    console.error('[trial] metadata update failed:', err.message || err);
  }
}

async function saveLinkCode(sessionId, customerId) {
  if (!firestore) {
    console.warn('[firestore] Not initialized, skipping saveLinkCode');
    return;
  }
  try {
    const ref = firestore.collection('linkCodes').doc(sessionId);
    await ref.set({
      customerId, createdAt: Date.now(),
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 14, // 14日
      used: false
    }, { merge: true });
  } catch (err) {
    console.error('[firestore] saveLinkCode error:', err);
  }
}

async function isCustomerEntitled(customerId) {
  // 対象price（月/年）で、即時付与条件：status active|trialing かつ cancel_at_period_end=false
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 20
  });
  const okStatuses = new Set(['active', 'trialing']);
  const okPriceIds = ENTITLED_PRICE_IDS;
  for (const s of subs.data) {
    const hasPrice = s.items.data.some(it => okPriceIds.has(it.price.id));
    if (!hasPrice) continue;
    if (okStatuses.has(s.status) && !s.cancel_at_period_end) return true;
  }
  return false;
}

async function handleSubChange(subscription) {
  const customerId = subscription.customer;
  const entitled = await isCustomerEntitled(customerId);
  const linkedDiscordIds = [];

  // customerId -> discord user を解決
  const usersSnap = await firestore.collection('users').where('customerId', '==', customerId).get();
  if (usersSnap.empty) {
    // 未連携の可能性：linkCodesに保存してあるため、後でOAuth完了時に同期される
    console.log('[subChange] no linked discord user yet for customer:', customerId);
  } else {
    for (const doc of usersSnap.docs) {
      const discordUserId = doc.id;
      linkedDiscordIds.push(discordUserId);
      await ensureRole(discordUserId, entitled, `webhook_sub entitle=${entitled}`);
      await doc.ref.set({ updatedAt: Date.now() }, { merge: true });
    }
  }

  await upsertStripeCustomerSnapshot(subscription, {
    entitled,
    discordUserIds: linkedDiscordIds,
  });
}

async function upsertStripeCustomerSnapshot(subscription, options = {}) {
  if (!firestore) {
    console.warn('[stripeCustomer] firestore not initialized, skipping snapshot');
    return;
  }
  try {
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id;
    if (!customerId) {
      console.warn('[stripeCustomer] missing customer id');
      return;
    }

    let customerEmail = null;
    let orgId = subscription.metadata?.orgId || null;
    try {
      const customer = await stripe.customers.retrieve(customerId);
      customerEmail = customer.email || null;
      if (!orgId && customer.metadata?.orgId) {
        orgId = customer.metadata.orgId;
      }
    } catch (err) {
      console.error('[stripeCustomer] failed to fetch customer', err?.message || err);
    }

    const priceNames = subscription.items?.data?.map((item) => {
      if (!item?.price) return null;
      return item.price.nickname || item.price.id;
    }).filter(Boolean) || [];

    const priceIds = subscription.items?.data?.map((item) => item?.price?.id).filter(Boolean) || [];

    const payload = {
      customerId,
      orgId: orgId || null,
      subscriptionId: subscription.id,
      status: subscription.status,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      currentPeriodEnd: subscription.current_period_end ? subscription.current_period_end * 1000 : null,
      priceIds,
      productNames: priceNames,
      email: customerEmail,
      entitled: Boolean(options.entitled),
      updatedAt: Date.now(),
    };

    if (Array.isArray(options.discordUserIds) && options.discordUserIds.length > 0) {
      payload.linkedDiscordUserIds = options.discordUserIds;
    }

    await firestore.collection('stripe_customers').doc(customerId).set(payload, { merge: true });
  } catch (err) {
    console.error('[stripeCustomer] upsert error:', err?.message || err);
  }
}

async function ensureRole(discordUserId, shouldHaveRole, reason) {
  if (!discordReady) {
    console.warn('[discord] not ready yet, delaying 2s');
    await new Promise(r => setTimeout(r, 2000));
  }
  const guild = await discord.guilds.fetch(CFG.DISCORD_GUILD_ID);
  let member;
  try {
    member = await guild.members.fetch(discordUserId);
  } catch (e) {
    console.error('[discord] member fetch failed (未参加の可能性):', discordUserId, e?.code || e.message);
    return;
  }
  const roleId = CFG.DISCORD_PRO_ROLE_ID;
  const hasRole = member.roles.cache.has(roleId);

  if (shouldHaveRole && !hasRole) {
    await member.roles.add(roleId, reason);
    console.log(`[discord] add role @pro to ${discordUserId}`);
  } else if (!shouldHaveRole && hasRole) {
    await member.roles.remove(roleId, reason);
    console.log(`[discord] remove role @pro from ${discordUserId}`);
  } else {
    console.log(`[discord] role up-to-date (${shouldHaveRole ? 'keep' : 'no-role'}) for ${discordUserId}`);
  }
}

// ------- AI FES. 購入ページ -------
app.get('/aifes', (req, res) => {
  res.type('html').send(aifesPageHTML);
});

// ------- 旧AI FES.ページ（削除予定） -------
app.get('/aifes-old', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI FES. 2026 | AI×建築の祭典</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif;
      background: linear-gradient(135deg, #e0f7fa 0%, #e3f2fd 50%, #ede7f6 100%);
      min-height: 100vh;
      padding: 40px 20px;
      color: #333;
    }
    .container { max-width: 640px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #4dd0e1 0%, #29b6f6 50%, #42a5f5 100%);
      padding: 48px 40px;
      text-align: center;
      border-radius: 16px 16px 0 0;
      position: relative;
      overflow: hidden;
    }
    .header::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="20" cy="20" r="2" fill="rgba(255,255,255,0.1)"/><circle cx="80" cy="40" r="3" fill="rgba(255,255,255,0.1)"/><circle cx="40" cy="80" r="2" fill="rgba(255,255,255,0.1)"/></svg>');
    }
    .logo { width: 80px; height: 80px; margin-bottom: 16px; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.1)); }
    .header h1 { font-size: 32px; font-weight: 700; color: white; letter-spacing: 6px; margin-bottom: 8px; text-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .header .date { font-size: 16px; color: rgba(255,255,255,0.95); letter-spacing: 2px; font-weight: 500; }
    .header .subtitle { font-size: 13px; color: rgba(255,255,255,0.8); margin-top: 8px; }
    .content {
      background: white;
      padding: 40px;
      border-radius: 0 0 16px 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    }
    .member-notice {
      background: linear-gradient(135deg, #e0f7fa, #e3f2fd);
      border: 1px solid #80deea;
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 32px;
    }
    .member-notice h3 { font-size: 14px; font-weight: 600; color: #00838f; margin-bottom: 8px; }
    .member-notice p { font-size: 13px; color: #006064; line-height: 1.7; }
    .notice {
      background: #fafafa;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 32px;
      font-size: 13px;
      line-height: 1.8;
      color: #666;
      border-left: 4px solid #4dd0e1;
    }
    .notice strong { color: #333; }
    .section-title {
      font-size: 14px;
      font-weight: 700;
      background: linear-gradient(135deg, #4dd0e1, #42a5f5);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      letter-spacing: 3px;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 2px solid #e0f7fa;
    }
    .product {
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
      transition: all 0.3s ease;
      background: white;
    }
    .product:hover {
      border-color: #4dd0e1;
      box-shadow: 0 4px 16px rgba(77,208,225,0.15);
      transform: translateY(-2px);
    }
    .product-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
    .product h3 { font-size: 15px; font-weight: 600; color: #333; flex: 1; padding-right: 16px; }
    .product .price { font-size: 20px; font-weight: 700; background: linear-gradient(135deg, #4dd0e1, #42a5f5); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; white-space: nowrap; }
    .product .desc { font-size: 13px; color: #888; line-height: 1.6; margin-bottom: 8px; }
    .product .desc-sub { font-size: 12px; color: #29b6f6; margin-bottom: 16px; font-weight: 500; }
    .product a {
      display: inline-block;
      padding: 12px 28px;
      background: linear-gradient(135deg, #4dd0e1 0%, #29b6f6 100%);
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.3s ease;
      box-shadow: 0 2px 8px rgba(77,208,225,0.3);
    }
    .product a:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(77,208,225,0.4);
    }
    .product.featured {
      border: 2px solid #4dd0e1;
      position: relative;
      background: linear-gradient(135deg, rgba(224,247,250,0.3), rgba(227,242,253,0.3));
    }
    .product.featured::before {
      content: 'BEST';
      position: absolute;
      top: -10px;
      left: 20px;
      background: linear-gradient(135deg, #4dd0e1, #42a5f5);
      color: white;
      font-size: 10px;
      font-weight: 700;
      padding: 4px 14px;
      border-radius: 4px;
      letter-spacing: 2px;
    }
    .divider { height: 2px; background: linear-gradient(90deg, transparent, #e0f7fa, transparent); margin: 40px 0; }

    /* 共通セッションボックス */
    .common-session-box {
      background: #f8fafb;
      border: 1px solid #e8eef1;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .common-session-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    .common-badge {
      background: #1a1a1a;
      color: white;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 4px;
    }
    .common-title {
      font-size: 13px;
      color: #666;
    }
    .common-session-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .common-item {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
    }
    .common-time {
      color: #999;
      font-size: 12px;
      width: 90px;
      flex-shrink: 0;
    }
    .common-name {
      color: #333;
    }

    /* チケットガイド */
    .ticket-guide {
      text-align: center;
      font-size: 13px;
      color: #999;
      margin-bottom: 20px;
    }

    /* チケットグリッド */
    .ticket-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    @media (max-width: 500px) {
      .ticket-grid { grid-template-columns: 1fr; }
    }
    .ticket-card {
      background: white;
      border: 1px solid #e8eef1;
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      transition: all 0.2s;
    }
    .ticket-card:hover {
      border-color: #ccc;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
    }
    .ticket-card.best {
      border: 2px solid #1a1a1a;
      position: relative;
    }
    .ticket-label {
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%);
      background: #1a1a1a;
      color: white;
      font-size: 10px;
      font-weight: 700;
      padding: 3px 12px;
      border-radius: 4px;
      letter-spacing: 1px;
    }
    .ticket-name {
      font-size: 15px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 8px;
    }
    .ticket-price {
      font-size: 24px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 12px;
    }
    .ticket-includes {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: center;
      margin-bottom: 12px;
    }
    .include-tag {
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 4px;
      background: #f0f0f0;
      color: #666;
    }
    .include-tag.all {
      background: #1a1a1a;
      color: white;
    }
    .include-tag.common {
      background: #e8eef1;
      color: #666;
    }
    .ticket-time {
      font-size: 11px;
      color: #999;
      margin-bottom: 16px;
    }
    .ticket-btn {
      display: block;
      padding: 10px 16px;
      background: #1a1a1a;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.2s;
    }
    .ticket-btn:hover {
      background: #333;
    }

    /* Schedule Section */
    .schedule { margin-bottom: 40px; }
    .schedule-block { margin-bottom: 24px; }
    .schedule-block h4 {
      font-size: 13px;
      font-weight: 600;
      color: #00838f;
      background: #e0f7fa;
      padding: 10px 16px;
      border-radius: 8px;
      margin-bottom: 12px;
    }
    .schedule-item {
      display: flex;
      padding: 8px 0;
      border-bottom: 1px solid #f5f5f5;
      font-size: 13px;
    }
    .schedule-item:last-child { border-bottom: none; }
    .schedule-time { width: 110px; color: #4dd0e1; font-weight: 600; flex-shrink: 0; }
    .schedule-title { color: #333; flex: 1; }
    .schedule-break { color: #999; font-style: italic; }

    .circle-promo {
      background: linear-gradient(135deg, #4dd0e1 0%, #29b6f6 50%, #42a5f5 100%);
      border-radius: 16px;
      padding: 36px;
      color: white;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .circle-promo::before {
      content: '';
      position: absolute;
      top: -50%; left: -50%;
      width: 200%; height: 200%;
      background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 60%);
    }
    .circle-promo h3 { font-size: 18px; font-weight: 700; margin-bottom: 12px; position: relative; }
    .circle-promo p { font-size: 14px; line-height: 1.8; opacity: 0.95; margin-bottom: 20px; position: relative; }
    .circle-promo .benefits {
      text-align: left;
      background: rgba(255,255,255,0.15);
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 24px;
      font-size: 14px;
      line-height: 2;
      position: relative;
    }
    .circle-promo a {
      display: inline-block;
      padding: 16px 40px;
      background: white;
      color: #00838f;
      text-decoration: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 700;
      transition: all 0.3s ease;
      position: relative;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    }
    .circle-promo a:hover {
      transform: translateY(-3px);
      box-shadow: 0 6px 20px rgba(0,0,0,0.2);
    }
    .footer {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #eee;
      font-size: 12px;
      color: #999;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="/public/aifes-logo.png" alt="AI FES." class="logo">
      <h1>AI FES.</h1>
      <p class="date">2026.1.25 SAT / ONLINE</p>
      <p class="subtitle">AI×建築の祭典</p>
    </div>
    <div class="content">
      <!-- サークル入会（最上部に配置） -->
      <div class="circle-promo" style="margin-bottom: 32px;">
        <h3 style="font-size: 18px; margin-bottom: 20px; font-weight: 600;">サークル会員なら AI FES. 無料</h3>

        <!-- 価格比較 -->
        <div style="display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 24px;">
          <div style="text-align: center;">
            <p style="font-size: 11px; opacity: 0.7; margin: 0 0 4px 0;">単発購入</p>
            <p style="font-size: 20px; font-weight: 700; margin: 0; text-decoration: line-through; opacity: 0.5;">¥9,800</p>
          </div>
          <span style="font-size: 24px;">→</span>
          <div style="text-align: center;">
            <p style="font-size: 11px; opacity: 0.7; margin: 0 0 4px 0;">会員価格</p>
            <p style="font-size: 28px; font-weight: 800; margin: 0;">¥0</p>
          </div>
        </div>

        <!-- おすすめの使い方フロー -->
        <div style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 20px 16px; margin-bottom: 20px;">
          <p style="font-size: 13px; font-weight: 600; margin: 0 0 16px 0; opacity: 0.9;">おすすめの使い方</p>
          <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px; text-align: left;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="background: white; color: #1a1a1a; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0;">1</span>
              <span>サークルに入会</span>
            </div>
            <div style="margin-left: 9px; border-left: 2px solid rgba(255,255,255,0.3); height: 8px;"></div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="background: white; color: #1a1a1a; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0;">2</span>
              <span>Compass・SpotPDF を試す / Discord参加</span>
            </div>
            <div style="margin-left: 9px; border-left: 2px solid rgba(255,255,255,0.3); height: 8px;"></div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="background: white; color: #1a1a1a; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0;">3</span>
              <span>AI FES. 当日参加</span>
            </div>
            <div style="margin-left: 9px; border-left: 2px solid rgba(255,255,255,0.3); height: 8px;"></div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="background: white; color: #1a1a1a; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0;">4</span>
              <span>アフターサポートも活用</span>
            </div>
            <div style="margin-left: 9px; border-left: 2px solid rgba(255,255,255,0.3); height: 8px;"></div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="background: white; color: #1a1a1a; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0;">5</span>
              <span style="font-weight: 600;">継続 or 解約を判断</span>
            </div>
          </div>
        </div>

        <!-- 解約OK -->
        <p style="font-size: 13px; margin: 0 0 20px 0; opacity: 0.9;">
          <span style="background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 4px;">解約要件なし・いつでも退会OK</span>
        </p>

        <!-- ボタン -->
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
          <a href="https://suz-u3n-chu.github.io/AI-Architecture-Circle/" target="_blank" style="background: transparent; border: 1px solid rgba(255,255,255,0.4); padding: 12px 20px; font-size: 13px;">詳細を見る</a>
          <a href="https://buy.stripe.com/dRm00l0J75OR3eV8Cbf7i00" target="_blank" style="padding: 12px 20px; font-size: 13px;">入会する（月額¥5,000）</a>
        </div>
        <p style="font-size: 11px; margin-top: 12px; opacity: 0.6;">入会後、AI FES.無料クーポンがメールで届きます</p>
      </div>

      <div class="member-notice">
        <h3>既にサークル会員の方へ</h3>
        <p>会員様には専用クーポンをメールでお送りしています。<br>メールに記載のコードで無料参加できます。</p>
      </div>

      <div class="divider"></div>

      <h2 class="section-title">TICKETS（単発購入）</h2>

      <!-- 共通セッション説明 -->
      <div class="common-session-box">
        <div class="common-session-header">
          <span class="common-badge">全チケット共通</span>
          <span class="common-title">どのチケットでも視聴できます</span>
        </div>
        <div class="common-session-list">
          <div class="common-item">
            <span class="common-time">10:15-11:30</span>
            <span class="common-name">最新AI Newsまとめ</span>
          </div>
          <div class="common-item">
            <span class="common-time">17:30-18:50</span>
            <span class="common-name">自社製品デモ（COMPASS / SpotPDF / KAKOME）</span>
          </div>
          <div class="common-item">
            <span class="common-time">21:00-22:00</span>
            <span class="common-name">フィナーレ（プレゼント配布＋質問タイム）</span>
          </div>
        </div>
      </div>

      <!-- チケット選択ガイド -->
      <p class="ticket-guide">↓ 興味のあるセミナーを選んでください</p>

      <!-- チケットカード -->
      <div class="ticket-grid">
        <div class="ticket-card best">
          <div class="ticket-label">BEST</div>
          <div class="ticket-name">1日通し</div>
          <div class="ticket-price">¥9,800</div>
          <div class="ticket-includes">
            <span class="include-tag all">全セッション</span>
          </div>
          <div class="ticket-time">10:00〜22:00</div>
          <a href="https://buy.stripe.com/aFacN7ezX6SV8zfcSrf7i03" target="_blank" class="ticket-btn">購入する</a>
        </div>

        <div class="ticket-card">
          <div class="ticket-name">実務AI×建築</div>
          <div class="ticket-price">¥5,000</div>
          <div class="ticket-includes">
            <span class="include-tag">実務セミナー</span>
            <span class="include-tag common">+共通</span>
          </div>
          <div class="ticket-time">13:35〜16:00</div>
          <a href="https://buy.stripe.com/14A00lezX4KNdTz5pZf7i04" target="_blank" class="ticket-btn">購入する</a>
        </div>

        <div class="ticket-card">
          <div class="ticket-name">画像生成AI</div>
          <div class="ticket-price">¥4,000</div>
          <div class="ticket-includes">
            <span class="include-tag">画像生成セミナー</span>
            <span class="include-tag common">+共通</span>
          </div>
          <div class="ticket-time">16:00〜17:30</div>
          <a href="https://buy.stripe.com/5kQ9AVcrP1yB5n3aKjf7i05" target="_blank" class="ticket-btn">購入する</a>
        </div>

        <div class="ticket-card">
          <div class="ticket-name">GAS＆無料HP</div>
          <div class="ticket-price">¥3,000</div>
          <div class="ticket-includes">
            <span class="include-tag">GASセミナー</span>
            <span class="include-tag common">+共通</span>
          </div>
          <div class="ticket-time">11:45〜12:35 / 19:00〜21:00</div>
          <a href="https://buy.stripe.com/7sY9AVcrP6SV4iZf0zf7i06" target="_blank" class="ticket-btn">購入する</a>
        </div>
      </div>

      <!-- 注意事項 -->
      <div class="notice" style="margin-top: 24px;">
        <strong>購入前にご確認</strong><br>
        購入時のメールアドレスでZoom登録されます。異なるメールアドレスでは参加できません。
      </div>

      <div class="divider"></div>

      <h2 class="section-title">TIME SCHEDULE</h2>
      <div class="schedule">
        <div class="schedule-block">
          <h4>午前：視界を広げる</h4>
          <div class="schedule-item"><span class="schedule-time">10:00–10:15</span><span class="schedule-title">オープニング</span></div>
          <div class="schedule-item"><span class="schedule-time">10:15–11:30</span><span class="schedule-title">最新AI Newsまとめ</span></div>
          <div class="schedule-item"><span class="schedule-time">11:30–11:45</span><span class="schedule-title schedule-break">休憩</span></div>
          <div class="schedule-item"><span class="schedule-time">11:45–12:35</span><span class="schedule-title">GAS＆業務自動化</span></div>
        </div>

        <div class="schedule-block">
          <h4>午後前半：基礎を固める</h4>
          <div class="schedule-item"><span class="schedule-time">12:35–13:35</span><span class="schedule-title schedule-break">お昼休み</span></div>
          <div class="schedule-item"><span class="schedule-time">13:35–14:35</span><span class="schedule-title">第２回実務AI×建築セミナー（基本・使い分け）</span></div>
          <div class="schedule-item"><span class="schedule-time">14:35–14:45</span><span class="schedule-title schedule-break">休憩</span></div>
          <div class="schedule-item"><span class="schedule-time">14:45–15:45</span><span class="schedule-title">第２回実務AI×建築セミナー（実践）</span></div>
          <div class="schedule-item"><span class="schedule-time">15:45–16:00</span><span class="schedule-title schedule-break">休憩</span></div>
        </div>

        <div class="schedule-block">
          <h4>午後後半：実践＆製品デモ</h4>
          <div class="schedule-item"><span class="schedule-time">16:00–17:30</span><span class="schedule-title">第２回今使える画像生成AIセミナー</span></div>
          <div class="schedule-item"><span class="schedule-time">17:30–18:30</span><span class="schedule-title">自社製品デモ（COMPASS/SpotPDF/KAKOME）</span></div>
          <div class="schedule-item"><span class="schedule-time">18:30–18:50</span><span class="schedule-title">質問タイム（画像生成＆製品）</span></div>
        </div>

        <div class="schedule-block">
          <h4>夜の部：交流とボーナス</h4>
          <div class="schedule-item"><span class="schedule-time">18:50–20:00</span><span class="schedule-title schedule-break">夕食休憩</span></div>
          <div class="schedule-item"><span class="schedule-time">20:00–21:00</span><span class="schedule-title">第１回無料HP＆GAS自動化セミナー</span></div>
          <div class="schedule-item"><span class="schedule-time">21:00–21:30</span><span class="schedule-title">プレゼント配布＋AI×建築サークル案内</span></div>
          <div class="schedule-item"><span class="schedule-time">21:30–22:00</span><span class="schedule-title">グランドフィナーレ</span></div>
        </div>
      </div>

      <div class="footer">ご不明点はお問い合わせください</div>
    </div>
  </div>
</body>
</html>
  `;
  res.type('html').send(html);
});

// ------- サーバ起動 -------
app.listen(PORT, () => {
  console.log(`Listening on :${PORT} (mode=${CFG.STRIPE_MODE})`);
});
