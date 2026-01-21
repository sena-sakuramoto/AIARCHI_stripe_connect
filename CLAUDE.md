# プロジェクトメモ

## ファイル構成（重要）

| ファイル | 内容 |
|---------|------|
| `index.js` | メインサーバー。サークル入会フォーム（`/`）のHTML含む |
| `aifes_page.js` | **AI FES.ページ（`/aifes`）のHTML** ← 別ファイル！ |
| `gas/webhook.gs` | GAS用Webhookスクリプト（Zoom登録・メール送信） |

**注意**: `/aifes` ページを編集する際は `aifes_page.js` を編集すること！

## 価格設定

| プラン | 価格 |
|-------|------|
| 通常会員（月額） | ¥5,000 |
| 学割（月額） | ¥2,000 |
| 年額プラン | ¥50,000 |

学割は `.ac.jp` / `.edu` / `.ed.jp` ドメインで自動適用

## デプロイ

```bash
gcloud run deploy stripe-discord-pro --source . --region asia-northeast1
```

- **本番サービス**: `stripe-discord-pro`
- **URL**: https://stripe-discord-pro-417218426761.asia-northeast1.run.app

## GAS

- `gas/webhook.gs` をGASエディタにコピペしてデプロイ
- スクリプトプロパティに `SCHEDULER_TOKEN` を設定
- デプロイ更新時は「デプロイを管理」→「編集」→「新しいバージョン」を選択

## エンドポイント

| パス | 説明 |
|-----|------|
| `/` | サークル入会フォーム（学割自動判定あり） |
| `/aifes` | AI FES.ページ（`aifes_page.js`で定義） |
| `/link` | メールアドレスでDiscord連携 |
| `/oauth/discord/start` | Discord OAuth開始 |
| `/admin/unlinked-customers` | 未連携者リスト取得 |

## サブスク入会時のフロー

```
[入会] → [Discord連携案内メール]
      → [AI FES. Zoom自動登録]
      → [AI FES.参加案内メール（Zoom URL付き）]
```

## Payment LinkについてPayment LinkはAPI経由で作成・編集する（Stripeダッシュボードではなく）
`buy.stripe.com/...` 形式のURLはStripe Payment Link
