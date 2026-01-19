'use strict';

/**
 * Stripe Webhookサーバー
 *
 * - checkout.session.completed を受信
 * - 署名検証（STRIPE_WEBHOOK_SECRET）
 * - 冪等性（processed_events.json で二重送信防止）
 * - 購入商品に応じてZoom登録リンクをメール送信
 * - SendGrid API使用、指数バックオフで最大3回リトライ
 */

require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');

// 環境変数
const STRIPE_MODE = process.env.STRIPE_MODE || 'test';
const STRIPE_SECRET_KEY = STRIPE_MODE === 'live'
  ? process.env.STRIPE_SECRET_KEY_LIVE
  : process.env.STRIPE_SECRET_KEY_TEST;
const STRIPE_WEBHOOK_SECRET = STRIPE_MODE === 'live'
  ? process.env.STRIPE_WEBHOOK_SECRET_LIVE
  : process.env.STRIPE_WEBHOOK_SECRET_TEST;

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL;
const SUPPORT_FORM_URL = process.env.SUPPORT_FORM_URL;

// Price ID（環境変数から取得）
const PRICE_ID_FULL_DAY = process.env.PRICE_ID_FULL_DAY;
const PRICE_ID_PRACTICAL_AI_ARCHITECTURE = process.env.PRICE_ID_PRACTICAL_AI_ARCHITECTURE;
const PRICE_ID_IMAGE_GEN_AI = process.env.PRICE_ID_IMAGE_GEN_AI;
const PRICE_ID_GOOGLE_HP_GAS = process.env.PRICE_ID_GOOGLE_HP_GAS;

// データファイルパス
const DATA_DIR = path.join(__dirname, '..', 'data');
const PROCESSED_EVENTS_JSON = path.join(DATA_DIR, 'processed_events.json');
const FAILED_EMAILS_JSON = path.join(DATA_DIR, 'failed_emails.json');
const ZOOM_MEETINGS_JSON = path.join(DATA_DIR, 'zoom_meetings.json');

// Stripeクライアント
const stripe = new Stripe(STRIPE_SECRET_KEY);

// Expressアプリ
const app = express();
const PORT = process.env.WEBHOOK_PORT || 3000;

// 商品名マッピング（price_id -> 正式商品名）
const PRODUCT_NAME_MAP = {
  [PRICE_ID_FULL_DAY]: 'AI FES. 参加チケット（1日通し）',
  [PRICE_ID_PRACTICAL_AI_ARCHITECTURE]: '第２回実務で使えるAI×建築セミナー',
  [PRICE_ID_IMAGE_GEN_AI]: '今使える画像生成AIセミナー（第２回開催）',
  [PRICE_ID_GOOGLE_HP_GAS]: 'Googleサービスでつくる無料HP＆業務自動化（GAS）セミナー（第１回開催）'
};

// Zoom登録リンク送付マッピング（price_id -> Meeting keys）
const ZOOM_LINK_MAP = {
  [PRICE_ID_FULL_DAY]: ['A', 'B', 'C', 'D', 'E', 'F'],
  [PRICE_ID_PRACTICAL_AI_ARCHITECTURE]: ['C', 'F'],
  [PRICE_ID_IMAGE_GEN_AI]: ['D', 'F'],
  [PRICE_ID_GOOGLE_HP_GAS]: ['E', 'F']
};

// Meeting key -> 正式名称
const MEETING_NAME_MAP = {
  'A': 'AI FES. 直近30日：最新AI Newsまとめ（建築業界向け sena流）',
  'B': 'AI FES. 自社プロダクト（COMPASS/SpotPDF/KAKOME）使い方',
  'C': '第２回実務で使えるAI×建築セミナー',
  'D': '今使える画像生成AIセミナー（第２回開催）',
  'E': 'Googleサービスでつくる無料HP＆業務自動化（GAS）セミナー（第１回開催）',
  'F': 'AI FES. プレゼント配布＋最終質問タイム＋AI×建築サークル案内'
};

/**
 * 処理済みイベントを読み込む
 */
function loadProcessedEvents() {
  if (!fs.existsSync(PROCESSED_EVENTS_JSON)) {
    return new Set();
  }
  const content = fs.readFileSync(PROCESSED_EVENTS_JSON, 'utf8');
  const data = JSON.parse(content);
  return new Set(data.processed || []);
}

/**
 * 処理済みイベントを保存
 */
function saveProcessedEvent(eventId) {
  const processed = loadProcessedEvents();
  processed.add(eventId);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  fs.writeFileSync(PROCESSED_EVENTS_JSON, JSON.stringify({
    processed: Array.from(processed),
    updated_at: new Date().toISOString()
  }, null, 2), 'utf8');
}

/**
 * 失敗したメールを記録
 */
function recordFailedEmail(email, productName, error) {
  let failed = [];
  if (fs.existsSync(FAILED_EMAILS_JSON)) {
    const content = fs.readFileSync(FAILED_EMAILS_JSON, 'utf8');
    failed = JSON.parse(content);
  }

  failed.push({
    email,
    product_name: productName,
    error: error.message || String(error),
    timestamp: new Date().toISOString()
  });

  fs.writeFileSync(FAILED_EMAILS_JSON, JSON.stringify(failed, null, 2), 'utf8');
}

/**
 * Zoom Meetingデータを読み込む
 */
function loadZoomMeetings() {
  if (!fs.existsSync(ZOOM_MEETINGS_JSON)) {
    console.error('[エラー] zoom_meetings.json が見つかりません');
    return {};
  }
  const content = fs.readFileSync(ZOOM_MEETINGS_JSON, 'utf8');
  return JSON.parse(content);
}

/**
 * Meeting keyからRegistration URLを取得
 */
function getRegistrationUrl(zoomMeetings, meetingKey) {
  const meetingName = MEETING_NAME_MAP[meetingKey];
  if (!meetingName) return null;

  const meeting = zoomMeetings[meetingName];
  if (!meeting) return null;

  return meeting.registration_url;
}

/**
 * SendGridでメール送信（指数バックオフで最大3回リトライ）
 */
async function sendEmailWithRetry(to, subject, htmlContent, maxRetries = 3) {
  const delays = [1000, 2000, 4000]; // 指数バックオフ

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SENDGRID_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: FROM_EMAIL },
          subject: subject,
          content: [{ type: 'text/html', value: htmlContent }]
        })
      });

      if (response.ok || response.status === 202) {
        console.log(`[メール送信成功] ${to}`);
        return true;
      }

      const text = await response.text();
      throw new Error(`SendGrid API Error: ${response.status} ${text}`);
    } catch (error) {
      console.error(`[メール送信失敗] attempt ${attempt + 1}/${maxRetries}: ${error.message}`);

      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      } else {
        throw error;
      }
    }
  }
}

/**
 * メール本文を生成
 */
function generateEmailContent(productName, meetingKeys, zoomMeetings) {
  const meetingSections = meetingKeys.map(key => {
    const name = MEETING_NAME_MAP[key];
    const url = getRegistrationUrl(zoomMeetings, key);

    return `
<tr>
  <td style="padding: 16px; border-bottom: 1px solid #e9ecef;">
    <p style="margin: 0 0 8px 0; font-weight: 600;">${name}</p>
    <p style="margin: 0;">
      <a href="${url}" style="color: #007bff; text-decoration: none;">Zoom登録はこちら</a>
    </p>
  </td>
</tr>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: 'Helvetica Neue', Arial, 'Noto Sans JP', sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #f8f9fa; border-radius: 8px; padding: 32px; margin-bottom: 24px;">
    <h1 style="margin: 0 0 16px 0; font-size: 24px; font-weight: 600;">AI FES. 参加情報（Zoom登録リンクのご案内）</h1>
    <p style="margin: 0; color: #666;">ご購入ありがとうございます</p>
  </div>

  <div style="margin-bottom: 24px;">
    <h2 style="font-size: 18px; margin: 0 0 12px 0; font-weight: 600;">ご購入商品</h2>
    <p style="margin: 0; padding: 16px; background: #e9ecef; border-radius: 4px; font-weight: 500;">
      ${productName}
    </p>
  </div>

  <div style="margin-bottom: 24px;">
    <h2 style="font-size: 18px; margin: 0 0 12px 0; font-weight: 600;">Zoom登録リンク</h2>
    <p style="margin: 0 0 16px 0; color: #666;">
      以下のリンクから各セッションに登録してください。
    </p>
    <table style="width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e9ecef; border-radius: 4px;">
      ${meetingSections}
    </table>
  </div>

  <!-- 超重要警告 -->
  <div style="background: linear-gradient(135deg, #dc3545, #c82333); border-radius: 8px; padding: 24px; margin-bottom: 24px; text-align: center;">
    <h3 style="margin: 0 0 12px 0; font-size: 20px; font-weight: bold; color: white;">!! 重要 !!</h3>
    <p style="margin: 0; color: white; font-size: 16px; line-height: 1.6;">
      Zoom登録は<strong>必ずこのメールアドレス</strong>で行ってください。<br>
      <span style="background: white; color: #dc3545; padding: 4px 12px; border-radius: 4px; display: inline-block; margin-top: 8px; font-weight: bold;">
        異なるメールアドレスでは参加できません
      </span>
    </p>
  </div>

  <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
    <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #856404;">確認事項</h3>
    <ul style="margin: 0; padding-left: 20px; color: #856404;">
      <li style="margin-bottom: 8px;"><strong>購入メールアドレス ＝ Zoom登録メールアドレス</strong>（必須）</li>
      <li style="margin-bottom: 8px;">登録後、Zoomから専用参加URLがメールで届きます</li>
      <li style="margin-bottom: 8px;">メールアドレスの入力間違いにご注意ください</li>
      <li style="margin-bottom: 0;">アーカイブ動画配布あり（配布方法は後日案内）</li>
    </ul>
  </div>

  <div style="border-top: 1px solid #e9ecef; padding-top: 24px; margin-top: 24px;">
    <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">
      ご不明な点がございましたら、以下よりお問い合わせください。
    </p>
    <p style="margin: 0;">
      <a href="${SUPPORT_FORM_URL}" style="color: #007bff; text-decoration: none;">お問い合わせフォーム</a>
    </p>
  </div>
</body>
</html>`;
}

/**
 * Webhook: checkout.session.completed を処理
 */
async function handleCheckoutCompleted(session) {
  // line_itemsを取得
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 100
  });

  // 購入者のメールアドレス
  const customerEmail = session.customer_details?.email || session.customer_email;

  if (!customerEmail) {
    console.error('[エラー] 購入者のメールアドレスが取得できません');
    return;
  }

  // 購入したprice_idを取得
  const purchasedPriceIds = lineItems.data.map(item => item.price?.id).filter(Boolean);

  console.log(`[購入者] ${customerEmail}`);
  console.log(`[購入Price IDs] ${purchasedPriceIds.join(', ')}`);

  // price_idから商品名とMeeting keysを取得
  let productName = null;
  let meetingKeys = new Set();

  for (const priceId of purchasedPriceIds) {
    const name = PRODUCT_NAME_MAP[priceId];
    const keys = ZOOM_LINK_MAP[priceId];

    if (name) {
      productName = name;
    }
    if (keys) {
      keys.forEach(k => meetingKeys.add(k));
    }
  }

  if (!productName || meetingKeys.size === 0) {
    console.log('[情報] 対象外の商品購入のためスキップ');
    return;
  }

  // Fは常に含める（共通）
  meetingKeys.add('F');

  // 順序を保持してソート（A, B, C, D, E, F の順）
  const sortedKeys = Array.from(meetingKeys).sort();

  console.log(`[商品名] ${productName}`);
  console.log(`[Zoom Sessions] ${sortedKeys.join(', ')}`);

  // Zoom Meetingデータを読み込む
  const zoomMeetings = loadZoomMeetings();

  // メール本文を生成
  const emailContent = generateEmailContent(productName, sortedKeys, zoomMeetings);

  // メール送信
  const subject = 'AI FES. 参加情報（Zoom登録リンクのご案内）';

  try {
    await sendEmailWithRetry(customerEmail, subject, emailContent);
  } catch (error) {
    console.error(`[メール送信最終失敗] ${customerEmail}: ${error.message}`);
    recordFailedEmail(customerEmail, productName, error);
  }
}

// Stripe Webhook（raw body必須）
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;

  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Webhook] 署名検証失敗:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 冪等性チェック
  const processedEvents = loadProcessedEvents();
  if (processedEvents.has(event.id)) {
    console.log(`[Webhook] 既に処理済み: ${event.id}`);
    return res.json({ received: true, status: 'already_processed' });
  }

  console.log(`[Webhook] イベント受信: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutCompleted(session);
        break;
      }
      default:
        console.log(`[Webhook] 未処理イベント: ${event.type}`);
        break;
    }

    // 処理済みとして記録
    saveProcessedEvent(event.id);

    return res.json({ received: true });
  } catch (err) {
    console.error('[Webhook] 処理エラー:', err);
    return res.status(500).send('Webhook handler error');
  }
});

// ヘルスチェック
app.get('/healthz', (req, res) => {
  res.send('ok');
});

// AI FES 購入ページ
app.get('/aifes', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI FES. チケット購入</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      padding: 40px 20px;
      color: #333;
    }
    .container {
      max-width: 560px;
      margin: 0 auto;
    }

    /* Header */
    .header {
      background: #1a1a1a;
      color: white;
      padding: 48px 40px;
      text-align: center;
      border-radius: 8px 8px 0 0;
    }
    .header h1 {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: 4px;
      margin-bottom: 8px;
    }
    .header .date {
      font-size: 14px;
      color: #999;
      letter-spacing: 1px;
    }

    /* Content */
    .content {
      background: white;
      padding: 40px;
      border-radius: 0 0 8px 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }

    /* サークル会員案内 */
    .member-notice {
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 6px;
      padding: 20px;
      margin-bottom: 32px;
    }
    .member-notice h3 {
      font-size: 14px;
      font-weight: 600;
      color: #0369a1;
      margin-bottom: 8px;
    }
    .member-notice p {
      font-size: 13px;
      color: #0c4a6e;
      line-height: 1.6;
    }

    /* 注意事項 */
    .notice {
      background: #fafafa;
      border-radius: 6px;
      padding: 20px;
      margin-bottom: 32px;
      font-size: 13px;
      line-height: 1.8;
      color: #666;
    }
    .notice strong {
      color: #333;
    }

    /* セクションタイトル */
    .section-title {
      font-size: 13px;
      font-weight: 600;
      color: #1a1a1a;
      letter-spacing: 2px;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid #eee;
    }

    /* 商品カード */
    .product {
      border: 1px solid #e8e8e8;
      border-radius: 6px;
      padding: 24px;
      margin-bottom: 16px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .product:hover {
      border-color: #1a1a1a;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .product-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .product h3 {
      font-size: 15px;
      font-weight: 600;
      color: #1a1a1a;
      flex: 1;
      padding-right: 16px;
    }
    .product .price {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a1a;
      white-space: nowrap;
    }
    .product .desc {
      font-size: 13px;
      color: #888;
      line-height: 1.5;
      margin-bottom: 16px;
    }
    .product a {
      display: inline-block;
      padding: 12px 28px;
      background: #1a1a1a;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.2s;
    }
    .product a:hover {
      background: #333;
    }

    /* 1日通しチケット（おすすめ） */
    .product.featured {
      border: 2px solid #1a1a1a;
      position: relative;
    }
    .product.featured::before {
      content: 'RECOMMEND';
      position: absolute;
      top: -10px;
      left: 20px;
      background: #1a1a1a;
      color: white;
      font-size: 10px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 3px;
      letter-spacing: 1px;
    }

    /* 仕切り */
    .divider {
      height: 1px;
      background: #eee;
      margin: 40px 0;
    }

    /* サークル入会案内 */
    .circle-promo {
      background: linear-gradient(135deg, #1a1a1a, #333);
      border-radius: 8px;
      padding: 32px;
      color: white;
      text-align: center;
    }
    .circle-promo h3 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    .circle-promo p {
      font-size: 13px;
      line-height: 1.8;
      opacity: 0.9;
      margin-bottom: 20px;
    }
    .circle-promo .benefits {
      text-align: left;
      background: rgba(255,255,255,0.1);
      border-radius: 6px;
      padding: 16px 20px;
      margin-bottom: 20px;
      font-size: 13px;
      line-height: 2;
    }
    .circle-buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
    }
    .circle-promo .btn-secondary {
      display: inline-block;
      padding: 14px 28px;
      background: transparent;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      border: 1px solid rgba(255,255,255,0.5);
      transition: all 0.2s;
    }
    .circle-promo .btn-secondary:hover {
      background: rgba(255,255,255,0.1);
      border-color: white;
    }
    .circle-promo .btn-primary {
      display: inline-block;
      padding: 14px 28px;
      background: white;
      color: #1a1a1a;
      text-decoration: none;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      transition: transform 0.2s;
    }
    .circle-promo .btn-primary:hover {
      transform: translateY(-2px);
    }

    /* フッター */
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
      <h1>AI FES.</h1>
      <p class="date">2026.1.25 SAT / ONLINE</p>
    </div>

    <div class="content">
      <!-- サークル会員向け -->
      <div class="member-notice">
        <h3>サークル会員の方へ</h3>
        <p>会員様には専用クーポンをメールでお送りしています。<br>メールに記載のコードで無料参加できます。</p>
      </div>

      <!-- 注意事項 -->
      <div class="notice">
        <strong>購入前にご確認ください</strong><br>
        購入時のメールアドレスでZoom登録が必要です。<br>
        異なるメールアドレスでは参加できません。
      </div>

      <!-- チケット一覧 -->
      <h2 class="section-title">TICKETS</h2>

      <div class="product featured">
        <div class="product-header">
          <h3>1日通しチケット</h3>
          <div class="price">¥9,800</div>
        </div>
        <div class="desc">全6プログラム参加可能（10:00〜22:00）</div>
        <a href="https://buy.stripe.com/aFacN7ezX6SV8zfcSrf7i03" target="_blank">購入する</a>
      </div>

      <div class="product">
        <div class="product-header">
          <h3>実務で使えるAI×建築セミナー</h3>
          <div class="price">¥5,000</div>
        </div>
        <div class="desc">AIを建築実務で活用する3時間集中講座</div>
        <a href="https://buy.stripe.com/14A00lezX4KNdTz5pZf7i04" target="_blank">購入する</a>
      </div>

      <div class="product">
        <div class="product-header">
          <h3>画像生成AIセミナー</h3>
          <div class="price">¥4,000</div>
        </div>
        <div class="desc">建築パース制作に使える画像生成AI実践講座</div>
        <a href="https://buy.stripe.com/5kQ9AVcrP1yB5n3aKjf7i05" target="_blank">購入する</a>
      </div>

      <div class="product">
        <div class="product-header">
          <h3>無料HP＆GAS自動化セミナー</h3>
          <div class="price">¥3,000</div>
        </div>
        <div class="desc">Googleサービスで作るHP＆業務自動化</div>
        <a href="https://buy.stripe.com/7sY9AVcrP6SV4iZf0zf7i06" target="_blank">購入する</a>
      </div>

      <!-- 仕切り -->
      <div class="divider"></div>

      <!-- サークル入会案内 -->
      <div class="circle-promo">
        <h3>AI×建築サークルに入会する</h3>
        <p>月額会員になると、AI FES.に無料で参加できます。<br>その他にも特典が盛りだくさん！</p>
        <div class="benefits">
          ✓ AI FES. 無料参加<br>
          ✓ 会員限定Discordコミュニティ<br>
          ✓ 過去セミナーアーカイブ視聴<br>
          ✓ 月額 ¥5,000
        </div>
        <div class="circle-buttons">
          <a href="https://suz-u3n-chu.github.io/AI-Architecture-Circle/" target="_blank" class="btn-secondary">詳細を見る</a>
          <a href="/register" class="btn-primary">入会する</a>
        </div>
      </div>

      <div class="footer">
        ご不明点はお問い合わせください
      </div>
    </div>
  </div>
</body>
</html>
  `;
  res.type('html').send(html);
});

// サーバー起動
app.listen(PORT, () => {
  console.log('========================================');
  console.log('Stripe Webhookサーバー');
  console.log('========================================');
  console.log(`[モード] ${STRIPE_MODE.toUpperCase()}`);
  console.log(`[ポート] ${PORT}`);
  console.log(`[Webhook URL] POST /stripe/webhook`);
  console.log('');

  // 設定確認
  const missing = [];
  if (!STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
  if (!SENDGRID_API_KEY) missing.push('SENDGRID_API_KEY');
  if (!FROM_EMAIL) missing.push('FROM_EMAIL');
  if (!SUPPORT_FORM_URL) missing.push('SUPPORT_FORM_URL');
  if (!PRICE_ID_FULL_DAY) missing.push('PRICE_ID_FULL_DAY');
  if (!PRICE_ID_PRACTICAL_AI_ARCHITECTURE) missing.push('PRICE_ID_PRACTICAL_AI_ARCHITECTURE');
  if (!PRICE_ID_IMAGE_GEN_AI) missing.push('PRICE_ID_IMAGE_GEN_AI');
  if (!PRICE_ID_GOOGLE_HP_GAS) missing.push('PRICE_ID_GOOGLE_HP_GAS');

  if (missing.length > 0) {
    console.warn('[警告] 以下の環境変数が未設定です:');
    missing.forEach(m => console.warn(`  - ${m}`));
  } else {
    console.log('[設定] すべての環境変数が設定されています');
  }

  console.log('========================================');
});
