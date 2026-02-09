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

        // リファラル完了処理
        if (session.metadata && session.metadata.referral_code && firestore) {
          try {
            const refCode = session.metadata.referral_code;
            const newEmail = session.customer_details?.email || session.customer_email || '';
            const refSnap = await firestore.collection('referrals')
              .where('code', '==', refCode).limit(1).get();
            if (!refSnap.empty) {
              const refDoc = refSnap.docs[0];
              const refData = refDoc.data();
              await refDoc.ref.update({
                referrals: (refData.referrals || 0) + 1,
                lastReferralAt: new Date().toISOString()
              });
              // 紹介者にクーポン適用
              if (refData.couponId && refData.referrerCustomerId) {
                const subs = await stripe.subscriptions.list({
                  customer: refData.referrerCustomerId,
                  status: 'active',
                  limit: 1
                });
                if (subs.data.length > 0) {
                  await stripe.subscriptions.update(subs.data[0].id, {
                    coupon: refData.couponId
                  });
                  console.log(`[webhook] Applied referral reward to ${refData.referrerEmail}`);
                }
              }
              console.log(`[webhook] Referral completed: ${refCode} → ${newEmail}`);
            }
          } catch (refErr) {
            console.error('[webhook] Referral processing error:', refErr.message);
          }
        }

        // 会社名が入力されていたら顧客名を更新（領収書用）
        if (session.custom_fields && session.custom_fields.length > 0) {
          const companyField = session.custom_fields.find(f => f.key === 'company_name');
          if (companyField && companyField.text && companyField.text.value) {
            const companyName = companyField.text.value;

            // 顧客名を更新
            await stripe.customers.update(session.customer, {
              name: companyName
            });
            console.log(`[webhook] updated customer name to: ${companyName}`);

            // 最新の請求書も更新（発行済みの請求書の宛名を修正）
            try {
              const invoices = await stripe.invoices.list({
                customer: session.customer,
                limit: 1
              });
              if (invoices.data.length > 0) {
                const latestInvoice = invoices.data[0];
                // ドラフト状態の請求書のみ更新可能、確定済みはメタデータで対応
                if (latestInvoice.status === 'draft') {
                  await stripe.invoices.update(latestInvoice.id, {
                    customer_name: companyName
                  });
                  console.log(`[webhook] updated invoice ${latestInvoice.id} customer_name`);
                } else {
                  // 確定済み請求書はメタデータに保存（カスタム領収書生成用）
                  await stripe.invoices.update(latestInvoice.id, {
                    metadata: { company_name: companyName }
                  });
                  console.log(`[webhook] saved company_name to invoice metadata: ${latestInvoice.id}`);
                }
              }
            } catch (invoiceErr) {
              console.error(`[webhook] invoice update error:`, invoiceErr.message);
            }
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

// CORS（LP・ツールからのAPI呼び出し用）
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://archi-prisma.co.jp',
    'https://ai-archi-circle.archi-prisma.co.jp',
    'https://rakuraku-energy.archi-prisma.co.jp',
    'https://kokome.archi-prisma.co.jp',
    'http://localhost:5173',
    'http://localhost:3000'
  ];
  const origin = req.headers.origin;
  // 固定リスト + Firebase Hosting (*.web.app, *.firebaseapp.com)
  const isAllowed = origin && (
    allowedOrigins.some(o => origin.startsWith(o)) ||
    /^https:\/\/[\w-]+\.(web\.app|firebaseapp\.com)$/.test(origin)
  );
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 静的ファイル配信（ロゴ等）
const path = require('path');
const nodemailer = require('nodemailer');

// ------- Gmail SMTP トランスポーター（リード向けメール送信用） -------
const gmailTransporter = (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    })
  : null;
app.use('/public', express.static(path.join(__dirname, 'public')));

// ---- ヘルス & ルート ----
app.get('/healthz', (_req, res) => res.send('ok'));

app.get('/', (_req, res) => {
  const html = `
<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI×建築サークル</title>
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
    padding: 24px;
  }
  .container {
    max-width: 540px;
    width: 100%;
    text-align: center;
    padding: 48px 28px;
    background: white;
    border-radius: 12px;
    border: 1px solid #e9ecef;
    box-shadow: 0 8px 30px rgba(0,0,0,0.08);
  }
  h1 { font-size: 2rem; margin-bottom: 8px; font-weight: 700; }
  .subtitle { font-size: 1rem; color: #666; margin-bottom: 28px; }

  /* Plan Tabs */
  .plan-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 28px;
    border-radius: 8px;
    overflow: hidden;
    border: 2px solid #222;
  }
  .plan-tab {
    flex: 1;
    padding: 12px 8px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    background: #fff;
    color: #333;
    border: none;
    transition: all 0.2s;
    position: relative;
  }
  .plan-tab:not(:last-child) { border-right: 1px solid #ddd; }
  .plan-tab.active {
    background: #222;
    color: #fff;
  }
  .plan-tab .badge {
    display: block;
    font-size: 0.65rem;
    font-weight: 700;
    color: #ff3300;
    margin-top: 2px;
  }
  .plan-tab.active .badge { color: #ff6644; }

  .plan-price {
    font-size: 2.8rem;
    font-weight: 800;
    margin-bottom: 4px;
    line-height: 1;
  }
  .plan-period {
    font-size: 0.9rem;
    color: #888;
    margin-bottom: 4px;
  }
  .plan-savings {
    font-size: 0.8rem;
    color: #ff3300;
    font-weight: 600;
    margin-bottom: 20px;
    min-height: 1.2em;
  }

  .features { text-align: left; margin-bottom: 28px; }
  .feature {
    display: flex;
    align-items: center;
    margin-bottom: 10px;
    font-size: 0.95rem;
  }
  .feature::before { content: "\\2713"; margin-right: 10px; color: #222; font-weight: bold; }

  .btn {
    display: inline-block;
    padding: 14px 28px;
    background: #fff;
    color: #333;
    text-decoration: none;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 500;
    margin: 8px;
    border: 2px solid #333;
    transition: all 0.2s ease;
  }
  .btn:hover { background: #333; color: #fff; }
  .btn.primary {
    background: #222;
    color: #fff;
    width: 100%;
    padding: 16px;
    font-size: 1.05rem;
    font-weight: 700;
    border: none;
    cursor: pointer;
  }
  .btn.primary:hover { background: #000; }
  .btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .cancel-section {
    margin-top: 40px;
    padding-top: 28px;
    border-top: 1px solid #e9ecef;
  }
  .cancel-section h3 {
    font-size: 1rem;
    margin-bottom: 12px;
    color: #666;
  }
  .mode-badge {
    position: fixed;
    top: 16px;
    right: 16px;
    padding: 6px 12px;
    background: ${CFG.STRIPE_MODE === 'live' ? '#000' : '#666'};
    color: white;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    z-index: 100;
  }
  .student-note {
    font-size: 0.75rem;
    color: #888;
    margin-top: 12px;
  }
</style>
<div class="mode-badge">${CFG.STRIPE_MODE === 'live' ? 'LIVE' : 'TEST'}</div>
<div class="container">
  <h1>AI×建築サークル</h1>
  <p class="subtitle">メンバーシップ登録</p>

  <!-- Plan Selector Tabs -->
  <div class="plan-tabs">
    <button class="plan-tab" data-plan="yearly" onclick="selectPlan('yearly')">
      年間プラン
      <span class="badge">2ヶ月分お得</span>
    </button>
    <button class="plan-tab active" data-plan="monthly" onclick="selectPlan('monthly')">
      月額プラン
    </button>
    <button class="plan-tab" data-plan="student" onclick="selectPlan('student')">
      学割
      <span class="badge">60%OFF</span>
    </button>
  </div>

  <!-- Dynamic Price Display -->
  <div class="plan-price" id="plan-price">¥5,000</div>
  <div class="plan-period" id="plan-period">/ 月（税込）</div>
  <div class="plan-savings" id="plan-savings">&nbsp;</div>

  <div class="features">
    <div class="feature">Sena主催セミナーに無料参加</div>
    <div class="feature">アーカイブ動画 見放題</div>
    <div class="feature">Sena開発ツール 利用権</div>
    <div class="feature">Discordコミュニティ参加</div>
    <div class="feature">いつでも解約可能</div>
  </div>

  <form id="checkout-form" style="margin-bottom: 16px;">
    <div style="margin-bottom: 14px;">
      <input
        type="email"
        id="email-input"
        placeholder="メールアドレス"
        required
        style="width: 100%; padding: 14px 16px; border-radius: 6px; border: 1px solid #ddd; font-size: 1rem;"
      >
    </div>
    <div style="margin-bottom: 14px;">
      <input
        type="text"
        id="company-input"
        placeholder="会社名（任意・領収書の宛名）"
        style="width: 100%; padding: 14px 16px; border-radius: 6px; border: 1px solid #ddd; font-size: 1rem;"
      >
    </div>
    <button type="submit" class="btn primary" id="checkout-btn">
      今すぐ参加する
    </button>
    <div id="error-message" style="color: #dc3545; margin-top: 12px; display: none; font-size: 0.9rem;"></div>
    <div id="warning-message" style="color: #ff9800; margin-top: 12px; display: none; font-size: 0.9rem;"></div>
    <p class="student-note" id="student-note" style="display:none;">※ 学割は .ac.jp / .edu / .ed.jp ドメインのメールアドレスが対象です</p>
  </form>

  <div id="referral-banner" style="display:none; margin-bottom:16px; padding:12px; background:#e8f5e9; border:1px solid #66bb6a; border-radius:6px; color:#2e7d32; font-size:0.9rem; text-align:center;">
    <strong>紹介コード適用中</strong> ― 紹介者特典で初月割引が適用されます
  </div>
  <input type="hidden" id="referral-code" value="">
  <input type="hidden" id="selected-plan" value="monthly">

  <script>
    const PLANS = {
      yearly:  { price: '¥50,000', period: '/ 年（税込）', savings: '月あたり約¥4,167 ― 年間¥10,000お得', priceId: '${PRICE_IDS.yearly || ''}' },
      monthly: { price: '¥5,000',  period: '/ 月（税込）', savings: '',                                     priceId: '${PRICE_IDS.monthly || ''}' },
      student: { price: '¥2,000',  period: '/ 月（税込）', savings: '学生限定 ― 通常の60%OFF',              priceId: '${PRICE_IDS.student || ''}' }
    };

    function selectPlan(plan) {
      document.getElementById('selected-plan').value = plan;
      document.querySelectorAll('.plan-tab').forEach(t => t.classList.remove('active'));
      document.querySelector('[data-plan="'+plan+'"]').classList.add('active');
      document.getElementById('plan-price').textContent = PLANS[plan].price;
      document.getElementById('plan-period').textContent = PLANS[plan].period;
      document.getElementById('plan-savings').innerHTML = PLANS[plan].savings || '&nbsp;';
      document.getElementById('student-note').style.display = plan === 'student' ? 'block' : 'none';
    }

    // URLパラメータからプラン指定を読み取る
    (function() {
      const params = new URLSearchParams(window.location.search);
      const plan = params.get('plan');
      if (plan && PLANS[plan]) {
        selectPlan(plan);
      }

      // リファラルコード検出
      const ref = params.get('ref');
      if (ref) {
        document.getElementById('referral-code').value = ref;
        fetch('/api/referral/verify/' + encodeURIComponent(ref))
          .then(r => r.json())
          .then(data => {
            if (data.ok && data.valid) {
              document.getElementById('referral-banner').style.display = 'block';
            }
          })
          .catch(() => {});
      }
    })();

    document.getElementById('checkout-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const btn = document.getElementById('checkout-btn');
      const email = document.getElementById('email-input').value;
      const companyName = document.getElementById('company-input').value;
      const referralCode = document.getElementById('referral-code').value;
      const selectedPlan = document.getElementById('selected-plan').value;
      const errorDiv = document.getElementById('error-message');
      const warningDiv = document.getElementById('warning-message');

      errorDiv.style.display = 'none';
      warningDiv.style.display = 'none';
      btn.disabled = true;
      btn.textContent = '処理中...';

      try {
        const body = { email, companyName };
        if (referralCode) body.referralCode = referralCode;

        // 選択されたプランのpriceIdを送信
        const planData = PLANS[selectedPlan];
        if (planData && planData.priceId) {
          body.priceId = planData.priceId;
        }

        const response = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
          errorDiv.textContent = data.message || 'エラーが発生しました';
          errorDiv.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '今すぐ参加する';
          return;
        }

        if (data.warnings && data.warnings.length > 0) {
          warningDiv.textContent = data.warnings.join('\\n');
          warningDiv.style.display = 'block';
        }

        window.location.href = data.url;

      } catch (error) {
        errorDiv.textContent = 'ネットワークエラーが発生しました';
        errorDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '今すぐ参加する';
      }
    });
  </script>

  <div class="cancel-section">
    <h3>既存メンバー</h3>
    <p style="margin-bottom: 12px; color: #666;">管理・解約はこちら</p>
    <a class="btn" href="/portal-lookup">請求管理</a>
    <a class="btn" href="/referral" style="margin-top: 8px;">紹介リンク取得</a>
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
          <p>プラン: AI×建築サークル Pro</p>
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
      <a href="mailto:s.sakuramoto@archi-prisma.co.jp?subject=AI×建築サークル 解約手続き&body=【AI×建築サークル 解約希望】%0A%0A■ 登録情報%0A・メールアドレス：${email}%0A・Discord ユーザー名：%0A・Discord ID（数字）：%0A%0A■ 解約希望日%0A・いつから解約したいですか：%0A%0A■ 解約理由（任意）%0A・理由があれば教えてください：%0A%0A■ その他%0A・ご質問やご要望があれば：%0A%0A※このメールに返信いただければ解約手続きを開始いたします。" class="btn">解約手続きのお問い合わせ</a>
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
  const { email, priceId, mode, companyName, referralCode } = req.body;

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

    // 会社名が入力されていたら、顧客名を先に設定（請求書の宛名になる）
    if (companyName && companyName.trim()) {
      const customerName = companyName.trim();
      if (customer) {
        // 既存顧客の名前を更新
        customer = await stripe.customers.update(customer.id, { name: customerName });
        console.log(`[checkout] Updated customer name to: ${customerName}`);
      } else {
        // 新規顧客を会社名付きで作成
        customer = await stripe.customers.create({ email, name: customerName });
        console.log(`[checkout] Created new customer with name: ${customerName}`);
      }
    }

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
      allow_promotion_codes: true,
      success_url: `${base}/oauth/discord/start?code={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?canceled=true`,
      metadata: {
        source: 'api_checkout',
        ...(referralCode ? { referral_code: referralCode } : {})
      }
    };

    // リファラルコードがある場合、新規会員にも割引を適用
    if (referralCode && firestore) {
      try {
        const refSnap = await firestore.collection('referrals')
          .where('code', '==', referralCode).limit(1).get();
        if (!refSnap.empty) {
          const refData = refSnap.docs[0].data();
          if (refData.couponId) {
            // 新規会員用クーポンを別途作成（初月1,000円OFF）
            const newMemberCoupon = await stripe.coupons.create({
              amount_off: 1000,
              currency: 'jpy',
              duration: 'once',
              name: `紹介割引 (${referralCode})`,
              metadata: { referral_code: referralCode, type: 'new_member' }
            });
            sessionParams.discounts = [{ coupon: newMemberCoupon.id }];
            delete sessionParams.allow_promotion_codes; // discountsと併用不可
            console.log(`[checkout] Applied referral coupon for code: ${referralCode}`);
          }
        }
      } catch (err) {
        console.warn('[checkout] Referral coupon lookup failed:', err.message);
      }
    }

    // トライアル設定なし（クーポンで対応）

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
<title>決済完了 | AI×建築サークル</title>
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
  <p class="subtitle">AI×建築サークルが有効になりました</p>

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
    <a class="btn" href="mailto:s.sakuramoto@archi-prisma.co.jp?subject=AI×建築サークル 解約手続き&body=【AI×建築サークル 解約希望】%0A%0A■ 登録情報%0A・メールアドレス：%0A・Discord ユーザー名：%0A・Discord ID（数字）：%0A%0A■ 解約希望日%0A・いつから解約したいですか：%0A%0A■ 解約理由（任意）%0A・理由があれば教えてください：%0A%0A■ その他%0A・ご質問やご要望があれば：%0A%0A※このメールに返信いただければ解約手続きを開始いたします。">解約手続きのお問い合わせ</a>
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

// メールアドレスでDiscord連携を開始（メールからのリンク用）
app.get('/link', async (req, res) => {
  const email = req.query.email;
  const base = getBaseUrl(req);

  if (!email) {
    // メールアドレスがない場合は入力フォームを表示
    const html = `
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Discord連携 | AI×建築サークル</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif;
  background: #f8f9fa;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.container {
  max-width: 400px;
  width: 100%;
  background: white;
  padding: 40px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
h1 { font-size: 1.5rem; margin-bottom: 8px; color: #1a1a1a; }
.subtitle { color: #666; margin-bottom: 24px; }
.form-group { margin-bottom: 20px; }
label { display: block; margin-bottom: 8px; font-weight: 500; color: #333; }
input {
  width: 100%;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 1rem;
}
input:focus { outline: none; border-color: #5865F2; }
.btn {
  width: 100%;
  padding: 14px;
  background: #5865F2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
}
.btn:hover { background: #4752C4; }
</style>
</head>
<body>
<div class="container">
  <h1>Discord連携</h1>
  <p class="subtitle">購入時のメールアドレスを入力してください</p>
  <form method="GET" action="/link">
    <div class="form-group">
      <label for="email">メールアドレス</label>
      <input type="email" id="email" name="email" placeholder="your@example.com" required>
    </div>
    <button type="submit" class="btn">Discord連携を開始</button>
  </form>
</div>
</body>
</html>
    `;
    return res.type('html').send(html);
  }

  try {
    // メールアドレスで顧客を検索
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (customers.data.length === 0) {
      return res.status(404).send(`
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>顧客が見つかりません</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 400px; margin: 60px auto; padding: 20px; text-align: center; }
h1 { color: #e53e3e; margin-bottom: 16px; }
a { color: #5865F2; }
</style>
</head>
<body>
<h1>顧客が見つかりません</h1>
<p>このメールアドレスでの購入履歴が見つかりませんでした。</p>
<p><a href="/link">別のメールアドレスで試す</a></p>
</body>
</html>
      `);
    }

    const customerId = customers.data[0].id;

    // アクティブなサブスクリプションがあるか確認
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1
    });

    if (subscriptions.data.length === 0) {
      return res.status(400).send(`
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>有効なサブスクリプションがありません</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 400px; margin: 60px auto; padding: 20px; text-align: center; }
h1 { color: #e53e3e; margin-bottom: 16px; }
a { color: #5865F2; }
</style>
</head>
<body>
<h1>有効なサブスクリプションがありません</h1>
<p>このメールアドレスには有効なサブスクリプションがありません。</p>
<p><a href="/">サブスクリプションを購入する</a></p>
</body>
</html>
      `);
    }

    // 顧客の最新のcheckout sessionを検索
    const sessions = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 1
    });

    if (sessions.data.length === 0) {
      return res.status(500).send('Checkout session not found');
    }

    const sessionId = sessions.data[0].id;

    // Discord OAuthにリダイレクト
    res.redirect(`${base}/oauth/discord/start?code=${encodeURIComponent(sessionId)}`);

  } catch (error) {
    console.error('[link] error:', error);
    res.status(500).send('エラーが発生しました');
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
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>セットアップ完了 | AI×建築サークル</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif;
  background: linear-gradient(135deg, #1a1a1a 0%, #333 100%);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.card {
  background: white;
  border-radius: 16px;
  padding: 48px 40px;
  max-width: 480px;
  width: 100%;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
.success-icon {
  width: 80px;
  height: 80px;
  background: linear-gradient(135deg, #4ade80, #22c55e);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 24px;
  animation: scaleIn 0.5s ease-out;
}
@keyframes scaleIn {
  0% { transform: scale(0); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}
.success-icon svg { width: 40px; height: 40px; color: white; }
h1 { font-size: 1.8rem; color: #1a1a1a; margin-bottom: 12px; }
.subtitle { color: #666; margin-bottom: 32px; line-height: 1.6; }
.role-badge {
  display: inline-block;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  padding: 8px 20px;
  border-radius: 20px;
  font-weight: 600;
  margin-bottom: 32px;
}
.next-step {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
  text-align: left;
}
.next-step h2 {
  font-size: 0.9rem;
  color: #666;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.next-step p { color: #333; line-height: 1.6; }
.btn {
  display: inline-block;
  padding: 16px 32px;
  border-radius: 8px;
  text-decoration: none;
  font-weight: 600;
  font-size: 1rem;
  transition: transform 0.2s, box-shadow 0.2s;
}
.btn:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
.btn-primary {
  background: #5865F2;
  color: white;
  width: 100%;
  margin-bottom: 12px;
}
.btn-secondary {
  background: white;
  color: #333;
  border: 1px solid #ddd;
  width: 100%;
}
.note {
  margin-top: 24px;
  font-size: 0.85rem;
  color: #888;
  line-height: 1.6;
}
.brand {
  font-size: 0.9rem;
  color: #666;
  letter-spacing: 2px;
  margin-bottom: 24px;
  font-weight: 500;
}
</style>
</head>
<body>
<div class="card">
  <p class="brand">AI×建築サークル</p>
  <div class="success-icon">
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
    </svg>
  </div>
  <h1>セットアップ完了!</h1>
  <p class="subtitle">Discord連携が正常に完了しました</p>
  <div class="role-badge">@pro ロール付与済み</div>

  <div class="next-step">
    <h2>次のステップ</h2>
    <p>Discordサーバーに参加して、Pro限定チャンネルにアクセスしましょう。</p>
  </div>

  <a class="btn btn-primary" href="${CFG.DISCORD_GUILD_INVITE_URL}" target="_blank" rel="noopener">
    Discordサーバーを開く
  </a>
  <a class="btn btn-secondary" href="${base}/portal?code=${encodeURIComponent(sessionId)}">
    サブスクリプション管理
  </a>

  <p class="note">
    ロールが反映されない場合は、1分ほど待ってからサーバーを確認してください。
  </p>
</div>
</body>
</html>
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

// 管理用：未連携者リストを取得（GASからリマインドメール送信用）
app.get('/admin/unlinked-customers', async (req, res) => {
  const token = req.query.token;
  if (token !== CFG.SCHEDULER_TOKEN) return res.status(401).send('unauthorized');

  try {
    // 1. アクティブなサブスクリプションを持つ全顧客を取得
    const subscriptions = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
      expand: ['data.customer']
    });

    // 2. Firestoreから連携済みユーザーのcustomerIdを取得
    const linkedSnapshot = await firestore.collection('users').get();
    const linkedCustomerIds = new Set();
    linkedSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.customerId) {
        linkedCustomerIds.add(data.customerId);
      }
    });

    // 3. 未連携の顧客を抽出
    const unlinkedCustomers = [];
    for (const sub of subscriptions.data) {
      const customer = sub.customer;
      if (typeof customer === 'object' && customer.id && !linkedCustomerIds.has(customer.id)) {
        // サブスク開始から24時間以上経過しているかチェック
        const subCreatedAt = sub.created * 1000; // Unix timestamp to ms
        const hoursSinceCreation = (Date.now() - subCreatedAt) / (1000 * 60 * 60);

        if (hoursSinceCreation >= 24) {
          unlinkedCustomers.push({
            customerId: customer.id,
            email: customer.email,
            name: customer.name || '',
            subscriptionCreated: new Date(subCreatedAt).toISOString(),
            hoursSinceCreation: Math.floor(hoursSinceCreation)
          });
        }
      }
    }

    console.log(`[unlinked] Found ${unlinkedCustomers.length} unlinked customers (24h+)`);

    res.json({
      count: unlinkedCustomers.length,
      customers: unlinkedCustomers
    });

  } catch (error) {
    console.error('[unlinked] error:', error);
    res.status(500).json({ error: error.message });
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
          <a href="/" style="padding: 12px 20px; font-size: 13px;">入会する（月額¥5,000・学割あり）</a>
        </div>
        <p style="font-size: 11px; margin-top: 12px; opacity: 0.6;">入会後、AI FES.参加URLがメールで届きます</p>
      </div>

      <div class="member-notice">
        <h3>既にサークル会員の方へ</h3>
        <p>入会時にZoom参加URLをお送り済みです。<br>メールをご確認ください。届いていない場合はDiscordでお問い合わせください。</p>
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

// ------- AI FES. アーカイブ動画ページ -------

// AI FES Price ID → セッションマッピング
const AIFES_PRICE_MAP = {
  'price_1Squ8URpUEcUjSDNMitC1StT': {
    name: 'AI FES. 参加チケット（1日通し）',
    sessions: ['A', 'B', 'C', 'D', 'E1', 'E2', 'F']
  },
  'price_1Squ8VRpUEcUjSDNmzZ6QliV': {
    name: '第２回実務で使えるAI×建築セミナー',
    sessions: ['C', 'F']
  },
  'price_1Squ8WRpUEcUjSDNiU9RiUXF': {
    name: '今使える画像生成AIセミナー（第２回開催）',
    sessions: ['D', 'F']
  },
  'price_1Squ8XRpUEcUjSDNUkqyg2jm': {
    name: 'Googleサービスでつくる無料HP＆業務自動化（GAS）セミナー（第１回開催）',
    sessions: ['E1', 'E2', 'F']
  }
};

// セッション情報（★YouTubeリンクを設定する★）
const AIFES_SESSIONS = {
  'A': {
    name: '開幕＋最新AI Newsまとめ（建築業界向け sena流）',
    desc: 'AI FES. 2026 オープニング＋直近30日間の主要AIアップデートを建築実務の視点で解説',
    youtubeId: 'XXXXXX' // ← YouTube動画IDを設定
  },
  'B': {
    name: '自社プロダクト（COMPASS/SpotPDF/KAKOME）使い方',
    desc: 'AI×建築サークルが開発した3つのプロダクトを実演付きで紹介',
    youtubeId: 'XXXXXX'
  },
  'C': {
    name: '第２回実務で使えるAI×建築セミナー',
    desc: 'ChatGPT / Claude / Gemini の使い分けと建築実務での活用法',
    youtubeId: 'XXXXXX'
  },
  'D': {
    name: '今使える画像生成AIセミナー（第２回開催）',
    desc: 'Nano Banana Pro × 建築パース実践ワークフロー',
    youtubeId: 'XXXXXX'
  },
  'E1': {
    name: '業務自動化（GAS）セミナー',
    desc: 'Google Apps Scriptで見積・工程・メールを自動化',
    youtubeId: 'XXXXXX'
  },
  'E2': {
    name: 'Googleサービスでつくる無料HP',
    desc: '建築事務所のWeb集客をゼロ円で始める方法',
    youtubeId: 'XXXXXX'
  },
  'F': {
    name: '質問タイム',
    desc: '建築×AIのリアルな疑問に回答するガチ質問タイム',
    youtubeId: 'XXXXXX'
  }
};

// アーカイブ: メール入力フォーム
app.get('/archive', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI FES. 2026 アーカイブ動画</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif;
      background: #0a0a1a;
      min-height: 100vh;
      color: #fff;
    }
    .container {
      max-width: 480px;
      margin: 0 auto;
      padding: 60px 20px;
      text-align: center;
    }
    .logo {
      font-size: 14px;
      letter-spacing: 4px;
      color: #667eea;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 12px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      color: #888;
      font-size: 14px;
      margin-bottom: 48px;
      line-height: 1.6;
    }
    .form-box {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 32px 24px;
    }
    .form-box label {
      display: block;
      text-align: left;
      font-size: 13px;
      color: #aaa;
      margin-bottom: 8px;
    }
    .form-box input[type="email"] {
      width: 100%;
      padding: 14px 16px;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px;
      background: rgba(255,255,255,0.08);
      color: #fff;
      font-size: 16px;
      outline: none;
      transition: border 0.2s;
    }
    .form-box input[type="email"]:focus {
      border-color: #667eea;
    }
    .form-box input[type="email"]::placeholder {
      color: #555;
    }
    .btn {
      display: block;
      width: 100%;
      margin-top: 16px;
      padding: 14px;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .error {
      margin-top: 16px;
      padding: 12px;
      background: rgba(220,53,69,0.15);
      border: 1px solid rgba(220,53,69,0.3);
      border-radius: 8px;
      color: #ff6b6b;
      font-size: 14px;
      display: none;
    }
    .note {
      margin-top: 24px;
      font-size: 12px;
      color: #555;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">AI FES. 2026</div>
    <h1>アーカイブ動画</h1>
    <p class="subtitle">
      ご購入時のメールアドレスを入力してください。<br>
      購入内容に応じた動画をご視聴いただけます。
    </p>
    <div class="form-box">
      <form id="archiveForm">
        <label for="email">メールアドレス</label>
        <input type="email" id="email" name="email" placeholder="example@mail.com" required autocomplete="email">
        <button type="submit" class="btn" id="submitBtn">動画を見る</button>
      </form>
      <div class="error" id="errorMsg"></div>
    </div>
    <p class="note">
      ※ Stripe決済時に使用したメールアドレスをご入力ください。<br>
      ※ ご不明な場合はお問い合わせフォームよりご連絡ください。
    </p>
  </div>
  <script>
    const form = document.getElementById('archiveForm');
    const btn = document.getElementById('submitBtn');
    const errEl = document.getElementById('errorMsg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.style.display = 'none';
      btn.disabled = true;
      btn.textContent = '確認中...';
      try {
        const email = document.getElementById('email').value.trim();
        const res = await fetch('/archive/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '認証に失敗しました');
        }
        const html = await res.text();
        document.open();
        document.write(html);
        document.close();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '動画を見る';
      }
    });
  </script>
</body>
</html>`;
  res.type('html').send(html);
});

// アーカイブ: メール認証 → 動画ページ
app.post('/archive/verify', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'メールアドレスを入力してください' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Stripe Checkout Sessionsから購入履歴を検索
    const allSessions = [];
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;

      const checkoutSessions = await stripe.checkout.sessions.list(params);

      for (const session of checkoutSessions.data) {
        if (session.payment_status !== 'paid') continue;

        const sessionEmail = (
          session.customer_details?.email ||
          session.customer_email ||
          ''
        ).trim().toLowerCase();

        if (sessionEmail !== normalizedEmail) continue;

        // line_itemsを取得
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        for (const item of lineItems.data) {
          const priceId = item.price?.id;
          if (priceId && AIFES_PRICE_MAP[priceId]) {
            allSessions.push({
              priceId,
              productName: AIFES_PRICE_MAP[priceId].name,
              sessions: AIFES_PRICE_MAP[priceId].sessions
            });
          }
        }
      }

      hasMore = checkoutSessions.has_more;
      if (checkoutSessions.data.length > 0) {
        startingAfter = checkoutSessions.data[checkoutSessions.data.length - 1].id;
      }
    }

    if (allSessions.length === 0) {
      return res.status(404).json({
        error: 'このメールアドレスでの購入履歴が見つかりませんでした。購入時のメールアドレスをご確認ください。'
      });
    }

    // 重複除去してセッション一覧を作成
    const purchasedProducts = [];
    const grantedSessions = new Set();
    const seenPriceIds = new Set();

    for (const purchase of allSessions) {
      if (!seenPriceIds.has(purchase.priceId)) {
        seenPriceIds.add(purchase.priceId);
        purchasedProducts.push(purchase.productName);
        purchase.sessions.forEach(s => grantedSessions.add(s));
      }
    }

    const sortedSessions = Array.from(grantedSessions).sort();

    // 動画ページHTMLを生成
    const videoCards = sortedSessions.map(key => {
      const s = AIFES_SESSIONS[key];
      if (!s) return '';
      const hasVideo = s.youtubeId && s.youtubeId !== 'XXXXXX';
      return `
        <div class="video-card">
          <div class="video-wrapper">
            ${hasVideo
              ? `<iframe src="https://www.youtube.com/embed/${s.youtubeId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
              : `<div class="video-placeholder">準備中</div>`
            }
          </div>
          <div class="video-info">
            <h3>${s.name}</h3>
            <p>${s.desc}</p>
          </div>
        </div>`;
    }).join('');

    const productListHtml = purchasedProducts.map(p => `<span class="tag">${p}</span>`).join('');

    const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI FES. 2026 アーカイブ動画</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif;
      background: #0a0a1a;
      min-height: 100vh;
      color: #fff;
    }
    .header {
      background: linear-gradient(135deg, rgba(102,126,234,0.15), rgba(118,75,162,0.15));
      border-bottom: 1px solid rgba(255,255,255,0.08);
      padding: 24px 20px;
      text-align: center;
    }
    .header .logo {
      font-size: 12px;
      letter-spacing: 4px;
      color: #667eea;
      text-transform: uppercase;
    }
    .header h1 {
      font-size: 22px;
      margin-top: 4px;
      font-weight: 700;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 32px 20px 60px;
    }
    .purchase-info {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 32px;
    }
    .purchase-info .label {
      font-size: 12px;
      color: #888;
      margin-bottom: 8px;
    }
    .tag {
      display: inline-block;
      background: rgba(102,126,234,0.2);
      border: 1px solid rgba(102,126,234,0.3);
      color: #a5b4fc;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 13px;
      margin: 4px 4px 4px 0;
    }
    .video-card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 24px;
      transition: border-color 0.2s;
    }
    .video-card:hover {
      border-color: rgba(102,126,234,0.3);
    }
    .video-wrapper {
      position: relative;
      padding-bottom: 56.25%; /* 16:9 */
      background: #111;
    }
    .video-wrapper iframe {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
    }
    .video-placeholder {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #555;
      font-size: 18px;
    }
    .video-info {
      padding: 16px 20px;
    }
    .video-info h3 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .video-info p {
      font-size: 13px;
      color: #888;
    }
    .warning {
      margin-top: 32px;
      padding: 16px;
      background: rgba(255,193,7,0.1);
      border: 1px solid rgba(255,193,7,0.2);
      border-radius: 8px;
      font-size: 13px;
      color: #ffd54f;
      line-height: 1.6;
    }
    .footer-note {
      margin-top: 24px;
      text-align: center;
      font-size: 12px;
      color: #444;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">AI FES. 2026</div>
    <h1>アーカイブ動画</h1>
  </div>
  <div class="container">
    <div class="purchase-info">
      <div class="label">ご購入商品</div>
      ${productListHtml}
    </div>
    ${videoCards}
    <div class="warning">
      ⚠️ この動画は購入者様専用です。URLの共有・動画のダウンロード・再配布はご遠慮ください。
    </div>
    <div class="footer-note">
      AI×建築サークル / AI FES. 2026
    </div>
  </div>
</body>
</html>`;

    res.type('html').send(html);

  } catch (err) {
    console.error('[archive/verify] Error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました。時間をおいて再度お試しください。' });
  }
});

// ------- リード獲得API（LP → ドリップキャンペーン連携） -------
app.post('/api/capture', async (req, res) => {
  try {
    const { email, name, company } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'メールアドレスは必須です' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const leadData = {
      email: normalizedEmail,
      name: (name || '').trim(),
      company: (company || '').trim(),
      source: req.body.source || 'landing_page',
      capturedAt: new Date().toISOString(),
      dripStep: 0,
      dripStartedAt: null,
      status: 'new'
    };

    // Firestoreに保存
    if (firestore) {
      const existingSnap = await firestore.collection('leads')
        .where('email', '==', normalizedEmail).limit(1).get();

      if (!existingSnap.empty) {
        // 既存リードはDB追加しないが、ガイドメールは再送する
        console.log(`[capture] Existing lead (resending guide): ${normalizedEmail}`);
      } else {
        await firestore.collection('leads').add(leadData);
        console.log(`[capture] New lead: ${normalizedEmail} (${leadData.company})`);
      }
    }

    // drip_state.jsonにも追加（ドリップキャンペーン用）
    const stateFile = path.join(__dirname, 'data', 'drip_state.json');
    let state = { leads: [] };
    try {
      if (require('fs').existsSync(stateFile)) {
        state = JSON.parse(require('fs').readFileSync(stateFile, 'utf8'));
      }
    } catch (_) { /* ignore */ }

    const exists = state.leads.some(l => l.email === normalizedEmail);
    if (!exists) {
      state.leads.push({
        email: normalizedEmail,
        name: leadData.name,
        company: leadData.company,
        joinedAt: leadData.capturedAt,
        currentStep: 0,
        completedSteps: [],
        lastSentAt: null
      });
      const dataDir = path.join(__dirname, 'data');
      if (!require('fs').existsSync(dataDir)) {
        require('fs').mkdirSync(dataDir, { recursive: true });
      }
      require('fs').writeFileSync(stateFile, JSON.stringify(state, null, 2));
    }

    // ウェルカムメール即時送信（ガイドDLリンク付き）
    if (gmailTransporter) {
      const displayName = leadData.name || '\u3054\u62C5\u5F53\u8005';
      const unsubUrl = `https://stripe-discord-pro-417218426761.asia-northeast1.run.app/api/unsubscribe?email=${encodeURIComponent(normalizedEmail)}`;
      const emailHtml = [
        '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>',
        '<div style="font-family:\'Helvetica Neue\',\'Hiragino Kaku Gothic ProN\',\'Hiragino Sans\',Meiryo,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">',
        '<div style="background:#050505;padding:32px 24px;text-align:center;">',
        '<div style="display:inline-block;background:#ff3300;color:#fff;font-weight:bold;font-size:18px;padding:8px 16px;letter-spacing:-0.5px;">AI</div>',
        '<span style="color:#fff;font-weight:bold;font-size:14px;margin-left:12px;letter-spacing:1px;">ARCHI-CIRCLE</span>',
        '</div>',
        '<div style="padding:32px 24px;">',
        `<p style="font-size:16px;line-height:1.8;">${displayName} \u69D8</p>`,
        '<p style="font-size:15px;line-height:1.8;">',
        'AI\u5EFA\u7BC9\u30B5\u30FC\u30AF\u30EB\u306E\u6AFB\u672C\u3067\u3059\u3002<br>',
        '\u7121\u6599\u30AC\u30A4\u30C9\u306E\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u30EA\u30AF\u30A8\u30B9\u30C8\u3001\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3059\u3002',
        '</p>',
        '<div style="background:#f8f8f8;border-left:4px solid #ff3300;padding:20px 24px;margin:24px 0;">',
        '<p style="font-size:14px;font-weight:bold;margin:0 0 8px;">2025\u5E744\u6708\u65BD\u884C \u5EFA\u7BC9\u57FA\u6E96\u6CD5\u6539\u6B63 \u5B8C\u5168\u5BFE\u5FDC\u30AC\u30A4\u30C9</p>',
        '<p style="font-size:13px;color:#666;margin:0;">4\u53F7\u7279\u4F8B\u7E2E\u5C0F\u30FB\u7701\u30A8\u30CD\u9069\u5408\u7FA9\u52D9\u5316\u306E\u5168\u8C8C\u3068\u3001AI\u3067\u5BFE\u5FDC\u30B3\u30B9\u30C8\u30921/10\u306B\u3059\u308B\u65B9\u6CD5</p>',
        '</div>',
        '<div style="text-align:center;margin:32px 0;">',
        '<a href="https://ai-archi-circle.archi-prisma.co.jp/guide/" style="display:inline-block;background:#ff3300;color:#fff;font-weight:bold;font-size:15px;padding:14px 40px;text-decoration:none;border-radius:6px;">',
        '\u30AC\u30A4\u30C9\u3092\u8AAD\u3080 \u2192',
        '</a></div>',
        '<hr style="border:none;border-top:1px solid #eee;margin:32px 0;">',
        '<p style="font-size:14px;line-height:1.8;color:#444;">',
        '<strong>\u3055\u3089\u306B\u8A73\u3057\u304F\u77E5\u308A\u305F\u3044\u65B9\u3078</strong><br>',
        'AI\u5EFA\u7BC9\u30B5\u30FC\u30AF\u30EB\u3067\u306F\u3001\u6CD5\u6539\u6B63\u5BFE\u5FDC\u3060\u3051\u3067\u306A\u304F\u3001\u69CB\u9020\u8A08\u7B97\u30FB\u7701\u30A8\u30CD\u8A08\u7B97\u3092AI\u3067\u52B9\u7387\u5316\u3059\u308B\u30C4\u30FC\u30EB\u3068\u67082\u56DE\u306E\u30E9\u30A4\u30D6\u52C9\u5F37\u4F1A\u3067\u3001\u5EFA\u7BC9\u5B9F\u52D9\u3092\u5909\u3048\u308B\u30CE\u30A6\u30CF\u30A6\u3092\u63D0\u4F9B\u3057\u3066\u3044\u307E\u3059\u3002',
        '</p>',
        '<div style="text-align:center;margin:24px 0;">',
        '<a href="https://ai-archi-circle.archi-prisma.co.jp/#pricing" style="display:inline-block;border:2px solid #ff3300;color:#ff3300;font-weight:bold;font-size:14px;padding:12px 32px;text-decoration:none;border-radius:6px;">',
        '\u30B5\u30FC\u30AF\u30EB\u8A73\u7D30\u3092\u898B\u308B',
        '</a></div>',
        '<p style="font-size:12px;color:#999;margin-top:32px;line-height:1.6;">',
        `\u3053\u306E\u30E1\u30FC\u30EB\u306F ${normalizedEmail} \u5B9B\u306B\u304A\u9001\u308A\u3057\u3066\u3044\u307E\u3059\u3002<br>`,
        `<a href="${unsubUrl}" style="color:#999;text-decoration:underline;">\u914D\u4FE1\u505C\u6B62\u306F\u3053\u3061\u3089</a><br><br>`,
        'AI Archi Circle / Archi-Prisma Design Works<br>',
        '\u4EE3\u8868: \u6AFB\u672C\u8056\u6210',
        '</p></div></div></body></html>'
      ].join('\n');
      try {
        await gmailTransporter.sendMail({
          from: '"AI Archi Circle" <' + process.env.GMAIL_USER + '>',
          to: normalizedEmail,
          subject: '\u30102025\u5E744\u6708\u65BD\u884C\u3011\u5EFA\u7BC9\u57FA\u6E96\u6CD5\u6539\u6B63 \u5B8C\u5168\u5BFE\u5FDC\u30AC\u30A4\u30C9',
          textEncoding: 'base64',
          html: emailHtml
        });
        console.log(`[capture] Welcome email sent to: ${normalizedEmail}`);
      } catch (mailErr) {
        console.error(`[capture] Failed to send welcome email to ${normalizedEmail}:`, mailErr.message);
        // メール送信失敗してもリード登録自体は成功扱い
      }
    } else {
      console.warn('[capture] Gmail transporter not configured – skipping welcome email');
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[capture] Error:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// ------- 配信停止 -------
app.get('/api/unsubscribe', async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).send('Invalid request');
  try {
    if (firestore) {
      const snap = await firestore.collection('leads').where('email', '==', email).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({ status: 'unsubscribed', unsubscribedAt: new Date().toISOString() });
      }
    }
    const stateFile = path.join(__dirname, 'data', 'drip_state.json');
    try {
      const fs = require('fs');
      if (fs.existsSync(stateFile)) {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        const lead = state.leads.find(l => l.email === email);
        if (lead) { lead.completedSteps = [1,2,3,4,5,6,7]; lead.unsubscribed = true; }
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      }
    } catch (_) { /* ignore */ }
    console.log(`[unsubscribe] ${email}`);
    res.send('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fafafa;"><div style="text-align:center;"><h2>Unsubscribed</h2><p style="color:#666;margin-top:12px;">The email distribution has been stopped.</p></div></body></html>');
  } catch (err) {
    console.error('[unsubscribe] Error:', err);
    res.status(500).send('Error');
  }
});

// ------- ドリップキャンペーン自動実行（Cloud Scheduler用） -------
app.post('/api/drip/run', async (req, res) => {
  // Cloud Scheduler認証: OIDCトークン or シンプルなシークレットキー
  const authHeader = req.headers['authorization'] || '';
  const schedulerSecret = process.env.SCHEDULER_SECRET || '';
  if (schedulerSecret && authHeader !== `Bearer ${schedulerSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const drip = require('./drip_campaign');
    await drip.processLeads();
    res.json({ ok: true, message: 'Drip campaign processed' });
  } catch (err) {
    console.error('[drip/run] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drip/status', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const schedulerSecret = process.env.SCHEDULER_SECRET || '';
  if (schedulerSecret && authHeader !== `Bearer ${schedulerSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const stateFile = path.join(__dirname, 'data', 'drip_state.json');
    const fs = require('fs');
    if (!fs.existsSync(stateFile)) return res.json({ leads: 0, lastProcessed: null });
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    res.json({
      leads: state.leads.length,
      lastProcessed: state.lastProcessed || null,
      summary: state.leads.map(l => ({
        email: l.email,
        step: (l.completedSteps || []).length,
        total: 7
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------- 紹介リンク取得ページ -------
app.get('/referral', (_req, res) => {
  const html = `
<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>紹介プログラム - AI×建築サークル</title>
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
    padding: 24px;
  }
  .page-wrapper {
    max-width: 560px;
    width: 100%;
  }

  /* ---------- Header ---------- */
  .header {
    text-align: center;
    margin-bottom: 24px;
  }
  .header-badge {
    display: inline-block;
    background: #ff3300;
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 4px 14px;
    border-radius: 100px;
    margin-bottom: 14px;
    text-transform: uppercase;
  }
  .header h1 {
    font-size: 1.9rem;
    font-weight: 800;
    margin-bottom: 6px;
    line-height: 1.3;
  }
  .header .subtitle {
    color: #666;
    font-size: 0.95rem;
  }

  /* ---------- Card ---------- */
  .card {
    background: #fff;
    border-radius: 12px;
    border: 1px solid #e9ecef;
    box-shadow: 0 8px 30px rgba(0,0,0,0.08);
    padding: 36px 28px;
    margin-bottom: 16px;
  }
  .card + .card { margin-top: 0; }

  /* ---------- Benefits ---------- */
  .benefits-title {
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #999;
    margin-bottom: 16px;
  }
  .benefit-row {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 16px 0;
  }
  .benefit-row + .benefit-row {
    border-top: 1px solid #f0f0f0;
  }
  .benefit-icon {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.3rem;
  }
  .benefit-icon.you {
    background: #ff33000f;
    border: 1.5px solid #ff330030;
  }
  .benefit-icon.friend {
    background: #1976d20f;
    border: 1.5px solid #1976d230;
  }
  .benefit-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: #999;
    margin-bottom: 2px;
  }
  .benefit-value {
    font-size: 1.05rem;
    font-weight: 700;
    color: #222;
    line-height: 1.4;
  }
  .benefit-value .accent { color: #ff3300; }
  .benefit-desc {
    font-size: 0.8rem;
    color: #888;
    margin-top: 2px;
  }

  /* ---------- Form ---------- */
  .form-section { margin-top: 8px; }
  .input-group {
    position: relative;
    margin-bottom: 14px;
  }
  .input-group input {
    width: 100%;
    padding: 15px 16px;
    border-radius: 8px;
    border: 2px solid #e9ecef;
    font-size: 1rem;
    transition: border-color 0.2s;
    outline: none;
    background: #fafafa;
  }
  .input-group input:focus {
    border-color: #222;
    background: #fff;
  }
  .generate-btn {
    display: block;
    width: 100%;
    padding: 16px;
    background: #222;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 1.05rem;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.2s;
  }
  .generate-btn:hover { background: #000; }
  .generate-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .error-text {
    color: #dc3545;
    font-size: 0.85rem;
    margin-top: 10px;
    display: none;
    text-align: center;
  }

  /* ---------- Result ---------- */
  .result-section { display: none; }
  .link-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 10px;
  }
  .link-display {
    display: flex;
    align-items: center;
    gap: 0;
    border: 2px solid #222;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 20px;
  }
  .link-display .link-text {
    flex: 1;
    padding: 14px 16px;
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.82rem;
    word-break: break-all;
    background: #fafafa;
    color: #333;
    line-height: 1.4;
    border: none;
    min-height: unset;
  }
  .link-display .copy-btn {
    flex-shrink: 0;
    padding: 14px 20px;
    background: #222;
    color: #fff;
    border: none;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
    white-space: nowrap;
  }
  .link-display .copy-btn:hover { background: #000; }
  .link-display .copy-btn.copied {
    background: #2e7d32;
  }

  /* ---------- Share Buttons ---------- */
  .share-section {
    margin-bottom: 24px;
  }
  .share-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 10px;
  }
  .share-buttons {
    display: flex;
    gap: 10px;
  }
  .share-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    border: none;
    transition: opacity 0.2s;
  }
  .share-btn:hover { opacity: 0.85; }
  .share-btn.x-btn {
    background: #0f1419;
    color: #fff;
  }
  .share-btn.line-btn {
    background: #06C755;
    color: #fff;
  }
  .share-btn svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  /* ---------- Stats ---------- */
  .stats-row {
    display: flex;
    gap: 12px;
    margin-top: 4px;
  }
  .stat-card {
    flex: 1;
    background: #f8f9fa;
    border-radius: 10px;
    padding: 18px 12px;
    text-align: center;
    border: 1px solid #eee;
  }
  .stat-number {
    font-size: 2rem;
    font-weight: 800;
    color: #222;
    line-height: 1;
    margin-bottom: 4px;
  }
  .stat-number.accent { color: #ff3300; }
  .stat-unit {
    font-size: 0.9rem;
    font-weight: 700;
    color: #222;
  }
  .stat-label {
    font-size: 0.75rem;
    color: #999;
    margin-top: 4px;
  }

  /* ---------- How It Works ---------- */
  .how-section {
    padding: 0;
  }
  .how-title {
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #999;
    margin-bottom: 16px;
  }
  .step-list {
    list-style: none;
    counter-reset: steps;
  }
  .step-list li {
    counter-increment: steps;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 10px 0;
    font-size: 0.9rem;
    color: #555;
    line-height: 1.5;
  }
  .step-list li::before {
    content: counter(steps);
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #222;
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 1px;
  }

  /* ---------- Back Link ---------- */
  .back-link {
    display: block;
    text-align: center;
    margin-top: 20px;
    color: #999;
    text-decoration: none;
    font-size: 0.85rem;
    transition: color 0.2s;
  }
  .back-link:hover { color: #333; }

  /* ---------- Responsive ---------- */
  @media (max-width: 480px) {
    body { padding: 16px; }
    .card { padding: 28px 20px; }
    .header h1 { font-size: 1.6rem; }
    .share-buttons { flex-direction: column; }
    .stat-number { font-size: 1.6rem; }
    .link-display { flex-direction: column; }
    .link-display .copy-btn { width: 100%; padding: 12px; }
  }
</style>

<div class="page-wrapper">

  <!-- Header -->
  <div class="header">
    <span class="header-badge">Member Referral</span>
    <h1>紹介プログラム</h1>
    <p class="subtitle">仲間を紹介して、おトクに活動しよう</p>
  </div>

  <!-- Benefits Card -->
  <div class="card">
    <div class="benefits-title">特典内容</div>

    <div class="benefit-row">
      <div class="benefit-icon you">
        <span>&#127873;</span>
      </div>
      <div>
        <div class="benefit-label">あなた（紹介者）</div>
        <div class="benefit-value">月額 <span class="accent">&yen;1,000 OFF</span></div>
        <div class="benefit-desc">紹介された方が加入している間ずっと適用</div>
      </div>
    </div>

    <div class="benefit-row">
      <div class="benefit-icon friend">
        <span>&#127775;</span>
      </div>
      <div>
        <div class="benefit-label">お友達（被紹介者）</div>
        <div class="benefit-value">初月 <span class="accent">&yen;1,000 OFF</span></div>
        <div class="benefit-desc">入会時に自動で割引が適用されます</div>
      </div>
    </div>
  </div>

  <!-- Form / Result Card -->
  <div class="card">

    <!-- Form (before generating link) -->
    <div class="form-section" id="form-section">
      <div class="input-group">
        <input type="email" id="ref-email" placeholder="登録メールアドレスを入力" required>
      </div>
      <button class="generate-btn" id="generate-btn" onclick="generateLink()">紹介リンクを取得</button>
      <p class="error-text" id="ref-error"></p>
    </div>

    <!-- Result (after generating link) -->
    <div class="result-section" id="result-section">
      <div class="link-label">あなたの紹介リンク</div>
      <div class="link-display">
        <div class="link-text" id="ref-link"></div>
        <button class="copy-btn" id="copy-btn" onclick="copyLink()">コピー</button>
      </div>

      <!-- Share Buttons -->
      <div class="share-section">
        <div class="share-label">シェアする</div>
        <div class="share-buttons">
          <a class="share-btn x-btn" id="share-x" href="#" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            X (Twitter)
          </a>
          <a class="share-btn line-btn" id="share-line" href="#" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
            LINE
          </a>
        </div>
      </div>

      <!-- Stats -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-number" id="ref-count">0</div>
          <div class="stat-unit">人</div>
          <div class="stat-label">紹介成功</div>
        </div>
        <div class="stat-card">
          <div class="stat-number accent" id="ref-discount">&yen;0</div>
          <div class="stat-unit">/ 月</div>
          <div class="stat-label">現在の割引額</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" id="ref-code-display" style="font-size:1rem; margin-top:8px;">-</div>
          <div class="stat-label" style="margin-top:8px;">あなたのコード</div>
        </div>
      </div>
    </div>

  </div>

  <!-- How It Works Card -->
  <div class="card how-section">
    <div class="how-title">ご利用の流れ</div>
    <ol class="step-list">
      <li>上記フォームで紹介リンクを取得</li>
      <li>リンクをSNS・メール・LINEで友達にシェア</li>
      <li>友達がリンク経由で入会すると割引が自動適用</li>
      <li>紹介人数に制限なし &#8212; 紹介するほどおトク</li>
    </ol>
  </div>

  <a class="back-link" href="/">&larr; トップへ戻る</a>
</div>

<script>
  async function generateLink() {
    var email = document.getElementById('ref-email').value;
    var btn = document.getElementById('generate-btn');
    var errDiv = document.getElementById('ref-error');
    errDiv.style.display = 'none';
    btn.disabled = true;
    btn.textContent = '取得中...';

    try {
      var resp = await fetch('/api/referral/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      });
      var data = await resp.json();

      if (!resp.ok) {
        errDiv.textContent = data.error || 'エラーが発生しました';
        errDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '紹介リンクを取得';
        return;
      }

      var refCount = data.referrals || 0;
      var discount = refCount * 1000;

      document.getElementById('ref-link').textContent = data.link;
      document.getElementById('ref-count').textContent = refCount;
      document.getElementById('ref-discount').textContent = '\u00A5' + discount.toLocaleString();
      document.getElementById('ref-code-display').textContent = data.code;
      document.getElementById('form-section').style.display = 'none';
      document.getElementById('result-section').style.display = 'block';

      // Set up share URLs
      var shareText = 'AI×建築サークルに一緒に入りませんか？紹介リンクから入会すると初月￥1,000 OFF！';
      var link = encodeURIComponent(data.link);
      var text = encodeURIComponent(shareText);

      document.getElementById('share-x').href = 'https://twitter.com/intent/tweet?text=' + text + '%0A' + link;
      document.getElementById('share-line').href = 'https://social-plugins.line.me/lineit/share?url=' + link + '&text=' + text;
    } catch (e) {
      errDiv.textContent = 'ネットワークエラー';
      errDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = '紹介リンクを取得';
    }
  }

  function copyLink() {
    var link = document.getElementById('ref-link').textContent;
    navigator.clipboard.writeText(link).then(function() {
      var btn = document.getElementById('copy-btn');
      btn.textContent = 'コピーしました';
      btn.classList.add('copied');
      setTimeout(function() {
        btn.textContent = 'コピー';
        btn.classList.remove('copied');
      }, 2000);
    });
  }

  // Allow Enter key to submit
  document.getElementById('ref-email').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      generateLink();
    }
  });
</script>
  `;
  res.type('html').send(html);
});

// ------- リファラル（会員紹介）API -------
app.post('/api/referral/generate', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'メールアドレスは必須です' });

    const normalizedEmail = email.trim().toLowerCase();

    // 既存会員か確認（Stripeで検索）
    const customers = await stripe.customers.list({ email: normalizedEmail, limit: 1 });
    if (customers.data.length === 0) {
      return res.status(404).json({ error: '会員が見つかりません' });
    }
    const customer = customers.data[0];

    // 既にリファラルコードがあるか確認
    if (firestore) {
      const existingRef = await firestore.collection('referrals')
        .where('referrerEmail', '==', normalizedEmail).limit(1).get();

      if (!existingRef.empty) {
        const existing = existingRef.docs[0].data();
        return res.json({
          ok: true,
          code: existing.code,
          referrals: existing.referrals || 0,
          link: `${req.protocol}://${req.get('host')}/?ref=${existing.code}`
        });
      }
    }

    // 新規リファラルコード生成
    const code = `REF-${customer.name ? customer.name.replace(/\s/g, '').slice(0, 4).toUpperCase() : 'ARCHI'}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // Stripeクーポン作成（紹介者特典：次月1,000円OFF）
    let couponId = null;
    try {
      const coupon = await stripe.coupons.create({
        amount_off: 1000,
        currency: 'jpy',
        duration: 'once',
        name: `紹介特典 (${code})`,
        metadata: { referral_code: code, referrer_email: normalizedEmail }
      });
      couponId = coupon.id;
    } catch (err) {
      console.warn('[referral] Coupon creation failed:', err.message);
    }

    // Firestore保存
    if (firestore) {
      await firestore.collection('referrals').add({
        referrerEmail: normalizedEmail,
        referrerCustomerId: customer.id,
        code,
        couponId,
        referrals: 0,
        rewardsClaimed: 0,
        createdAt: new Date().toISOString()
      });
    }

    console.log(`[referral] Generated code ${code} for ${normalizedEmail}`);
    res.json({
      ok: true,
      code,
      referrals: 0,
      link: `${req.protocol}://${req.get('host')}/?ref=${code}`
    });
  } catch (err) {
    console.error('[referral] Error:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// リファラルコード検証（入会時に使用）
app.get('/api/referral/verify/:code', async (req, res) => {
  try {
    const { code } = req.params;
    if (!firestore) return res.status(500).json({ error: 'DB未初期化' });

    const snap = await firestore.collection('referrals')
      .where('code', '==', code).limit(1).get();

    if (snap.empty) {
      return res.status(404).json({ error: '無効なコードです' });
    }

    const ref = snap.docs[0];
    const data = ref.data();

    res.json({
      ok: true,
      valid: true,
      couponId: data.couponId,
      referrerName: data.referrerEmail.split('@')[0]
    });
  } catch (err) {
    console.error('[referral/verify] Error:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// リファラル成功時（新規入会完了後に呼ぶ）
app.post('/api/referral/complete', async (req, res) => {
  try {
    const { code, newMemberEmail } = req.body;
    if (!code || !newMemberEmail || !firestore) {
      return res.status(400).json({ error: 'パラメータ不足' });
    }

    const snap = await firestore.collection('referrals')
      .where('code', '==', code).limit(1).get();

    if (snap.empty) {
      return res.status(404).json({ error: '無効なコードです' });
    }

    const ref = snap.docs[0];
    const data = ref.data();

    // 紹介数をインクリメント
    await ref.ref.update({
      referrals: (data.referrals || 0) + 1,
      lastReferralAt: new Date().toISOString()
    });

    // 紹介者にクーポン適用（Stripeのサブスクに次回割引）
    if (data.couponId && data.referrerCustomerId) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: data.referrerCustomerId,
          status: 'active',
          limit: 1
        });
        if (subs.data.length > 0) {
          await stripe.subscriptions.update(subs.data[0].id, {
            coupon: data.couponId
          });
          console.log(`[referral] Applied coupon to ${data.referrerEmail}`);
        }
      } catch (err) {
        console.warn('[referral] Coupon apply failed:', err.message);
      }
    }

    console.log(`[referral] Completed: ${code} → ${newMemberEmail}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[referral/complete] Error:', err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

// ------- 公開メンバー数API -------
app.get('/api/stats', async (_req, res) => {
  try {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=3600'); // 1時間キャッシュ

    const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 });
    const activeCount = subs.data.filter(sub =>
      sub.items.data.some(item => ENTITLED_PRICE_IDS.has(item.price.id))
    ).length;

    res.json({ members: activeCount, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[stats] Error:', err.message);
    res.json({ members: 28, updatedAt: new Date().toISOString() }); // fallback
  }
});

// ------- 既存月額会員への年間プラン案内メール送信 -------
app.post('/admin/send-annual-upgrade', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${CFG.SCHEDULER_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!gmailTransporter) {
    return res.status(500).json({ error: 'Gmail transporter not configured' });
  }

  try {
    // アクティブな月額サブスクリプションの顧客を取得
    const subs = [];
    let hasMore = true;
    let startingAfter;
    while (hasMore) {
      const params = { status: 'active', limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;
      const batch = await stripe.subscriptions.list(params);
      subs.push(...batch.data);
      hasMore = batch.has_more;
      if (batch.data.length > 0) startingAfter = batch.data[batch.data.length - 1].id;
    }

    // 月額プランの会員のみフィルタ（年額は除外）
    const monthlyPriceId = PRICE_IDS.monthly;
    const studentPriceId = PRICE_IDS.student;
    const yearlyPriceId = PRICE_IDS.yearly;

    const monthlySubs = subs.filter(sub => {
      const priceIds = sub.items.data.map(item => item.price.id);
      return priceIds.includes(monthlyPriceId) || priceIds.includes(studentPriceId);
    });

    const base = 'https://stripe-discord-pro-417218426761.asia-northeast1.run.app';
    let sent = 0;
    let errors = 0;

    for (const sub of monthlySubs) {
      const customer = await stripe.customers.retrieve(sub.customer);
      if (!customer.email) continue;

      const emailHtml = [
        '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>',
        '<div style="font-family:\'Helvetica Neue\',\'Hiragino Kaku Gothic ProN\',\'Hiragino Sans\',Meiryo,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">',
        '<div style="background:#050505;padding:32px 24px;text-align:center;">',
        '<div style="display:inline-block;background:#ff3300;color:#fff;font-weight:bold;font-size:18px;padding:8px 16px;letter-spacing:-0.5px;">AI</div>',
        '<span style="color:#fff;font-weight:bold;font-size:14px;margin-left:12px;letter-spacing:1px;">ARCHI-CIRCLE</span>',
        '</div>',
        '<div style="padding:32px 24px;">',
        `<p style="font-size:16px;line-height:1.8;">${customer.name || '\u3054\u62C5\u5F53\u8005'}\u69D8</p>`,
        '<p style="font-size:15px;line-height:1.8;">',
        '\u3044\u3064\u3082AI\u5EFA\u7BC9\u30B5\u30FC\u30AF\u30EB\u3092\u3054\u5229\u7528\u3044\u305F\u3060\u304D\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3059\u3002<br>\u6AFB\u672C\u3067\u3059\u3002',
        '</p>',
        '<p style="font-size:15px;line-height:1.8;">',
        '\u4F1A\u54E1\u306E\u7686\u3055\u307E\u304B\u3089\u306E\u3054\u8981\u671B\u3092\u53D7\u3051\u3001<strong>\u5E74\u9593\u30D7\u30E9\u30F3</strong>\u3092\u3054\u7528\u610F\u3057\u307E\u3057\u305F\u3002',
        '</p>',
        '<div style="background:#f8f8f8;border:2px solid #ff3300;border-radius:8px;padding:24px;margin:24px 0;text-align:center;">',
        '<p style="font-size:13px;color:#ff3300;font-weight:bold;margin:0 0 8px;letter-spacing:1px;">\u5E74\u9593\u30D7\u30E9\u30F3</p>',
        '<p style="font-size:36px;font-weight:800;margin:0;line-height:1;">&yen;50,000<span style="font-size:14px;color:#666;font-weight:normal;"> / \u5E74\uFF08\u7A0E\u8FBC\uFF09</span></p>',
        '<p style="font-size:14px;color:#ff3300;font-weight:600;margin:8px 0 0;">\u6708\u3042\u305F\u308A\u7D04&yen;4,167 \u2015 \u5E74\u9593&yen;10,000\u304A\u5F97</p>',
        '</div>',
        '<table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">',
        '<tr style="border-bottom:1px solid #eee;">',
        '<td style="padding:10px 0;color:#666;">\u73FE\u5728\u306E\u6708\u984D\u30D7\u30E9\u30F3</td>',
        '<td style="padding:10px 0;text-align:right;font-weight:600;">&yen;5,000 \u00D7 12\u30F6\u6708 = <span style="color:#999;text-decoration:line-through;">&yen;60,000</span></td>',
        '</tr>',
        '<tr>',
        '<td style="padding:10px 0;color:#666;">\u5E74\u9593\u30D7\u30E9\u30F3</td>',
        '<td style="padding:10px 0;text-align:right;font-weight:700;color:#ff3300;">&yen;50,000\uFF08&yen;10,000\u304A\u5F97\uFF09</td>',
        '</tr>',
        '</table>',
        '<p style="font-size:14px;line-height:1.8;color:#444;">',
        '\u5207\u308A\u66FF\u3048\u306F\u4EFB\u610F\u3067\u3059\u3002\u73FE\u5728\u306E\u6708\u984D\u30D7\u30E9\u30F3\u3082\u5F15\u304D\u7D9A\u304D\u3054\u5229\u7528\u3044\u305F\u3060\u3051\u307E\u3059\u3002<br>',
        '\u5207\u308A\u66FF\u3048\u3092\u3054\u5E0C\u671B\u306E\u65B9\u306F\u3001\u4E0B\u306E\u30DC\u30BF\u30F3\u304B\u3089\u304A\u624B\u7D9A\u304D\u304F\u3060\u3055\u3044\u3002',
        '</p>',
        '<div style="text-align:center;margin:28px 0;">',
        `<a href="${base}/?plan=yearly" style="display:inline-block;background:#ff3300;color:#fff;font-weight:bold;font-size:15px;padding:14px 40px;text-decoration:none;border-radius:6px;">`,
        '\u5E74\u9593\u30D7\u30E9\u30F3\u306B\u5207\u308A\u66FF\u3048\u308B \u2192',
        '</a></div>',
        '<p style="font-size:12px;color:#999;margin-top:32px;line-height:1.6;">',
        '\u203B \u73FE\u5728\u306E\u30B5\u30D6\u30B9\u30AF\u30EA\u30D7\u30B7\u30E7\u30F3\u306F\u8ACB\u6C42\u7BA1\u7406\u30DA\u30FC\u30B8\u304B\u3089\u89E3\u7D04\u3067\u304D\u307E\u3059\u3002<br>',
        '\u5E74\u9593\u30D7\u30E9\u30F3\u3078\u306E\u5207\u308A\u66FF\u3048\u5F8C\u3001\u65E7\u30D7\u30E9\u30F3\u306F\u81EA\u52D5\u7684\u306B\u7D42\u4E86\u3057\u307E\u3059\u3002<br><br>',
        'AI Archi Circle / Archi-Prisma Design Works<br>',
        '\u4EE3\u8868: \u6AFB\u672C\u8056\u6210',
        '</p></div></div></body></html>'
      ].join('\n');

      try {
        await gmailTransporter.sendMail({
          from: '"AI Archi Circle" <' + process.env.GMAIL_USER + '>',
          to: customer.email,
          subject: '\u3010\u4F1A\u54E1\u9650\u5B9A\u3011\u5E74\u9593\u30D7\u30E9\u30F3\u304C\u767B\u5834 \u2015 \u5E74\u9593\uFFE510,000\u304A\u5F97\u306B',
          textEncoding: 'base64',
          html: emailHtml
        });
        sent++;
        console.log(`[annual-upgrade] Email sent to: ${customer.email}`);
      } catch (mailErr) {
        errors++;
        console.error(`[annual-upgrade] Failed: ${customer.email}:`, mailErr.message);
      }
    }

    res.json({ ok: true, totalMonthly: monthlySubs.length, sent, errors });
  } catch (err) {
    console.error('[annual-upgrade] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ------- サーバ起動 -------
app.listen(PORT, () => {
  console.log(`Listening on :${PORT} (mode=${CFG.STRIPE_MODE})`);
});
