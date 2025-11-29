#!/usr/bin/env bash
set -euo pipefail
# Stripe Webhook’íü«ëkâ
stripe listen --events checkout.session.completed,customer.subscription.updated,customer.subscription.deleted \
  --forward-to localhost:8080/stripe/webhook