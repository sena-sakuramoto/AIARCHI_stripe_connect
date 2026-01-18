/**
 * サークル会員にAI FES.クーポン付きメールを一括送信
 *
 * 使い方:
 * 1. このコードをGASにコピペ
 * 2. sendAllEmails() を実行（初回は権限許可が必要）
 */

// 購入リンク
const PURCHASE_URL = 'https://buy.stripe.com/aFacN7ezX6SV8zfcSrf7i03';

// 送信元名
const FROM_NAME = 'AI FES. 運営事務局';

// 会員データ（Stripeから取得）
const MEMBERS = [
  { email: 'ryota200639@gmail.com', name: '野元亮太', promo_code: 'CIRCLE-T8YAJ8NL' },
  { email: 'miho_oda@andb-d.com', name: '小田　美帆', promo_code: 'CIRCLE-R72G513I' },
  { email: 'y.satokensetsu@gmail.com', name: 'YOSHIYUKI SATOU', promo_code: 'CIRCLE-CHA8TD0Q' },
  { email: 'kou@ikujyuen.com', name: '', promo_code: 'CIRCLE-JFP2H44T' },
  { email: 'qn4.u.g25@gmail.com', name: 'moe nomoto', promo_code: 'CIRCLE-CTEE05VS' },
  { email: 'nayutt@outlook.com', name: 'NAYUTA KUSAKA', promo_code: 'CIRCLE-427CVBHR' },
  { email: 'takashi.hamotsu@gmail.com', name: '', promo_code: 'CIRCLE-ARQSV7DC' },
  { email: 'chamimahime@yahoo.co.jp', name: 'NOBUYUKI TANAKA', promo_code: 'CIRCLE-3ASDFLVI' },
  { email: 'sagawa.tomoya@gmail.com', name: '智也 佐川', promo_code: 'CIRCLE-40LNEYEQ' },
  { email: 'marchitects014@gmail.com', name: 'SOU MATSUI', promo_code: 'CIRCLE-DBOH4ZCW' },
  { email: 'xtatsuyaxkudox@gmail.com', name: 'TATSUYA KUDO', promo_code: 'CIRCLE-AWFHB3NM' },
  { email: '88hachimitsu88@gmail.com', name: 'MITSURU HACHIMURA', promo_code: 'CIRCLE-297NNRPI' },
  { email: 'bisoukuukan@gmail.com', name: 'YASUO TAIJIMA', promo_code: 'CIRCLE-UBJGASGP' },
  { email: 'hibitoarchitects@gmail.com', name: 'MOMOE SUZUKI', promo_code: 'CIRCLE-6XCDWIK9' },
  { email: 'kurea0708@icloud.com', name: '祥子 稲村', promo_code: 'CIRCLE-HFI1MS5N' },
  { email: 'h.makino@atelierma.info', name: 'HIROKA MAKINO', promo_code: 'CIRCLE-ZYT1XH7C' },
  { email: 'k.mayuko3110@gmail.com', name: 'MAYUKO KOGA', promo_code: 'CIRCLE-ZUSCJI0V' },
  { email: 'kusumoto0705@gmail.com', name: 'KOTARO KUSUMOTO', promo_code: 'CIRCLE-UIS96M92' },
  { email: 'sakaki511@gmail.com', name: 'YUTAKA SAKAKIBARA', promo_code: 'CIRCLE-PCOE0IZD' }
];

/**
 * 全会員にメール送信
 */
function sendAllEmails() {
  console.log('=== メール送信開始 ===');
  console.log(`対象: ${MEMBERS.length}名\n`);

  let successCount = 0;
  let failCount = 0;

  MEMBERS.forEach((member, index) => {
    try {
      sendCouponEmail(member);
      console.log(`✓ ${index + 1}/${MEMBERS.length} ${member.email}`);
      successCount++;

      // レート制限回避のため少し待機
      Utilities.sleep(1000);
    } catch (error) {
      console.error(`✗ ${index + 1}/${MEMBERS.length} ${member.email}: ${error.message}`);
      failCount++;
    }
  });

  console.log(`\n=== 送信完了 ===`);
  console.log(`成功: ${successCount}件`);
  console.log(`失敗: ${failCount}件`);
}

/**
 * 1名にメール送信
 */
function sendCouponEmail(member) {
  const subject = 'AI FES. サークル会員様 無料ご招待のご案内';

  const displayName = member.name ? member.name + ' 様' : 'サークル会員 様';

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

              <!-- Greeting -->
              <p style="margin: 0 0 32px 0; font-size: 15px; line-height: 1.8; color: #333333;">
                ${displayName}<br><br>
                いつもAI×建築サークルをご利用いただき<br>
                ありがとうございます。
              </p>

              <p style="margin: 0 0 40px 0; font-size: 15px; line-height: 1.8; color: #333333;">
                1月25日開催の <strong>AI FES.</strong> に<br>
                サークル会員様を<strong style="color: #1a1a1a;">無料</strong>でご招待いたします。
              </p>

              <!-- Coupon Box -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 40px 0;">
                <tr>
                  <td style="background-color: #fafafa; border: 1px solid #e8e8e8; border-radius: 6px; padding: 32px; text-align: center;">
                    <p style="margin: 0 0 12px 0; font-size: 12px; color: #666666; letter-spacing: 1px;">YOUR COUPON CODE</p>
                    <p style="margin: 0 0 16px 0; font-size: 28px; font-weight: 700; color: #1a1a1a; letter-spacing: 3px; font-family: 'SF Mono', Monaco, 'Courier New', monospace;">${member.promo_code}</p>
                    <p style="margin: 0; font-size: 12px; color: #888888;">このコードで無料になります</p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 16px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${PURCHASE_URL}" style="display: inline-block; background-color: #1a1a1a; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 16px 40px; border-radius: 4px; letter-spacing: 1px;">チケットを取得する</a>
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

  GmailApp.sendEmail(member.email, subject, '', {
    htmlBody: htmlBody,
    name: FROM_NAME
  });
}

/**
 * テスト用：1名だけ送信（自分宛て）
 */
function testSendOneEmail() {
  const testMember = {
    email: 'test@example.com', // ← 自分のメールに変更
    name: 'テスト太郎',
    promo_code: 'CIRCLE-TEST123'
  };

  sendCouponEmail(testMember);
  console.log('テストメール送信完了: ' + testMember.email);
}
