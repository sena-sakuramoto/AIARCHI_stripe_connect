/**
 * Payment Linksに会社名フィールドと請求先住所を追加するスクリプト
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// TEST or LIVE（環境に合わせて変更）
const USE_LIVE = process.env.MODE === 'LIVE';
const apiKey = USE_LIVE
  ? process.env.STRIPE_SECRET_KEY_LIVE
  : process.env.STRIPE_SECRET_KEY_TEST;

if (!apiKey) {
  console.error('STRIPE_SECRET_KEY not found. Check .env file.');
  console.log('MODE:', process.env.MODE);
  process.exit(1);
}
console.log(`Using ${USE_LIVE ? 'LIVE' : 'TEST'} mode\n`);
const stripe = require('stripe')(apiKey);

// 更新対象のPayment Link IDs（URLから抽出）
const paymentLinkIds = [
  'plink_1QJvLNRpUEcUjSDNf7i00', // サークル入会
  // 必要に応じて他のリンクも追加
];

async function updatePaymentLinks() {
  console.log('Payment Links更新開始...\n');

  // まず全てのPayment Linksを取得
  const paymentLinks = await stripe.paymentLinks.list({ limit: 100 });

  console.log(`見つかったPayment Links: ${paymentLinks.data.length}件\n`);

  for (const link of paymentLinks.data) {
    console.log(`ID: ${link.id}`);
    console.log(`URL: ${link.url}`);
    console.log(`Active: ${link.active}`);
    console.log(`Billing: ${link.billing_address_collection}`);
    console.log(`Custom Fields: ${JSON.stringify(link.custom_fields)}`);
    console.log('---');
  }

  // 更新処理
  console.log('\n更新を実行中...\n');

  for (const link of paymentLinks.data) {
    if (!link.active) {
      console.log(`- スキップ（非アクティブ）: ${link.id}`);
      continue;
    }

    try {
      const updated = await stripe.paymentLinks.update(link.id, {
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
        ]
      });
      console.log(`✓ 更新完了: ${link.id} (${link.url})`);
    } catch (error) {
      console.error(`✗ 更新失敗: ${link.id}`, error.message);
    }
  }

  console.log('\n完了！');
}

updatePaymentLinks().catch(console.error);
