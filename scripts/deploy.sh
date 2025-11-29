#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
: "${REGION:?set REGION}"
: "${SERVICE_NAME:?set SERVICE_NAME}"

# Allow overriding the Discord client secret version without touching other secret bindings.
DISCORD_CLIENT_SECRET_VERSION=${DISCORD_CLIENT_SECRET_VERSION:-latest}

# Build the comma-separated secret mapping in a safe way.
secrets=(
  "STRIPE_MODE=STRIPE_MODE:latest"
  "STRIPE_SECRET_KEY_TEST=STRIPE_SECRET_KEY_TEST:latest"
  "STRIPE_WEBHOOK_SECRET_TEST=STRIPE_WEBHOOK_SECRET_TEST:latest"
  "STRIPE_PRICE_ID_MONTHLY_TEST=STRIPE_PRICE_ID_MONTHLY_TEST:latest"
  "STRIPE_PRICE_ID_YEARLY_TEST=STRIPE_PRICE_ID_YEARLY_TEST:latest"
  "STRIPE_SECRET_KEY_LIVE=STRIPE_SECRET_KEY_LIVE:latest"
  "STRIPE_WEBHOOK_SECRET_LIVE=STRIPE_WEBHOOK_SECRET_LIVE:latest"
  "STRIPE_PRICE_ID_MONTHLY_LIVE=STRIPE_PRICE_ID_MONTHLY_LIVE:latest"
  "STRIPE_PRICE_ID_YEARLY_LIVE=STRIPE_PRICE_ID_YEARLY_LIVE:latest"
  "DISCORD_CLIENT_ID=DISCORD_CLIENT_ID:latest"
  "DISCORD_CLIENT_SECRET=DISCORD_CLIENT_SECRET:${DISCORD_CLIENT_SECRET_VERSION}"
  "DISCORD_BOT_TOKEN=DISCORD_BOT_TOKEN:latest"
  "DISCORD_GUILD_ID=DISCORD_GUILD_ID:latest"
  "DISCORD_PRO_ROLE_ID=DISCORD_PRO_ROLE_ID:latest"
  "DISCORD_GUILD_INVITE_URL=DISCORD_GUILD_INVITE_URL:latest"
  "OAUTH_STATE_SECRET=OAUTH_STATE_SECRET:latest"
  "SCHEDULER_TOKEN=SCHEDULER_TOKEN:latest"
  "GCP_PROJECT_ID=GCP_PROJECT_ID:latest"
)

# Join the array with commas (Cloud Run expects a single argument for --set-secrets).
SECRET_ARG=$(IFS=, ; echo "${secrets[*]}")

# Deploy from source so Cloud Build produces a new image for Cloud Run.
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-secrets "$SECRET_ARG"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format 'value(status.url)')
echo "Deployed: $SERVICE_URL"
