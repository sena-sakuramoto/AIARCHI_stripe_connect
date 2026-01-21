/**
 * AI FES. Stripe Webhook → Zoom自動登録 → Gmail送信
 *
 * 設定手順:
 * 1. Google Apps Scriptで新規プロジェクト作成
 * 2. このコードをコピペ
 * 3. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」
 * 4. 「アクセスできるユーザー」→「全員」
 * 5. デプロイしてURLをコピー
 * 6. Stripeダッシュボード → Webhook → URLを登録
 */

// ===== 設定 =====
const CONFIG = {
  // Price ID（Stripeから）
  PRICE_ID_FULL_DAY: 'price_1Squ8URpUEcUjSDNMitC1StT',
  PRICE_ID_PRACTICAL_AI_ARCHITECTURE: 'price_1Squ8VRpUEcUjSDNmzZ6QliV',
  PRICE_ID_IMAGE_GEN_AI: 'price_1Squ8WRpUEcUjSDNiU9RiUXF',
  PRICE_ID_GOOGLE_HP_GAS: 'price_1Squ8XRpUEcUjSDNUkqyg2jm',

  // 送信元
  FROM_NAME: 'AI FES. 運営事務局',

  // サポートURL
  SUPPORT_URL: 'https://example.com/contact',

  // Zoom Server-to-Server OAuth - スクリプトプロパティから取得
  // GASエディタ → プロジェクトの設定 → スクリプトプロパティで設定
  get ZOOM_ACCOUNT_ID() { return PropertiesService.getScriptProperties().getProperty('ZOOM_ACCOUNT_ID'); },
  get ZOOM_CLIENT_ID() { return PropertiesService.getScriptProperties().getProperty('ZOOM_CLIENT_ID'); },
  get ZOOM_CLIENT_SECRET() { return PropertiesService.getScriptProperties().getProperty('ZOOM_CLIENT_SECRET'); },

  // Stripe API - スクリプトプロパティから取得
  get STRIPE_SECRET_KEY() { return PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY'); },

  // AI FES. クーポン設定
  AIFES_COUPON_ID: 'yxU0Acaq', // 既存の100%OFFクーポンID
  AIFES_PROMO_EXPIRES: '2026-01-25T23:59:59+09:00', // クーポン有効期限
  AIFES_PURCHASE_URL: 'https://buy.stripe.com/aFacN7ezX6SV8zfcSrf7i03'
};

// Zoom会議情報（4会議構成）
const ZOOM_MEETINGS = {
  'COMMON': {
    name: 'AI FES. 共通（AI News / 製品デモ / フィナーレ）',
    meeting_id: '86407631333',
    registration_url: 'https://us06web.zoom.us/meeting/register/YvInSC2JQqS607LO07Cnag',
    time: '10:00-22:00（終日）'
  },
  'PRACTICAL': {
    name: '第２回実務で使えるAI×建築セミナー',
    meeting_id: '82219394996',
    registration_url: 'https://us06web.zoom.us/meeting/register/NtP6LDaqRtqkVK9WR1J-WQ',
    time: '13:35-16:00'
  },
  'IMAGE_GEN': {
    name: '第２回今使える画像生成AIセミナー',
    meeting_id: '84325581354',
    registration_url: 'https://us06web.zoom.us/meeting/register/47KhjqccSHOS8JuA00lXzw',
    time: '16:00-17:30'
  },
  'GAS_HP': {
    name: 'GAS＆無料HPセミナー（午前GAS / 夜HP）',
    meeting_id: '88128956534',
    registration_url: 'https://us06web.zoom.us/meeting/register/uIgfnub5Q1Wq-iVgDnJxlA',
    time: '11:45-12:35 / 20:00-21:00'
  }
};

// 商品名マッピング
const PRODUCT_NAME_MAP = {
  [CONFIG.PRICE_ID_FULL_DAY]: 'AI FES. 参加チケット（1日通し）',
  [CONFIG.PRICE_ID_PRACTICAL_AI_ARCHITECTURE]: '第２回実務で使えるAI×建築セミナー',
  [CONFIG.PRICE_ID_IMAGE_GEN_AI]: '今使える画像生成AIセミナー（第２回開催）',
  [CONFIG.PRICE_ID_GOOGLE_HP_GAS]: 'Googleサービスでつくる無料HP＆業務自動化（GAS）セミナー（第１回開催）'
};

// Zoom送付マッピング（4会議構成）
// 全員: COMMON（AI News / 製品デモ / フィナーレ）
// 各チケット: 対応するセミナー
const ZOOM_LINK_MAP = {
  [CONFIG.PRICE_ID_FULL_DAY]: ['COMMON', 'PRACTICAL', 'IMAGE_GEN', 'GAS_HP'], // 通し → 全部
  [CONFIG.PRICE_ID_PRACTICAL_AI_ARCHITECTURE]: ['COMMON', 'PRACTICAL'],       // 実務 → 共通 + 実務
  [CONFIG.PRICE_ID_IMAGE_GEN_AI]: ['COMMON', 'IMAGE_GEN'],                     // 画像生成 → 共通 + 画像生成
  [CONFIG.PRICE_ID_GOOGLE_HP_GAS]: ['COMMON', 'GAS_HP']                        // GAS/HP → 共通 + GAS/HP
};

// 処理済みイベント保存用（冪等性）
const PROCESSED_SHEET_NAME = 'ProcessedEvents';

// スプレッドシートID（ウェブアプリでは getActiveSpreadsheet() が使えないため固定）
// 初回実行時に自動で作成されるスプレッドシートのIDをここに設定
let SPREADSHEET_ID = null; // 後で設定

/**
 * Zoom Server-to-Server OAuth アクセストークン取得
 */
function getZoomAccessToken() {
  const tokenUrl = 'https://zoom.us/oauth/token';
  const credentials = Utilities.base64Encode(CONFIG.ZOOM_CLIENT_ID + ':' + CONFIG.ZOOM_CLIENT_SECRET);

  const response = UrlFetchApp.fetch(tokenUrl, {
    method: 'post',
    headers: {
      'Authorization': 'Basic ' + credentials,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    payload: 'grant_type=account_credentials&account_id=' + CONFIG.ZOOM_ACCOUNT_ID
  });

  const data = JSON.parse(response.getContentText());
  return data.access_token;
}

/**
 * Zoom会議に参加者を自動登録
 * @param {string} meetingId - 会議ID
 * @param {string} email - 参加者メールアドレス
 * @param {string} fullName - フルネーム
 * @returns {object} - { join_url: string } または null
 */
function registerZoomParticipant(meetingId, email, fullName) {
  try {
    const accessToken = getZoomAccessToken();
    const url = `https://api.zoom.us/v2/meetings/${meetingId}/registrants`;

    // 名前を姓・名に分割（日本語対応）
    const nameParts = (fullName || 'Guest User').trim().split(/\s+/);
    const firstName = nameParts[0] || 'Guest';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '様';

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        email: email,
        first_name: firstName,
        last_name: lastName
      }),
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const result = JSON.parse(response.getContentText());

    if (statusCode === 201) {
      console.log(`Zoom登録成功: ${meetingId} - ${email} - ${result.join_url}`);
      return {
        join_url: result.join_url,
        registrant_id: result.registrant_id
      };
    } else {
      console.error(`Zoom登録エラー: ${statusCode} - ${JSON.stringify(result)}`);
      return null;
    }
  } catch (error) {
    console.error(`Zoom登録例外: ${error.message}`);
    return null;
  }
}

/**
 * 複数のZoom会議に一括登録
 * @param {string[]} meetingKeys - 会議キー配列 ['COMMON', 'PRACTICAL', ...]
 * @param {string} email - 参加者メールアドレス
 * @param {string} fullName - 名前
 * @returns {object} - { key: { name, join_url, fallback_url, time } }
 */
function registerAllZoomMeetings(meetingKeys, email, fullName) {
  const results = {};

  meetingKeys.forEach(key => {
    const meeting = ZOOM_MEETINGS[key];
    if (meeting) {
      const registration = registerZoomParticipant(meeting.meeting_id, email, fullName);
      results[key] = {
        name: meeting.name,
        join_url: registration ? registration.join_url : null,
        fallback_url: meeting.registration_url, // 自動登録失敗時の手動登録用
        time: meeting.time || ''
      };
    }
  });

  return results;
}

/**
 * Webhook受信（POST）
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const eventId = data.id;
    const eventType = data.type;

    console.log('イベント受信: ' + eventType);

    // 冪等性チェック
    if (isEventProcessed(eventId)) {
      console.log('既に処理済み: ' + eventId);
      return ContentService.createTextOutput(JSON.stringify({ received: true, already_processed: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // イベント種別ごとの処理
    if (eventType === 'checkout.session.completed') {
      // AI FES. 購入完了 → Zoom登録 + メール送信
      processCheckoutSession(data.data.object);
    } else if (eventType === 'customer.subscription.created') {
      // 新規サークル入会 → クーポン発行 + メール送信
      processNewSubscription(data.data.object);
    } else {
      console.log('対象外のイベント: ' + eventType);
      return ContentService.createTextOutput(JSON.stringify({ received: true, skipped: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 処理済みとして記録
    markEventProcessed(eventId);

    return ContentService.createTextOutput(JSON.stringify({ received: true, success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error('Webhook処理エラー: ' + error.message);
    return ContentService.createTextOutput(JSON.stringify({ error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ========================================
// 新規サークル入会処理
// ========================================

/**
 * 新規サブスクリプション処理
 * サブスク入会 = AI FES.無料参加確定なので、購入手続き不要でZoom登録 + URL送信
 */
function processNewSubscription(subscription) {
  const customerId = subscription.customer;
  console.log('新規サブスクリプション: ' + customerId);

  // 顧客情報を取得
  const customer = getStripeCustomer(customerId);
  if (!customer || !customer.email) {
    console.error('顧客情報が取得できません: ' + customerId);
    return;
  }

  const email = customer.email;
  const name = customer.name || '';
  console.log('顧客: ' + email + ' / ' + name);

  // Discord連携案内メール送信
  sendDiscordLinkEmail(email, name);

  // AI FES. Zoom自動登録 + 参加URL送信（サブスク会員特典として自動付与）
  console.log('サブスク会員特典: AI FES. Zoom自動登録開始...');
  const meetingKeys = ['COMMON', 'PRACTICAL', 'IMAGE_GEN', 'GAS_HP']; // 通しチケット相当
  const zoomRegistrations = registerAllZoomMeetings(meetingKeys, email, name);

  // AI FES. 参加案内メール送信（Zoom URL付き）
  sendCircleMemberAIFESEmail(email, name, zoomRegistrations);
  console.log('AI FES. 参加案内メール送信完了');
}

/**
 * Stripe顧客情報取得
 */
function getStripeCustomer(customerId) {
  try {
    const response = UrlFetchApp.fetch('https://api.stripe.com/v1/customers/' + customerId, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + CONFIG.STRIPE_SECRET_KEY
      },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      return JSON.parse(response.getContentText());
    } else {
      console.error('顧客取得エラー: ' + response.getContentText());
      return null;
    }
  } catch (error) {
    console.error('顧客取得例外: ' + error.message);
    return null;
  }
}

/**
 * Stripeプロモーションコード作成
 */
function createStripePromoCode(customerId) {
  try {
    // ランダムコード生成
    const randomCode = 'CIRCLE-' + generateRandomString(8);

    // 有効期限をUnixタイムスタンプに変換
    const expiresAt = Math.floor(new Date(CONFIG.AIFES_PROMO_EXPIRES).getTime() / 1000);

    const response = UrlFetchApp.fetch('https://api.stripe.com/v1/promotion_codes', {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + CONFIG.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      payload: {
        'coupon': CONFIG.AIFES_COUPON_ID,
        'code': randomCode,
        'max_redemptions': 1,
        'expires_at': expiresAt,
        'metadata[customer_id]': customerId,
        'restrictions[first_time_transaction]': 'false'
      },
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const result = JSON.parse(response.getContentText());

    if (statusCode === 200) {
      console.log('プロモーションコード作成成功: ' + result.code);
      return result;
    } else {
      console.error('プロモーションコード作成エラー: ' + JSON.stringify(result));
      return null;
    }
  } catch (error) {
    console.error('プロモーションコード作成例外: ' + error.message);
    return null;
  }
}

/**
 * ランダム文字列生成
 */
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 新規会員向けクーポンメール送信
 */
function sendNewMemberCouponEmail(toEmail, name, promoCode) {
  const subject = 'AI FES. サークル会員様 無料ご招待のご案内';
  const displayName = name ? name + ' 様' : 'サークル会員 様';

  const htmlBody = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif;">

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f5f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color: #1a1a1a; padding: 40px 40px 36px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 20px; font-weight: 600; color: #ffffff; letter-spacing: 4px;">AI FES.</h1>
              <p style="margin: 12px 0 0 0; font-size: 13px; color: #999999; letter-spacing: 1px;">2026.1.25 SAT</p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 48px 40px;">

              <!-- Welcome Message -->
              <div style="background-color: #f0f9ff; border-radius: 6px; padding: 20px; margin-bottom: 32px; text-align: center;">
                <p style="margin: 0; font-size: 14px; color: #0369a1;">サークルへのご入会ありがとうございます</p>
              </div>

              <!-- Greeting -->
              <p style="margin: 0 0 32px 0; font-size: 15px; line-height: 1.8; color: #333333;">
                ${displayName}<br><br>
                AI×建築サークルへようこそ！
              </p>

              <p style="margin: 0 0 40px 0; font-size: 15px; line-height: 1.8; color: #333333;">
                会員特典として、1月25日開催の<br>
                <strong>AI FES.</strong> に<strong style="color: #1a1a1a;">無料</strong>でご招待いたします。
              </p>

              <!-- Coupon Box -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 40px 0;">
                <tr>
                  <td style="background-color: #fafafa; border: 1px solid #e8e8e8; border-radius: 6px; padding: 32px; text-align: center;">
                    <p style="margin: 0 0 12px 0; font-size: 12px; color: #666666; letter-spacing: 1px;">YOUR COUPON CODE</p>
                    <p style="margin: 0 0 16px 0; font-size: 28px; font-weight: 700; color: #1a1a1a; letter-spacing: 3px; font-family: 'SF Mono', Monaco, 'Courier New', monospace;">${promoCode}</p>
                    <p style="margin: 0; font-size: 12px; color: #888888;">このコードで無料になります</p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 16px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${CONFIG.AIFES_PURCHASE_URL}" style="display: inline-block; background-color: #1a1a1a; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 4px; letter-spacing: 1px;">チケットを取得する</a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 48px 0; font-size: 12px; color: #999999; text-align: center; line-height: 1.6;">
                購入画面で「プロモーションコードを追加」から<br>
                上記コードを入力してください
              </p>

              <!-- Divider -->
              <hr style="border: none; border-top: 1px solid #eeeeee; margin: 0 0 40px 0;">

              <!-- Event Details -->
              <h2 style="margin: 0 0 24px 0; font-size: 13px; font-weight: 600; color: #1a1a1a; letter-spacing: 2px;">EVENT DETAILS</h2>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 32px 0; font-size: 14px; line-height: 1.8; color: #333333;">
                <tr>
                  <td style="padding: 8px 0; width: 80px; color: #888888; vertical-align: top;">日時</td>
                  <td style="padding: 8px 0;">2026年1月25日（土）終日</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #888888; vertical-align: top;">形式</td>
                  <td style="padding: 8px 0;">オンライン（Zoom）</td>
                </tr>
              </table>

              <!-- Program -->
              <h2 style="margin: 0 0 20px 0; font-size: 13px; font-weight: 600; color: #1a1a1a; letter-spacing: 2px;">TIME SCHEDULE</h2>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 40px 0; font-size: 12px; line-height: 1.8; color: #555555;">
                <tr><td style="padding: 2px 0; color: #0369a1; font-weight: 600;">午前</td></tr>
                <tr><td style="padding: 2px 0;">10:00–11:30　最新AI Newsまとめ</td></tr>
                <tr><td style="padding: 2px 0;">11:45–12:35　GAS＆業務自動化</td></tr>
                <tr><td style="padding: 2px 0; color: #0369a1; font-weight: 600; padding-top: 8px;">午後</td></tr>
                <tr><td style="padding: 2px 0;">13:35–16:00　実務AI×建築セミナー</td></tr>
                <tr><td style="padding: 2px 0;">16:00–17:30　画像生成AIセミナー</td></tr>
                <tr><td style="padding: 2px 0;">17:30–18:50　自社製品デモ＆質問</td></tr>
                <tr><td style="padding: 2px 0; color: #0369a1; font-weight: 600; padding-top: 8px;">夜</td></tr>
                <tr><td style="padding: 2px 0;">20:00–21:00　無料HP作成セミナー</td></tr>
                <tr><td style="padding: 2px 0;">21:00–22:00　プレゼント＆フィナーレ</td></tr>
              </table>

              <!-- Notes -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 40px 0;">
                <tr>
                  <td style="background-color: #fafafa; border-radius: 4px; padding: 20px 24px; font-size: 12px; line-height: 1.8; color: #666666;">
                    ・クーポンは1回限り有効<br>
                    ・有効期限：1月25日 23:59まで<br>
                    ・申込後、Zoom参加URLが届きます
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 32px 40px; text-align: center; border-top: 1px solid #eeeeee;">
              <p style="margin: 0; font-size: 12px; color: #999999;">
                AI FES. 運営事務局
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

  GmailApp.sendEmail(toEmail, subject, '', {
    htmlBody: htmlBody,
    name: CONFIG.FROM_NAME
  });

  console.log('新規会員クーポンメール送信完了: ' + toEmail);
}

/**
 * サブスク会員向け AI FES. 参加案内メール（Zoom URL付き）
 * 購入手続き不要、会員特典として自動登録済み
 */
function sendCircleMemberAIFESEmail(toEmail, name, zoomRegistrations) {
  const subject = '【AI×建築サークル特典】AI FES. 参加登録完了のご案内';
  const displayName = name ? name + ' 様' : 'サークル会員 様';

  // 自動登録成功したかチェック
  const hasAutoRegistered = Object.values(zoomRegistrations).some(r => r.join_url);

  // Zoomリンク部分（順番を制御: COMMON → GAS_HP → PRACTICAL → IMAGE_GEN）
  const keyOrder = ['COMMON', 'GAS_HP', 'PRACTICAL', 'IMAGE_GEN'];
  let zoomLinksHtml = '';

  keyOrder.forEach(key => {
    const reg = zoomRegistrations[key];
    if (!reg) return;

    const timeInfo = reg.time ? `<span style="color: #4dd0e1; font-size: 12px; font-weight: 600;">${reg.time}</span><br>` : '';

    if (reg.join_url) {
      zoomLinksHtml += `
        <tr>
          <td style="padding: 20px; border-bottom: 1px solid #e0f7fa;">
            ${timeInfo}
            <p style="margin: 4px 0 12px 0; font-weight: 600; color: #333;">${reg.name}</p>
            <a href="${reg.join_url}" style="background: linear-gradient(135deg, #4dd0e1, #29b6f6); color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: 600; font-size: 14px;">参加する</a>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #4dd0e1;">登録完了済み</p>
          </td>
        </tr>
      `;
    } else {
      zoomLinksHtml += `
        <tr>
          <td style="padding: 20px; border-bottom: 1px solid #e0f7fa;">
            ${timeInfo}
            <p style="margin: 4px 0 12px 0; font-weight: 600; color: #333;">${reg.name}</p>
            <a href="${reg.fallback_url}" style="background: #f5f5f5; color: #333; padding: 10px 24px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: 600; font-size: 14px; border: 1px solid #ddd;">登録はこちら</a>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #ff6b6b;">※ 手動登録が必要です</p>
          </td>
        </tr>
      `;
    }
  });

  const htmlBody = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', Meiryo, sans-serif;">

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f5f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #4dd0e1 0%, #29b6f6 50%, #42a5f5 100%); padding: 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: 4px;">AI FES.</h1>
              <p style="margin: 12px 0 0 0; font-size: 14px; color: rgba(255,255,255,0.9);">2026.1.25 SAT / ONLINE</p>
            </td>
          </tr>

          <!-- Member Benefit Banner -->
          <tr>
            <td style="padding: 0;">
              <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 20px; text-align: center;">
                <p style="margin: 0; color: white; font-size: 16px; font-weight: 600;">サークル会員特典：参加登録完了！</p>
                <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 13px;">購入手続き不要で全セッションに参加できます</p>
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px;">

              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.8; color: #333333;">
                ${displayName}<br><br>
                AI×建築サークルへのご入会ありがとうございます！<br>
                会員特典として、<strong>AI FES.</strong> への参加登録が完了しました。
              </p>

              <!-- Zoomリンク -->
              <h2 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 700; color: #333; letter-spacing: 2px;">ZOOM参加リンク</h2>
              <table style="width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e0f7fa; border-radius: 8px; margin-bottom: 28px;">
                ${zoomLinksHtml}
              </table>

              <!-- タイムスケジュール -->
              <h2 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 700; color: #333; letter-spacing: 2px;">TIME SCHEDULE</h2>
              <div style="background: #fafafa; border-radius: 8px; padding: 20px; margin-bottom: 28px; font-size: 13px; line-height: 2; color: #555;">
                <p style="margin: 0 0 12px 0; font-weight: 600; color: #00838f;">午前</p>
                10:00–10:15　オープニング<br>
                10:15–11:30　最新AI Newsまとめ<br>
                11:45–12:35　GAS＆業務自動化<br><br>

                <p style="margin: 0 0 12px 0; font-weight: 600; color: #00838f;">午後</p>
                13:35–16:00　実務AI×建築セミナー<br>
                16:00–17:30　画像生成AIセミナー<br>
                17:30–18:30　自社製品デモ<br>
                18:30–18:50　質問タイム<br><br>

                <p style="margin: 0 0 12px 0; font-weight: 600; color: #00838f;">夜</p>
                20:00–21:00　無料HP作成セミナー<br>
                21:00–21:30　プレゼント配布＋サークル案内<br>
                21:30–22:00　グランドフィナーレ
              </div>

              <!-- 注意事項 -->
              <div style="background: #e8f5e9; border-radius: 8px; padding: 16px 20px; font-size: 13px; color: #2e7d32; line-height: 1.7;">
                <strong>会員特典</strong><br>
                ・全セッション参加可能（通しチケット相当）<br>
                ・当日は「参加する」ボタンをクリックするだけ<br>
                ・アーカイブ動画も後日配布予定
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 24px 32px; text-align: center; border-top: 1px solid #eeeeee;">
              <p style="margin: 0; font-size: 12px; color: #999999;">
                AI×建築サークル 運営事務局
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

  GmailApp.sendEmail(toEmail, subject, '', {
    htmlBody: htmlBody,
    name: 'AI×建築サークル'
  });

  console.log('サークル会員AI FES.参加案内メール送信完了: ' + toEmail);
}

/**
 * Discord連携案内メール送信
 */
function sendDiscordLinkEmail(toEmail, name) {
  const subject = '【重要】Discord連携のお願い - AI×建築サークル';
  const displayName = name ? name + ' 様' : '会員 様';

  // サーバーのベースURL（デプロイ環境に合わせて変更）
  const BASE_URL = 'https://stripe-discord-pro-417218426761.asia-northeast1.run.app';
  const linkUrl = BASE_URL + '/link?email=' + encodeURIComponent(toEmail);
  const discordInvite = 'https://discord.gg/NGxNcEVzpE';

  const htmlBody = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', Meiryo, sans-serif;">

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f5f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #5865F2 0%, #7289DA 100%); padding: 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">Discord連携のお願い</h1>
              <p style="margin: 12px 0 0 0; font-size: 14px; color: rgba(255,255,255,0.9);">AI×建築サークル</p>
            </td>
          </tr>

          <!-- Alert Banner -->
          <tr>
            <td style="padding: 0;">
              <div style="background: linear-gradient(135deg, #ff6b6b, #ee5a5a); padding: 16px 24px; text-align: center;">
                <p style="margin: 0; color: white; font-size: 14px; font-weight: 600;">Pro限定チャンネルにアクセスするにはDiscord連携が必要です</p>
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">

              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.8; color: #333333;">
                ${displayName}<br><br>
                AI×建築サークルへのご入会ありがとうございます！
              </p>

              <p style="margin: 0 0 32px 0; font-size: 15px; line-height: 1.8; color: #333333;">
                <strong>Pro限定コンテンツ</strong>にアクセスするには、<br>
                Discordアカウントとの連携が必要です。
              </p>

              <!-- Steps -->
              <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; margin-bottom: 32px;">
                <p style="margin: 0 0 16px 0; font-weight: 600; color: #333;">セットアップ手順</p>
                <table style="width: 100%; font-size: 14px; color: #555;">
                  <tr>
                    <td style="padding: 8px 0; vertical-align: top; width: 30px; color: #5865F2; font-weight: 600;">1.</td>
                    <td style="padding: 8px 0;">下のボタンからDiscord連携を開始</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; vertical-align: top; color: #5865F2; font-weight: 600;">2.</td>
                    <td style="padding: 8px 0;">Discordの認証画面で「認可」をクリック</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; vertical-align: top; color: #5865F2; font-weight: 600;">3.</td>
                    <td style="padding: 8px 0;">自動で@proロールが付与されます</td>
                  </tr>
                </table>
              </div>

              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${linkUrl}" style="display: inline-block; background: #5865F2; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 48px; border-radius: 8px;">Discord連携を開始する</a>
                  </td>
                </tr>
              </table>

              <!-- Secondary CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${discordInvite}" style="display: inline-block; background: #ffffff; color: #5865F2; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 8px; border: 2px solid #5865F2;">Discordサーバーに参加</a>
                  </td>
                </tr>
              </table>

              <!-- Note -->
              <div style="background: #fff3e0; border-radius: 8px; padding: 16px 20px; font-size: 13px; color: #e65100; line-height: 1.7;">
                <strong>注意</strong><br>
                ・連携にはDiscordアカウントが必要です<br>
                ・連携後、サーバー内で@proロールが自動付与されます<br>
                ・ご不明な点はサーバー内でお問い合わせください
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 24px 40px; text-align: center; border-top: 1px solid #eeeeee;">
              <p style="margin: 0; font-size: 12px; color: #999999;">
                AI×建築サークル 運営事務局
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

  GmailApp.sendEmail(toEmail, subject, '', {
    htmlBody: htmlBody,
    name: 'AI×建築サークル'
  });

  console.log('Discord連携案内メール送信完了: ' + toEmail);
}

/**
 * Checkout Session処理
 * ※サブスク購入は customer.subscription.created で処理するためスキップ
 */
function processCheckoutSession(session) {
  // サブスク購入の場合はスキップ（customer.subscription.createdで処理）
  if (session.mode === 'subscription') {
    console.log('サブスク購入のためスキップ（customer.subscription.createdで処理）');
    return;
  }

  const email = session.customer_details?.email || session.customer_email;
  const customerName = session.customer_details?.name || 'Guest';

  if (!email) {
    console.error('メールアドレスがありません');
    return;
  }

  // line_itemsからprice_idを取得
  // 注: Payment Linkの場合、session.line_itemsは直接含まれないため、
  // metadataまたはStripe APIで取得が必要。簡易版としてamount_totalで判定

  const amountTotal = session.amount_total;
  let priceId = null;

  // 金額で商品判定（簡易版）
  // 注: 100%割引クーポン使用時はamount_total=0になる
  if (amountTotal === 980000 || amountTotal === 0) { // ¥9,800 or 無料（クーポン）
    priceId = CONFIG.PRICE_ID_FULL_DAY;
  } else if (amountTotal === 500000) { // ¥5,000
    priceId = CONFIG.PRICE_ID_PRACTICAL_AI_ARCHITECTURE;
  } else if (amountTotal === 400000) { // ¥4,000
    priceId = CONFIG.PRICE_ID_IMAGE_GEN_AI;
  } else if (amountTotal === 300000) { // ¥3,000
    priceId = CONFIG.PRICE_ID_GOOGLE_HP_GAS;
  }

  if (!priceId) {
    console.log('対象外の金額: ' + amountTotal);
    return;
  }

  const productName = PRODUCT_NAME_MAP[priceId];
  const meetingKeys = ZOOM_LINK_MAP[priceId];

  console.log('送信先: ' + email);
  console.log('顧客名: ' + customerName);
  console.log('商品: ' + productName);
  console.log('Zoom: ' + meetingKeys.join(', '));

  // Zoom自動登録
  console.log('Zoom自動登録を開始...');
  const zoomRegistrations = registerAllZoomMeetings(meetingKeys, email, customerName);

  // メール送信（個別参加URLつき）
  sendZoomLinksEmail(email, productName, zoomRegistrations);
}

/**
 * Zoom参加URLメール送信（自動登録済み）
 * @param {string} toEmail - 送信先
 * @param {string} productName - 商品名
 * @param {object} zoomRegistrations - { key: { name, join_url, fallback_url, time } }
 */
function sendZoomLinksEmail(toEmail, productName, zoomRegistrations) {
  const subject = 'AI FES. 参加情報（Zoom参加URLのご案内）';

  // 自動登録成功したかチェック
  const hasAutoRegistered = Object.values(zoomRegistrations).some(r => r.join_url);

  // Zoomリンク部分（順番を制御: COMMON → GAS_HP → PRACTICAL → IMAGE_GEN）
  const keyOrder = ['COMMON', 'GAS_HP', 'PRACTICAL', 'IMAGE_GEN'];
  let zoomLinksHtml = '';

  keyOrder.forEach(key => {
    const reg = zoomRegistrations[key];
    if (!reg) return;

    const timeInfo = reg.time ? `<span style="color: #4dd0e1; font-size: 12px; font-weight: 600;">${reg.time}</span><br>` : '';

    if (reg.join_url) {
      // 自動登録成功 → 直接参加URL
      zoomLinksHtml += `
        <tr>
          <td style="padding: 20px; border-bottom: 1px solid #e0f7fa;">
            ${timeInfo}
            <p style="margin: 4px 0 12px 0; font-weight: 600; color: #333;">${reg.name}</p>
            <a href="${reg.join_url}" style="background: linear-gradient(135deg, #4dd0e1, #29b6f6); color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: 600; font-size: 14px;">参加する</a>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #4dd0e1;">登録完了済み</p>
          </td>
        </tr>
      `;
    } else {
      // 自動登録失敗 → 手動登録リンク
      zoomLinksHtml += `
        <tr>
          <td style="padding: 20px; border-bottom: 1px solid #e0f7fa;">
            ${timeInfo}
            <p style="margin: 4px 0 12px 0; font-weight: 600; color: #333;">${reg.name}</p>
            <a href="${reg.fallback_url}" style="background: #f5f5f5; color: #333; padding: 10px 24px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: 600; font-size: 14px; border: 1px solid #ddd;">登録はこちら</a>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #ff6b6b;">※ 手動登録が必要です</p>
          </td>
        </tr>
      `;
    }
  });

  const htmlBody = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', Meiryo, sans-serif;">

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f5f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #4dd0e1 0%, #29b6f6 50%, #42a5f5 100%); padding: 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: 4px;">AI FES.</h1>
              <p style="margin: 12px 0 0 0; font-size: 14px; color: rgba(255,255,255,0.9);">2026.1.25 SAT / ONLINE</p>
            </td>
          </tr>

          <!-- Status Banner -->
          <tr>
            <td style="padding: 0;">
              ${hasAutoRegistered ? `
              <div style="background: linear-gradient(135deg, #4dd0e1, #29b6f6); padding: 20px; text-align: center;">
                <p style="margin: 0; color: white; font-size: 16px; font-weight: 600;">登録完了！当日はボタンをクリックするだけ</p>
              </div>
              ` : `
              <div style="background: linear-gradient(135deg, #ff6b6b, #ee5a5a); padding: 20px; text-align: center;">
                <p style="margin: 0; color: white; font-size: 16px; font-weight: 600;">手動登録が必要です</p>
              </div>
              `}
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px;">

              <!-- 購入商品 -->
              <div style="background: linear-gradient(135deg, #e0f7fa, #e3f2fd); border-radius: 8px; padding: 16px 20px; margin-bottom: 28px;">
                <p style="margin: 0 0 4px 0; font-size: 12px; color: #00838f; font-weight: 600;">ご購入チケット</p>
                <p style="margin: 0; font-size: 15px; color: #006064; font-weight: 600;">${productName}</p>
              </div>

              <!-- Zoomリンク -->
              <h2 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 700; color: #333; letter-spacing: 2px;">ZOOM参加リンク</h2>
              <table style="width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e0f7fa; border-radius: 8px; margin-bottom: 28px;">
                ${zoomLinksHtml}
              </table>

              <!-- タイムスケジュール -->
              <h2 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 700; color: #333; letter-spacing: 2px;">TIME SCHEDULE</h2>
              <div style="background: #fafafa; border-radius: 8px; padding: 20px; margin-bottom: 28px; font-size: 13px; line-height: 2; color: #555;">
                <p style="margin: 0 0 12px 0; font-weight: 600; color: #00838f;">午前</p>
                10:00–10:15　オープニング<br>
                10:15–11:30　最新AI Newsまとめ<br>
                11:45–12:35　GAS＆業務自動化<br><br>

                <p style="margin: 0 0 12px 0; font-weight: 600; color: #00838f;">午後</p>
                13:35–16:00　実務AI×建築セミナー<br>
                16:00–17:30　画像生成AIセミナー<br>
                17:30–18:30　自社製品デモ<br>
                18:30–18:50　質問タイム<br><br>

                <p style="margin: 0 0 12px 0; font-weight: 600; color: #00838f;">夜</p>
                20:00–21:00　無料HP作成セミナー<br>
                21:00–21:30　プレゼント配布＋サークル案内<br>
                21:30–22:00　グランドフィナーレ
              </div>

              <!-- 注意事項 -->
              <div style="background: #fff3e0; border-radius: 8px; padding: 16px 20px; font-size: 13px; color: #e65100; line-height: 1.7;">
                <strong>参加方法</strong><br>
                ・当日、上記の「参加する」ボタンをクリック<br>
                ・Zoomアプリが起動し、会議に参加できます<br>
                ・アーカイブ動画は後日配布予定
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 24px 32px; text-align: center; border-top: 1px solid #eeeeee;">
              <p style="margin: 0; font-size: 12px; color: #999999;">
                AI FES. 運営事務局
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
  `;

  // Gmail送信
  GmailApp.sendEmail(toEmail, subject, '', {
    htmlBody: htmlBody,
    name: CONFIG.FROM_NAME
  });

  console.log('メール送信完了: ' + toEmail);
}

/**
 * 処理済みイベントかチェック
 */
function isEventProcessed(eventId) {
  const sheet = getOrCreateSheet(PROCESSED_SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === eventId) {
      return true;
    }
  }
  return false;
}

/**
 * イベントを処理済みとして記録
 */
function markEventProcessed(eventId) {
  const sheet = getOrCreateSheet(PROCESSED_SHEET_NAME);
  sheet.appendRow([eventId, new Date()]);
}

/**
 * シートを取得または作成
 * ウェブアプリではgetActiveSpreadsheet()がnullを返すため、
 * PropertiesServiceでスプレッドシートIDを保存
 */
function getOrCreateSheet(name) {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty('SPREADSHEET_ID');
  let ss;

  if (ssId) {
    try {
      ss = SpreadsheetApp.openById(ssId);
    } catch (e) {
      console.log('保存されたスプレッドシートが見つかりません。新規作成します。');
      ssId = null;
    }
  }

  if (!ssId) {
    ss = SpreadsheetApp.create('AI FES Webhook Log');
    props.setProperty('SPREADSHEET_ID', ss.getId());
    console.log('新規スプレッドシート作成: ' + ss.getUrl());
  }

  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(['EventID', 'ProcessedAt']);
  }

  return sheet;
}

/**
 * テスト用：手動でメール送信テスト（自動登録なし版）
 */
function testSendEmail() {
  // 自動登録をシミュレート（join_urlなしでフォールバック）
  const mockRegistrations = {};
  Object.keys(ZOOM_MEETINGS).forEach(key => {
    const m = ZOOM_MEETINGS[key];
    mockRegistrations[key] = {
      name: m.name,
      join_url: null,
      fallback_url: m.registration_url,
      time: m.time || ''
    };
  });

  sendZoomLinksEmail(
    'test@example.com',
    'AI FES. 参加チケット（1日通し）',
    mockRegistrations
  );
}

/**
 * テスト用：Zoom自動登録 + メール送信テスト
 * 実際にZoom APIを呼び出して登録を行う
 */
function testAutoRegisterAndSendEmail() {
  const testEmail = 'test@example.com'; // ← 実際のテスト用メールに変更
  const meetingKeys = ['COMMON', 'PRACTICAL', 'IMAGE_GEN', 'GAS_HP']; // 通しチケット用

  console.log('Zoom自動登録テスト開始...');
  const registrations = registerAllZoomMeetings(meetingKeys, testEmail, 'Test User');
  console.log('登録結果: ' + JSON.stringify(registrations));

  sendZoomLinksEmail(
    testEmail,
    'AI FES. 参加チケット（1日通し）',
    registrations
  );
}

/**
 * テスト用：Zoomアクセストークン取得確認
 */
function testZoomAuth() {
  try {
    const token = getZoomAccessToken();
    console.log('Zoomトークン取得成功: ' + token.substring(0, 20) + '...');
    return true;
  } catch (e) {
    console.error('Zoomトークン取得失敗: ' + e.message);
    return false;
  }
}

/**
 * テスト用：新規会員クーポン発行テスト
 * 実際にStripeでプロモーションコードを作成してメール送信
 */
function testNewMemberCoupon() {
  const testEmail = 'test@example.com'; // ← 自分のメールに変更
  const testName = 'テスト太郎';
  const testCustomerId = 'cus_test123'; // ダミー

  // プロモーションコード作成
  const promoCode = createStripePromoCode(testCustomerId);

  if (promoCode) {
    console.log('作成されたコード: ' + promoCode.code);

    // メール送信
    sendNewMemberCouponEmail(testEmail, testName, promoCode.code);
    console.log('テストメール送信完了');
  } else {
    console.error('プロモーションコード作成失敗');
  }
}

/**
 * テスト用：クーポンメールのみ送信（プロモーションコード作成なし）
 */
function testNewMemberEmailOnly() {
  const testEmail = 'test@example.com'; // ← 自分のメールに変更
  const testName = 'テスト太郎';

  sendNewMemberCouponEmail(testEmail, testName, 'CIRCLE-TESTCODE');
  console.log('テストメール送信完了: ' + testEmail);
}

// ========================================
// 未連携者リマインド機能
// ========================================

// リマインド設定
const REMINDER_CONFIG = {
  // Node.jsサーバーのベースURL
  SERVER_URL: 'https://stripe-discord-pro-417218426761.asia-northeast1.run.app',
  // リマインド済みを記録するシート名
  REMINDER_SHEET_NAME: 'RemindersSent'
};

/**
 * スクリプトプロパティから認証トークンを取得
 * GASエディタ → プロジェクトの設定 → スクリプトプロパティ で設定
 */
function getAuthToken() {
  const token = PropertiesService.getScriptProperties().getProperty('SCHEDULER_TOKEN');
  if (!token) {
    throw new Error('SCHEDULER_TOKEN がスクリプトプロパティに設定されていません');
  }
  return token;
}

/**
 * 未連携者にリマインドメールを送信
 * Cloud Schedulerや時間ベースのトリガーで1日1回実行する想定
 */
function sendUnlinkedReminders() {
  console.log('未連携者リマインド処理開始...');

  try {
    // 1. Node.jsサーバーから未連携者リストを取得
    const authToken = getAuthToken();
    const url = REMINDER_CONFIG.SERVER_URL + '/admin/unlinked-customers?token=' + authToken;
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      console.error('未連携者取得エラー: ' + response.getContentText());
      return;
    }

    const data = JSON.parse(response.getContentText());
    console.log('未連携者数: ' + data.count);

    if (data.count === 0) {
      console.log('未連携者なし。処理終了。');
      return;
    }

    // 2. 各未連携者にリマインドメールを送信（重複送信防止付き）
    let sentCount = 0;
    for (const customer of data.customers) {
      // 過去にリマインドを送ったかチェック
      if (hasReminderBeenSent(customer.customerId)) {
        console.log('既にリマインド済み: ' + customer.email);
        continue;
      }

      // リマインドメール送信
      sendDiscordReminderEmail(customer.email, customer.name);
      markReminderSent(customer.customerId, customer.email);
      sentCount++;

      // API制限を考慮して少し待機
      Utilities.sleep(500);
    }

    console.log('リマインドメール送信完了: ' + sentCount + '件');

  } catch (error) {
    console.error('リマインド処理エラー: ' + error.message);
  }
}

/**
 * リマインドが既に送信されているかチェック
 */
function hasReminderBeenSent(customerId) {
  const sheet = getOrCreateSheet(REMINDER_CONFIG.REMINDER_SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === customerId) {
      return true;
    }
  }
  return false;
}

/**
 * リマインド送信を記録
 */
function markReminderSent(customerId, email) {
  const sheet = getOrCreateSheet(REMINDER_CONFIG.REMINDER_SHEET_NAME);
  sheet.appendRow([customerId, email, new Date()]);
}

/**
 * リマインドメール送信
 */
function sendDiscordReminderEmail(toEmail, name) {
  const subject = '【リマインド】Discord連携をお忘れではありませんか？ - AI×建築サークル';
  const displayName = name ? name + ' 様' : '会員 様';

  const BASE_URL = 'https://stripe-discord-pro-417218426761.asia-northeast1.run.app';
  const linkUrl = BASE_URL + '/link?email=' + encodeURIComponent(toEmail);
  const discordInvite = 'https://discord.gg/NGxNcEVzpE';

  const htmlBody = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', Meiryo, sans-serif;">

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f5f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%); padding: 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff;">Discord連携をお忘れではありませんか？</h1>
              <p style="margin: 12px 0 0 0; font-size: 14px; color: rgba(255,255,255,0.9);">AI×建築サークル</p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">

              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.8; color: #333333;">
                ${displayName}<br><br>
                AI×建築サークルをご利用いただきありがとうございます。
              </p>

              <div style="background: #fff3e0; border-left: 4px solid #ff9800; padding: 16px 20px; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 14px; color: #e65100; line-height: 1.6;">
                  <strong>Discord連携がまだ完了していません</strong><br>
                  Pro限定コンテンツにアクセスするには連携が必要です。
                </p>
              </div>

              <p style="margin: 0 0 32px 0; font-size: 15px; line-height: 1.8; color: #333333;">
                連携は1分で完了します。<br>
                下のボタンからお手続きください。
              </p>

              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 24px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${linkUrl}" style="display: inline-block; background: #5865F2; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 48px; border-radius: 8px;">今すぐDiscord連携する</a>
                  </td>
                </tr>
              </table>

              <!-- Secondary CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${discordInvite}" style="display: inline-block; background: #ffffff; color: #5865F2; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 8px; border: 2px solid #5865F2;">Discordサーバーに参加</a>
                  </td>
                </tr>
              </table>

              <!-- Note -->
              <div style="background: #f5f5f5; border-radius: 8px; padding: 16px 20px; font-size: 13px; color: #666; line-height: 1.7;">
                ご不明な点がございましたら、Discordサーバー内でお気軽にお問い合わせください。
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 24px 40px; text-align: center; border-top: 1px solid #eeeeee;">
              <p style="margin: 0; font-size: 12px; color: #999999;">
                AI×建築サークル 運営事務局
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

  GmailApp.sendEmail(toEmail, subject, '', {
    htmlBody: htmlBody,
    name: 'AI×建築サークル'
  });

  console.log('リマインドメール送信: ' + toEmail);
}

/**
 * テスト用：未連携者リマインド処理をテスト実行
 */
function testSendUnlinkedReminders() {
  sendUnlinkedReminders();
}
