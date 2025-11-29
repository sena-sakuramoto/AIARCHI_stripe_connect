/**
 * 全カスタマーのDiscord連携リンクを一括生成
 */
require('dotenv').config();
const Stripe = require('stripe');
const { Firestore } = require('@google-cloud/firestore');
const fs = require('fs');

// 環境変数から設定を取得
const STRIPE_MODE = process.env.STRIPE_MODE || 'test';
const STRIPE_SECRET_KEY = STRIPE_MODE === 'live'
  ? process.env.STRIPE_SECRET_KEY_LIVE
  : process.env.STRIPE_SECRET_KEY_TEST;

const BASE_URL = process.env.BASE_URL || 'https://stripe-discord-pro-417218426761.asia-northeast1.run.app';
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.PROJECT_ID;

if (!STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY が設定されていません');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);
const firestore = new Firestore({ projectId: GCP_PROJECT_ID });

async function generateLinks() {
  console.log(`🔍 モード: ${STRIPE_MODE}`);

  // Firestoreから既に紐付け済みのカスタマーIDを取得
  console.log(`🔍 Firestoreから紐付け済みユーザーを取得中...`);
  const linkedCustomerIds = new Set();
  const usersSnapshot = await firestore.collection('users').get();

  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.customerId) {
      linkedCustomerIds.add(data.customerId);
    }
  });

  console.log(`✅ 紐付け済み: ${linkedCustomerIds.size}件`);
  console.log(`🔍 カスタマー情報を取得中...`);

  const results = [];
  let hasMore = true;
  let startingAfter = undefined;

  // 全カスタマーを取得（ページネーション対応）
  while (hasMore) {
    const params = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;

    const customers = await stripe.customers.list(params);

    for (const customer of customers.data) {
      const email = customer.email || '(メールなし)';
      const name = customer.name || '(名前なし)';
      const customerId = customer.id;

      // 最新のCheckout Sessionを取得
      const sessions = await stripe.checkout.sessions.list({
        customer: customerId,
        limit: 1
      });

      if (sessions.data.length > 0) {
        const sessionId = sessions.data[0].id;
        const link = `${BASE_URL}/oauth/discord/start?code=${sessionId}`;
        const isLinked = linkedCustomerIds.has(customerId);

        results.push({
          email,
          name,
          customerId,
          sessionId,
          link,
          isLinked
        });

        const status = isLinked ? '✅ 紐付け済み' : '❌ 未紐付け';
        console.log(`${status} ${email} (${name})`);
      } else {
        console.log(`⚠️  ${email} (${name}) - Checkout Sessionなし`);
      }
    }

    hasMore = customers.has_more;
    if (hasMore) {
      startingAfter = customers.data[customers.data.length - 1].id;
    }
  }

  // CSV出力
  const csvFilename = 'discord_links.csv';
  const csvHeader = 'メールアドレス,名前,カスタマーID,紐付け状態,セッションID,連携リンク\n';
  const csvRows = results.map(r =>
    `"${r.email}","${r.name}","${r.customerId}","${r.isLinked ? '紐付け済み' : '未紐付け'}","${r.sessionId}","${r.link}"`
  ).join('\n');

  fs.writeFileSync(csvFilename, csvHeader + csvRows, 'utf8');
  console.log(`\n📄 CSVファイルを生成しました: ${csvFilename}`);

  // テキスト出力（見やすい形式）
  const txtFilename = 'discord_links.txt';
  const txtContent = results.map(r =>
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 ${r.email}
👤 ${r.name}
🆔 ${r.customerId}
${r.isLinked ? '✅ 紐付け済み' : '❌ 未紐付け（要連携）'}
🔗 ${r.link}
`
  ).join('\n');

  fs.writeFileSync(txtFilename, txtContent, 'utf8');
  console.log(`📄 テキストファイルを生成しました: ${txtFilename}`);

  const linkedCount = results.filter(r => r.isLinked).length;
  const unlinkedCount = results.filter(r => !r.isLinked).length;

  console.log(`\n✨ 完了: ${results.length}件のリンクを生成しました`);
  console.log(`   - ✅ 紐付け済み: ${linkedCount}件`);
  console.log(`   - ❌ 未紐付け: ${unlinkedCount}件`);
}

generateLinks().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
