/**
 * Email Drip Campaign for AI Archi Circle Lead Nurturing
 *
 * Flow: Lead magnet download -> 7 emails over 21 days -> Circle signup
 *
 * Usage:
 *   node drip_campaign.js                    # Process pending emails
 *   node drip_campaign.js --add user@example.com "山田太郎" "山田設計事務所"
 *   node drip_campaign.js --status           # Show campaign status
 *   node drip_campaign.js --dry-run          # Preview without sending
 */

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');

const STATE_FILE = path.join(__dirname, 'data', 'drip_state.json');
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const FROM_EMAIL = process.env.FROM_EMAIL || GMAIL_USER || 'noreply@archi-prisma.co.jp';
const DRY_RUN = process.argv.includes('--dry-run');

// Gmail SMTP transporter
const transporter = (GMAIL_USER && GMAIL_APP_PASSWORD) ? nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
}) : null;

// ===== STEP DEFINITIONS =====
const STEPS = [
  {
    id: 1,
    delayDays: 0, // Immediate
    // 【無料ガイド】2025年4月施行 建築基準法改正 完全対応マニュアルをお届けします
    subject: '\u3010\u7121\u6599\u30AC\u30A4\u30C9\u30112025\u5E744\u6708\u65BD\u884C \u5EFA\u7BC9\u57FA\u6E96\u6CD5\u6539\u6B63 \u5B8C\u5168\u5BFE\u5FDC\u30DE\u30CB\u30E5\u30A2\u30EB\u3092\u304A\u5C4A\u3051\u3057\u307E\u3059',
    template: 'welcome'
  },
  {
    id: 2,
    delayDays: 2,
    // 4号特例縮小で変わる3つのこと ― 見落としていませんか？
    subject: '4\u53F7\u7279\u4F8B\u7E2E\u5C0F\u3067\u5909\u308F\u308B3\u3064\u306E\u3053\u3068 \u2015 \u898B\u843D\u3068\u3057\u3066\u3044\u307E\u305B\u3093\u304B\uFF1F',
    template: 'crisis'
  },
  {
    id: 3,
    delayDays: 5,
    // 省エネ計算、まだ外注していませんか？30秒で終わる方法
    subject: '\u7701\u30A8\u30CD\u8A08\u7B97\u3001\u307E\u3060\u5916\u6CE8\u3057\u3066\u3044\u307E\u305B\u3093\u304B\uFF1F30\u79D2\u3067\u7D42\u308F\u308B\u65B9\u6CD5',
    template: 'energy'
  },
  {
    id: 4,
    delayDays: 8,
    // 構造計算の外注コストを削減する方法
    subject: '\u69CB\u9020\u8A08\u7B97\u306E\u5916\u6CE8\u30B3\u30B9\u30C8\u3092\u524A\u6E1B\u3059\u308B\u65B9\u6CD5',
    template: 'kouzou'
  },
  {
    id: 5,
    delayDays: 12,
    // 28社が選んだ理由 ― AI建築サークル会員の声
    subject: '28\u793E\u304C\u9078\u3093\u3060\u7406\u7531 \u2015 AI\u5EFA\u7BC9\u30B5\u30FC\u30AF\u30EB\u4F1A\u54E1\u306E\u58F0',
    template: 'social_proof'
  },
  {
    id: 6,
    delayDays: 16,
    // 全ツール使い放題で月¥5,000。サークルのご案内
    subject: '\u5168\u30C4\u30FC\u30EB\u4F7F\u3044\u653E\u984C\u3067\u6708\u00A55,000\u3002\u30B5\u30FC\u30AF\u30EB\u306E\u3054\u6848\u5185',
    template: 'offer'
  },
  {
    id: 7,
    delayDays: 21,
    // 最後のご案内：法改正対応、間に合いますか？
    subject: '\u6700\u5F8C\u306E\u3054\u6848\u5185\uFF1A\u6CD5\u6539\u6B63\u5BFE\u5FDC\u3001\u9593\u306B\u5408\u3044\u307E\u3059\u304B\uFF1F',
    template: 'final'
  }
];

// ===== STATE MANAGEMENT =====
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { leads: [], lastProcessed: null };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ===== EMAIL SENDING (Gmail SMTP via nodemailer) =====
async function sendEmail(to, subject, html) {
  if (DRY_RUN) {
    console.log(`  [DRY_RUN] Would send to ${to}: "${subject}"`);
    return true;
  }

  if (!transporter) {
    console.error('  GMAIL_USER / GMAIL_APP_PASSWORD not set');
    return false;
  }

  const delays = [1000, 2000, 4000];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await transporter.sendMail({
        from: `AI Archi Circle <${FROM_EMAIL}>`,
        to,
        subject,
        html,
        textEncoding: 'base64'
      });
      console.log(`  [OK] ${to}`);
      return true;
    } catch (e) {
      console.error(`  [FAIL] attempt ${attempt + 1}/3: ${e.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
  return false;
}

// ===== EMAIL TEMPLATES =====
function generateHtml(templateId, lead) {
  const name = lead.name || '\u3054\u62C5\u5F53\u8005';
  const base = (title, body, cta, ctaUrl) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;font-family:'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN',sans-serif;background:#f5f5f0;color:#1a1a2e;">
<div style="max-width:580px;margin:0 auto;background:#fff;">
  <div style="background:#0a1628;padding:28px 32px;">
    <div style="color:#c23616;font-size:11px;letter-spacing:0.15em;font-weight:700;">AI Archi Circle</div>
    <div style="color:#fff;font-size:18px;font-weight:700;margin-top:8px;line-height:1.5;">${title}</div>
  </div>
  <div style="padding:32px;line-height:1.9;font-size:14px;color:#333;">
    <p>${name}\u3055\u3093</p>
    ${body}
    ${cta ? `<div style="text-align:center;margin:32px 0;"><a href="${ctaUrl}" style="display:inline-block;background:#c23616;color:#fff;padding:14px 36px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.05em;">${cta}</a></div>` : ''}
  </div>
  <div style="padding:20px 32px;background:#f8f8f5;font-size:11px;color:#999;line-height:1.7;">
    <p>Archi-Prisma Design Works\u682A\u5F0F\u4F1A\u793E | AI Archi Circle</p>
    <p><a href="https://stripe-discord-pro-417218426761.asia-northeast1.run.app/api/unsubscribe?email=${encodeURIComponent(lead.email)}" style="color:#999;text-decoration:underline;">\u914D\u4FE1\u505C\u6B62\u306F\u3053\u3061\u3089</a></p>
  </div>
</div></body></html>`;

  const templates = {
    welcome: base(
      '\u30AC\u30A4\u30C9\u3092\u304A\u5C4A\u3051\u3057\u307E\u3059',
      `<p>2025\u5E744\u6708\u65BD\u884C \u5EFA\u7BC9\u57FA\u6E96\u6CD5\u6539\u6B63 \u5B8C\u5168\u5BFE\u5FDC\u30DE\u30CB\u30E5\u30A2\u30EB\u306E\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3059\u3002</p>
      <p>\u4E0B\u8A18\u306E\u30EA\u30F3\u30AF\u304B\u3089\u30AC\u30A4\u30C9\u3092\u3054\u89A7\u3044\u305F\u3060\u3051\u307E\u3059\u3002</p>
      <p>\u3053\u306E\u30AC\u30A4\u30C9\u3067\u306F\u30014\u53F7\u7279\u4F8B\u7E2E\u5C0F\u3068\u7701\u30A8\u30CD\u9069\u5408\u7FA9\u52D9\u5316\u306E\u5B9F\u52D9\u5BFE\u5FDC\u3092\u3001\u8A2D\u8A08\u4E8B\u52D9\u6240\u7D4C\u55B6\u8005\u306E\u8996\u70B9\u3067\u89E3\u8AAC\u3057\u3066\u3044\u307E\u3059\u3002</p>
      <p>\u3054\u4E0D\u660E\u306A\u70B9\u304C\u3042\u308C\u3070\u3001\u304A\u6C17\u8EFD\u306B\u3053\u306E\u30E1\u30FC\u30EB\u306B\u8FD4\u4FE1\u3057\u3066\u304F\u3060\u3055\u3044\u3002</p>
      <p style="margin-top:16px;">\u6AFC\u672C\u8056\u6210\uFF08Sena\uFF09<br>AI Archi Circle\u4E3B\u5BB0</p>`,
      '\u30AC\u30A4\u30C9\u3092\u898B\u308B',
      'https://ai-archi-circle.archi-prisma.co.jp/guide/'
    ),
    crisis: base(
      '4\u53F7\u7279\u4F8B\u7E2E\u5C0F\u3067\u5909\u308F\u308B3\u3064\u306E\u3053\u3068',
      `<p>\u30AC\u30A4\u30C9\u306F\u304A\u8AAD\u307F\u3044\u305F\u3060\u3051\u307E\u3057\u305F\u304B\uFF1F</p>
      <p>\u4ECA\u65E5\u306F\u3001\u6CD5\u6539\u6B63\u306E\u4E2D\u3067\u3082\u7279\u306B\u898B\u843D\u3068\u3057\u3084\u3059\u30443\u3064\u306E\u30DD\u30A4\u30F3\u30C8\u3092\u304A\u4F1D\u3048\u3057\u307E\u3059\u3002</p>
      <p><strong>1. \u58C1\u91CF\u8A08\u7B97\u3060\u3051\u3067\u306F\u4E0D\u5341\u5206\u306B\u306A\u308B\u30B1\u30FC\u30B9\u3082</strong><br>\u4E00\u822C\u7684\u306A\u4F4F\u5B85\uFF08300m\u00B2\u4EE5\u4E0B\uFF09\u3067\u306F\u5F93\u6765\u901A\u308A\u4ED5\u69D8\u898F\u5B9A\uFF08\u58C1\u91CF\u8A08\u7B97\uFF09\u3067\u5BFE\u5FDC\u3067\u304D\u307E\u3059\u304C\u3001\u898F\u6A21\u304C\u5927\u304D\u3044\u5834\u5408\u3084\u7279\u6B8A\u306A\u69CB\u9020\u306E\u5834\u5408\u306F\u3001N\u5024\u8A08\u7B97\u3084\u8A31\u5BB9\u5FDC\u529B\u5EA6\u8A08\u7B97\u304C\u6C42\u3081\u3089\u308C\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002</p>
      <p><strong>2. \u78BA\u8A8D\u7533\u8ACB\u306E\u6DFB\u4ED8\u66F8\u985E\u304C\u500D\u5897</strong><br>\u69CB\u9020\u95A2\u4FC2\u56F3\u66F8\u3068\u7701\u30A8\u30CD\u8A08\u7B97\u66F8\u306E\u4E21\u65B9\u304C\u5FC5\u8981\u306B\u306A\u308A\u307E\u3059\u3002</p>
      <p><strong>3. \u5916\u6CE8\u30B3\u30B9\u30C8\u304C\u6848\u4EF6\u5229\u76CA\u3092\u5727\u8FEB</strong><br>1\u6848\u4EF6\u3042\u305F\u308A10\u301C30\u4E07\u5186\u306E\u8FFD\u52A0\u30B3\u30B9\u30C8\u3002\u5E74\u9593\u3067\u898B\u308B\u3068\u5927\u304D\u306A\u30A4\u30F3\u30D1\u30AF\u30C8\u3067\u3059\u3002</p>
      <p>\u300C\u3067\u3082\u3001\u81EA\u793E\u3067\u3084\u308B\u306B\u306F\u30B9\u30AD\u30EB\u304C\u2026\u300D\u305D\u3093\u306A\u58F0\u306B\u5FDC\u3048\u308B\u306E\u304CAI\u30C4\u30FC\u30EB\u3067\u3059\u3002\u6B21\u56DE\u306E\u30E1\u30FC\u30EB\u3067\u5177\u4F53\u7684\u306A\u65B9\u6CD5\u3092\u304A\u4F1D\u3048\u3057\u307E\u3059\u3002</p>`,
      '\u7121\u6599\u30AC\u30A4\u30C9\u3067\u8A73\u3057\u304F\u78BA\u8A8D\u3059\u308B',
      'https://ai-archi-circle.archi-prisma.co.jp/guide/'
    ),
    energy: base(
      '\u7701\u30A8\u30CD\u8A08\u7B97\u304C30\u79D2\u3067\u7D42\u308F\u308B\u6642\u4EE3',
      `<p>\u7701\u30A8\u30CD\u9069\u5408\u7FA9\u52D9\u5316\u3002\u6BCE\u56DE\u5916\u6CE8\u3059\u308B\u30681\u6848\u4EF65\u301C15\u4E07\u5186\u3002\u5E74\u9593\u3067\u898B\u308B\u3068\u5927\u304D\u306A\u30B3\u30B9\u30C8\u3067\u3059\u3002</p>
      <p>AI Archi Circle\u306E\u300C\u697D\u3005\u7701\u30A8\u30CD\u8A08\u7B97\u300D\u306A\u3089\uFF1A</p>
      <ul style="padding-left:20px;">
        <li>\u5EFA\u7269\u6982\u8981\u3092\u5165\u529B\u3059\u308B\u3060\u3051\u3067BEI\u5024\u3092\u81EA\u52D5\u8A08\u7B97</li>
        <li>8\u3064\u306E\u6C17\u5019\u533A\u5206\u306B\u5BFE\u5FDC</li>
        <li>\u9069\u5408\u6027\u5224\u5B9A\u7533\u8ACB\u66F8\u3092\u305D\u306E\u307E\u307E\u51FA\u529B</li>
        <li>\u5916\u6CE8\u30B3\u30B9\u30C8\u306E\u524A\u6E1B\u306B\u8CA2\u732E</li>
      </ul>
      <p>\u30B5\u30FC\u30AF\u30EB\u4F1A\u54E1\u306A\u3089\u8FFD\u52A0\u6599\u91D1\u306A\u3057\u3067\u4F7F\u3048\u307E\u3059\u3002</p>`,
      '\u7701\u30A8\u30CD\u8A08\u7B97\u30C4\u30FC\u30EB\u3092\u898B\u308B',
      'https://rakuraku-energy.archi-prisma.co.jp/'
    ),
    kouzou: base(
      '\u69CB\u9020\u8A08\u7B97\u306E\u5916\u6CE8\u30B3\u30B9\u30C8\u3092\u524A\u6E1B\u3059\u308B\u65B9\u6CD5',
      `<p>\u69CB\u9020\u8A08\u7B97\u306E\u5916\u6CE8\u306F\u30011\u6848\u4EF6\u3042\u305F\u308A\u6570\u4E07\u5186\u301C\u6570\u5341\u4E07\u5186\u306E\u30B3\u30B9\u30C8\u304C\u304B\u304B\u308A\u307E\u3059\u3002\u6848\u4EF6\u6570\u304C\u5897\u3048\u308B\u307B\u3069\u3001\u5E74\u9593\u306E\u5916\u6CE8\u8CBB\u306F\u7D4C\u55B6\u3092\u5727\u8FEB\u3057\u307E\u3059\u3002</p>
      <p>Kouzou\uFF08\u69CB\u9020\u8A08\u7B97\u30C4\u30FC\u30EB\uFF09\u3092\u4F7F\u3048\u3070\u3001\u3053\u308C\u3089\u306E\u8A08\u7B97\u3092\u81EA\u793E\u3067\u5BFE\u5FDC\u3067\u304D\u308B\u3088\u3046\u306B\u306A\u308A\u307E\u3059\uFF1A</p>
      <ul style="padding-left:20px;">
        <li>\u58C1\u91CF\u8A08\u7B97\u30FBN\u5024\u8A08\u7B97\u3092\u81EA\u5206\u3067\u5B9F\u884C</li>
        <li>\u8A08\u7B97\u66F8PDF\u3092\u81EA\u52D5\u751F\u6210</li>
        <li>\u6728\u9020\u30FBRC\u30FBS\u9020\u306B\u5BFE\u5FDC</li>
        <li>\u5916\u6CE8\u306B\u983C\u3089\u306A\u3044\u4F53\u5236\u3067\u30B3\u30B9\u30C8\u3092\u5927\u5E45\u306B\u524A\u6E1B</li>
      </ul>
      <p>4\u53F7\u7279\u4F8B\u7E2E\u5C0F\u3067\u69CB\u9020\u95A2\u4FC2\u56F3\u66F8\u306E\u63D0\u51FA\u304C\u5FC5\u8981\u306B\u306A\u308B\u4ECA\u3001\u5185\u88FD\u5316\u306F\u751F\u304D\u6B8B\u308A\u306E\u9375\u3067\u3059\u3002</p>`,
      '\u69CB\u9020\u8A08\u7B97\u30C4\u30FC\u30EB\u3092\u898B\u308B',
      'https://kouzou.archi-prisma.co.jp/'
    ),
    social_proof: base(
      '28\u793E\u304C\u9078\u3093\u3060\u7406\u7531',
      `<p>AI Archi Circle\u306B\u306F\u73FE\u572828\u793E\u4EE5\u4E0A\u306E\u8A2D\u8A08\u4E8B\u52D9\u6240\u30FB\u5DE5\u52D9\u5E97\u304C\u53C2\u52A0\u3057\u3066\u3044\u307E\u3059\u3002</p>
      <p><strong>\u4F1A\u54E1\u306E\u58F0\uFF1A</strong></p>
      <blockquote style="border-left:3px solid #c23616;padding-left:16px;margin:16px 0;color:#555;">
        \u300C\u69CB\u9020\u8A08\u7B97\u3092\u5916\u6CE8\u3059\u308B\u30681\u4EF620\u4E07\u3002\u81EA\u793E\u3067\u5BFE\u5FDC\u3067\u304D\u308B\u3088\u3046\u306B\u306A\u308A\u3001\u5E74\u9593\u3067\u6570\u767E\u4E07\u306E\u30B3\u30B9\u30C8\u524A\u6E1B\u306B\u3002\u300D<br>
        <small>\u2015 \u8A2D\u8A08\u4E8B\u52D9\u6240\u7D4C\u55B6 / \u6771\u4EAC\u90FD</small>
      </blockquote>
      <blockquote style="border-left:3px solid #c23616;padding-left:16px;margin:16px 0;color:#555;">
        \u300CCompass\u3067\u5168\u6848\u4EF6\u306E\u9032\u6357\u304C\u4E00\u76EE\u3067\u308F\u304B\u308B\u3088\u3046\u306B\u3002\u793E\u9577\u306E\u300E\u4ECA\u3069\u3046\u306A\u3063\u3066\u308B\uFF1F\u300F\u304C\u6FC0\u6E1B\u3057\u307E\u3057\u305F\u3002\u300D<br>
        <small>\u2015 \u5DE5\u52D9\u5E97 / \u57FC\u7389\u770C</small>
      </blockquote>
      <p>\u6708\u984D\u00A55,000\u3067\u5168\u30C4\u30FC\u30EB\u4F7F\u3044\u653E\u984C\uFF0B\u30BB\u30DF\u30CA\u30FC\uFF0B1on1\u9762\u8AC7\u3002\u540C\u3058\u8AB2\u984C\u3092\u6301\u3064\u4EF2\u9593\u3068\u7E4B\u304C\u308C\u308B\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u3067\u3059\u3002</p>`,
      '\u30B5\u30FC\u30AF\u30EB\u306E\u8A73\u7D30\u3092\u898B\u308B',
      'https://ai-archi-circle.archi-prisma.co.jp/'
    ),
    offer: base(
      '\u5168\u30C4\u30FC\u30EB\u4F7F\u3044\u653E\u984C\u3067\u6708\u00A55,000',
      `<p>\u6CD5\u6539\u6B63\u5BFE\u5FDC\u306B\u5FC5\u8981\u306A\u3082\u306E\u3001\u5168\u90E8\u307E\u3068\u3081\u307E\u3057\u305F\u3002</p>
      <p><strong>AI Archi Circle\u306B\u542B\u307E\u308C\u308B\u3082\u306E\uFF1A</strong></p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
        <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;">Compass\uFF08\u5DE5\u7A0B\u7BA1\u7406\uFF09</td><td style="color:#c23616;font-weight:700;">\u4F7F\u3044\u653E\u984C</td></tr>
        <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;">Kouzou\uFF08\u69CB\u9020\u8A08\u7B97\uFF09</td><td style="color:#c23616;font-weight:700;">\u4F7F\u3044\u653E\u984C</td></tr>
        <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;">\u7701\u30A8\u30CD\u8A08\u7B97</td><td style="color:#c23616;font-weight:700;">\u4F7F\u3044\u653E\u984C</td></tr>
        <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;">KOKOME\uFF08\u73FE\u5834\u6307\u793A\u66F8\uFF09</td><td style="color:#c23616;font-weight:700;">\u4F7F\u3044\u653E\u984C</td></tr>
        <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;">AICommander\uFF08ArchiCAD AI\uFF09</td><td style="color:#c23616;font-weight:700;">\u4F7F\u3044\u653E\u984C</td></tr>
        <tr style="border-bottom:1px solid #eee;"><td style="padding:8px 0;">\u67081-2\u56DE\u306E\u30BB\u30DF\u30CA\u30FC</td><td style="color:#c23616;font-weight:700;">\u53C2\u52A0\u7121\u6599</td></tr>
        <tr><td style="padding:8px 0;">Sena\u3068\u306E1on1\u9762\u8AC7\uFF08\u67083\u56DE\uFF09</td><td style="color:#c23616;font-weight:700;">\u7121\u6599</td></tr>
      </table>
      <p style="font-size:24px;font-weight:900;text-align:center;margin:24px 0;color:#0a1628;">\u6708\u984D \u00A55,000<span style="font-size:13px;font-weight:400;">\uFF08\u7A0E\u8FBC\uFF09</span></p>
      <p style="text-align:center;font-size:12px;color:#999;">\u5B66\u751F\u30D7\u30E9\u30F3 \u00A52,000/\u6708 | \u5E74\u984D\u30D7\u30E9\u30F3 \u00A550,000</p>`,
      '\u30B5\u30FC\u30AF\u30EB\u306B\u53C2\u52A0\u3059\u308B\uFF08\u5E74\u9593\u30D7\u30E9\u30F3\u304C\u304A\u5F97\uFF09',
      'https://stripe-discord-pro-417218426761.asia-northeast1.run.app/?plan=yearly'
    ),
    final: base(
      '\u6700\u5F8C\u306E\u3054\u6848\u5185',
      `<p>\u3053\u308C\u307E\u30676\u901A\u306E\u30E1\u30FC\u30EB\u3092\u304A\u9001\u308A\u3057\u3066\u304D\u307E\u3057\u305F\u3002</p>
      <p>\u6CD5\u6539\u6B63\u306E\u65BD\u884C\u304C\u8FEB\u308B\u4E2D\u3001\u6E96\u5099\u306F\u9032\u3093\u3067\u3044\u307E\u3059\u304B\uFF1F</p>
      <p>AI Archi Circle\u3067\u306F\u300128\u793E\u4EE5\u4E0A\u306E\u8A2D\u8A08\u4E8B\u52D9\u6240\u304C\u65E2\u306BAI\u30C4\u30FC\u30EB\u3067\u6CD5\u6539\u6B63\u306B\u5BFE\u5FDC\u3057\u3066\u3044\u307E\u3059\u3002</p>
      <p>\u3082\u3057\u5C11\u3057\u3067\u3082\u8208\u5473\u304C\u3042\u308C\u3070\u3001\u307E\u305A\u306F\u30B5\u30FC\u30AF\u30EB\u306E\u8A73\u7D30\u3092\u3054\u89A7\u304F\u3060\u3055\u3044\u3002\u8CEA\u554F\u304C\u3042\u308C\u3070\u3044\u3064\u3067\u3082\u3053\u306E\u30E1\u30FC\u30EB\u306B\u8FD4\u4FE1\u3057\u3066\u304F\u3060\u3055\u3044\u3002</p>
      <p>\u304A\u5FD9\u3057\u3044\u4E2D\u3001\u304A\u8AAD\u307F\u3044\u305F\u3060\u304D\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3057\u305F\u3002</p>
      <p style="margin-top:16px;">\u6AFC\u672C\u8056\u6210\uFF08Sena\uFF09<br>AI Archi Circle\u4E3B\u5BB0</p>`,
      '\u4ECA\u3059\u3050\u53C2\u52A0\u3059\u308B',
      'https://stripe-discord-pro-417218426761.asia-northeast1.run.app/?plan=monthly'
    )
  };

  return templates[templateId] || templates.welcome;
}

// ===== CORE LOGIC =====
async function addLead(email, name, company) {
  const state = loadState();
  if (state.leads.some(l => l.email === email)) {
    console.log(`Lead already exists: ${email}`);
    return;
  }
  state.leads.push({
    email,
    name: name || '',
    company: company || '',
    joinedAt: new Date().toISOString(),
    currentStep: 0,
    completedSteps: [],
    lastSentAt: null
  });
  saveState(state);
  console.log(`Lead added: ${email} (${name}, ${company})`);
}

async function processLeads() {
  const state = loadState();
  const now = new Date();
  let sentCount = 0;

  console.log(`\nProcessing ${state.leads.length} leads... (${DRY_RUN ? 'DRY RUN' : 'LIVE'})\n`);

  for (const lead of state.leads) {
    if (lead.unsubscribed) continue;
    const joinedAt = new Date(lead.joinedAt);
    const daysSinceJoin = (now.getTime() - joinedAt.getTime()) / (1000 * 60 * 60 * 24);

    // Find next step to send
    for (const step of STEPS) {
      if (lead.completedSteps.includes(step.id)) continue;
      if (daysSinceJoin < step.delayDays) break;

      console.log(`[Step ${step.id}] ${lead.email} - "${step.subject}"`);
      const html = generateHtml(step.template, lead);
      const sent = await sendEmail(lead.email, step.subject, html);

      if (sent) {
        lead.completedSteps.push(step.id);
        lead.currentStep = step.id;
        lead.lastSentAt = now.toISOString();
        sentCount++;
      }

      // Only send one email per lead per run
      break;
    }
  }

  state.lastProcessed = now.toISOString();
  saveState(state);
  console.log(`\nDone. Sent ${sentCount} emails.`);
}

function showStatus() {
  const state = loadState();
  console.log(`\n=== Drip Campaign Status ===`);
  console.log(`Total leads: ${state.leads.length}`);
  console.log(`Last processed: ${state.lastProcessed || 'never'}\n`);

  for (const lead of state.leads) {
    const completed = lead.completedSteps.length;
    const total = STEPS.length;
    const pct = Math.round((completed / total) * 100);
    console.log(`  ${lead.email.padEnd(30)} [${completed}/${total}] ${pct}% ${lead.company || ''}`);
  }
  console.log('');
}

// ===== Export for HTTP endpoint =====
module.exports = { processLeads, addLead, showStatus };

// ===== CLI =====
if (require.main === module) {
  async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--add')) {
      const idx = args.indexOf('--add');
      const email = args[idx + 1];
      const name = args[idx + 2] || '';
      const company = args[idx + 3] || '';
      if (!email) { console.error('Usage: --add <email> [name] [company]'); process.exit(1); }
      await addLead(email, name, company);
    } else if (args.includes('--status')) {
      showStatus();
    } else {
      await processLeads();
    }
  }

  main().catch(e => { console.error(e); process.exit(1); });
}
