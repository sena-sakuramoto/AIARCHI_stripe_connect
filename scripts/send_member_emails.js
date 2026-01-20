/**
 * サークル会員にAI FES.クーポン付きメールを送信
 *
 * 使い方:
 * 1. node scripts/send_member_emails.js --dry-run  (テスト: 差分チェックのみ)
 * 2. node scripts/send_member_emails.js            (未送信者リスト出力)
 * 3. node scripts/send_member_emails.js --mark-sent (送信済みとしてマーク)
 */

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY_LIVE);
const fs = require('fs');
const path = require('path');

// 購入リンク
const PURCHASE_URL = 'https://buy.stripe.com/aFacN7ezX6SV8zfcSrf7i03';

// メンバーコードファイル
const MEMBER_CODES_FILE = path.join(__dirname, '..', 'member_codes.csv');

// 送信済みリスト（このファイルで管理）
const SENT_LIST_FILE = path.join(__dirname, '..', 'data', 'aifes_sent_emails.json');

// 出力用（未送信者のみ）
const OUTPUT_FILE = path.join(__dirname, '..', 'member_email_list.csv');

// 送信済みリストを読み込み
function loadSentList() {
  try {
    if (fs.existsSync(SENT_LIST_FILE)) {
      return JSON.parse(fs.readFileSync(SENT_LIST_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('送信済みリスト読み込みエラー:', e.message);
  }
  return { sent: [], lastUpdated: null };
}

// 送信済みリストを保存
function saveSentList(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(SENT_LIST_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// 送信済みとしてマーク
function markAsSent(emails) {
  const data = loadSentList();
  const newEmails = emails.filter(e => !data.sent.includes(e));
  data.sent = [...data.sent, ...newEmails];
  saveSentList(data);
  return newEmails.length;
}

async function getMemberEmails() {
  // CSVを読み込み
  const csvContent = fs.readFileSync(MEMBER_CODES_FILE, 'utf-8');
  const lines = csvContent.trim().split('\n');
  const headers = lines[0].split(',');

  const members = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const memberId = values[0];
    const promoCode = values[1];

    try {
      // Stripeから顧客情報取得
      const customer = await stripe.customers.retrieve(memberId);

      members.push({
        member_id: memberId,
        email: customer.email,
        name: customer.name || '',
        promo_code: promoCode
      });

      console.log(`✓ ${customer.email} - ${promoCode}`);
    } catch (error) {
      console.error(`✗ ${memberId}: ${error.message}`);
    }
  }

  return members;
}

function generateEmailContent(member) {
  const subject = '【AI FES.】サークル会員様限定 無料参加チケットのご案内';

  const body = `
${member.name ? member.name + ' 様' : 'サークル会員 様'}

いつもAI×建築サークルをご利用いただき、ありがとうございます。

2026年1月25日(土)開催の「AI FES.」に、
サークル会員様は【無料】でご参加いただけます！

━━━━━━━━━━━━━━━━━━━━━━━━
■ お申し込み方法
━━━━━━━━━━━━━━━━━━━━━━━━

▼ 購入ページ
${PURCHASE_URL}

▼ あなた専用クーポンコード
${member.promo_code}

※ 購入画面で「プロモーションコードを追加」をクリックし、
  上記コードを入力すると無料になります。

━━━━━━━━━━━━━━━━━━━━━━━━
■ イベント概要
━━━━━━━━━━━━━━━━━━━━━━━━

日時: 2026年1月25日(土) 終日
形式: オンライン（Zoom）

【プログラム】
A. 直近30日：最新AI Newsまとめ（建築業界向け sena流）
B. 自社プロダクト（COMPASS/SpotPDF/KAKOME）使い方
C. 第２回実務で使えるAI×建築セミナー
D. 今使える画像生成AIセミナー（第２回開催）
E. Googleサービスでつくる無料HP＆業務自動化（GAS）セミナー
F. プレゼント配布＋最終質問タイム＋AI×建築サークル案内

━━━━━━━━━━━━━━━━━━━━━━━━
■ 重要事項
━━━━━━━━━━━━━━━━━━━━━━━━

・クーポンは1回限り有効です
・有効期限: 2026年1月25日 23:59まで
・お申し込み後、Zoom参加URLが自動でメール送信されます

ご不明点がございましたら、お気軽にお問い合わせください。

━━━━━━━━━━━━━━━━━━━━━━━━
AI FES. 運営事務局
━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

  return { subject, body };
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const markSent = process.argv.includes('--mark-sent');

  console.log('=== サークル会員 AI FES. 案内メール ===\n');

  // 送信済みリスト読み込み
  const sentData = loadSentList();
  console.log(`送信済み: ${sentData.sent.length}名`);
  if (sentData.lastUpdated) {
    console.log(`最終更新: ${sentData.lastUpdated}`);
  }
  console.log('');

  // --mark-sent モード: 前回出力したCSVの人を送信済みにする
  if (markSent) {
    if (fs.existsSync(OUTPUT_FILE)) {
      const csv = fs.readFileSync(OUTPUT_FILE, 'utf-8');
      const lines = csv.trim().split('\n').slice(1); // ヘッダー除く
      const emails = lines.map(line => line.split(',')[0]);
      const count = markAsSent(emails);
      console.log(`✓ ${count}名を送信済みとしてマークしました`);
    } else {
      console.log('member_email_list.csv が見つかりません');
    }
    return;
  }

  // メンバー情報取得
  console.log('Stripeからメンバー情報を取得中...\n');
  const allMembers = await getMemberEmails();

  // 未送信者だけフィルタ
  const newMembers = allMembers.filter(m => !sentData.sent.includes(m.email));

  console.log(`\n--------------------------`);
  console.log(`全会員: ${allMembers.length}名`);
  console.log(`送信済み: ${sentData.sent.length}名`);
  console.log(`★ 未送信: ${newMembers.length}名`);
  console.log(`--------------------------\n`);

  if (newMembers.length === 0) {
    console.log('新規の未送信者はいません！');
    return;
  }

  // 未送信者リスト表示
  console.log('【未送信者リスト】');
  newMembers.forEach((m, i) => {
    console.log(`${i + 1}. ${m.email} (${m.name || '名前なし'}) - ${m.promo_code}`);
  });
  console.log('');

  if (isDryRun) {
    console.log('[DRY RUN完了] CSVは出力しませんでした');
    return;
  }

  // CSV出力（未送信者のみ）
  const csvLines = ['email,name,promo_code,purchase_url'];
  newMembers.forEach(m => {
    csvLines.push(`${m.email},${m.name},${m.promo_code},${PURCHASE_URL}`);
  });
  fs.writeFileSync(OUTPUT_FILE, csvLines.join('\n'), 'utf-8');
  console.log(`✓ CSV出力: ${OUTPUT_FILE}`);
  console.log(`  → ${newMembers.length}名分\n`);

  // メール内容プレビュー
  console.log('--- メール内容プレビュー ---');
  const sample = generateEmailContent(newMembers[0]);
  console.log(`件名: ${sample.subject}\n`);
  console.log(sample.body);
  console.log('--- プレビュー終了 ---\n');

  console.log('=== 次のステップ ===');
  console.log('1. member_email_list.csv を確認');
  console.log('2. Gmailで送信（または GAS で一括送信）');
  console.log('3. 送信後、以下を実行して送信済みマーク:');
  console.log('   node scripts/send_member_emails.js --mark-sent');
}

main().catch(console.error);
