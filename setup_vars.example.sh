#!/usr/bin/env bash
# Stripe × Discord 自動化システム 環境変数設定（例）

# ── GCP 基本
export PROJECT_ID="your-gcp-project-id"
export REGION="asia-northeast1"
export SERVICE_NAME="stripe-discord-pro"

# ── Stripe（テスト／本番をスイッチ）
export STRIPE_MODE="test" # test | live

# Stripe テストモード設定
export STRIPE_SECRET_KEY_TEST="sk_test_YOUR_TEST_KEY"
export STRIPE_WEBHOOK_SECRET_TEST=""  # 後でWebhook作成時に設定
export STRIPE_PRICE_ID_MONTHLY_TEST="price_YOUR_MONTHLY_TEST_PRICE"   # JPY 5,000/月
export STRIPE_PRICE_ID_YEARLY_TEST="price_YOUR_YEARLY_TEST_PRICE"     # JPY 50,000/年
export STRIPE_ADDITIONAL_PRICE_IDS_TEST=""  # カンマ区切りで追加テストPrice IDを列挙

export STRIPE_SECRET_KEY_LIVE="sk_live_YOUR_LIVE_KEY"
export STRIPE_WEBHOOK_SECRET_LIVE="whsec_YOUR_WEBHOOK_SECRET"
export STRIPE_PRICE_ID_MONTHLY_LIVE="price_YOUR_MONTHLY_LIVE_PRICE"   # JPY 5,000/月
export STRIPE_PRICE_ID_YEARLY_LIVE="price_YOUR_YEARLY_LIVE_PRICE"     # JPY 50,000/年
export STRIPE_ADDITIONAL_PRICE_IDS_LIVE=""  # カンマ区切りで追加ライブPrice IDを列挙

# ── Discord設定
export DISCORD_CLIENT_ID="YOUR_DISCORD_CLIENT_ID"
export DISCORD_CLIENT_SECRET="YOUR_DISCORD_CLIENT_SECRET"
export DISCORD_BOT_TOKEN="YOUR_DISCORD_BOT_TOKEN"
export DISCORD_GUILD_ID="YOUR_DISCORD_GUILD_ID"  # サーバーID
export DISCORD_PRO_ROLE_ID="YOUR_DISCORD_PRO_ROLE_ID"  # @proロールID
export DISCORD_GUILD_INVITE_URL="https://discord.gg/YOUR_INVITE_CODE"  # サーバー招待URL

# ── OAuth/セキュリティ
export OAUTH_STATE_SECRET="YOUR_RANDOM_SECRET_32_CHARS_OR_MORE"
export SCHEDULER_TOKEN="YOUR_RANDOM_TOKEN_32_CHARS_OR_MORE"

# ── Firestore/Run
export GCP_PROJECT_ID="$PROJECT_ID"

echo "環境変数設定完了"
echo "使い方: cp setup_vars.example.sh setup_vars.sh を実行して、実際の値を入力してください"
