#!/usr/bin/env bash
# Copies secrets from .env to where they are used — Vercel (runtime) and
# GitHub Actions (cron, backups) — without printing a single value. Values
# go through stdin, never through the command line or a log.
#
#   scripts/sync-secrets.sh            # add what is missing
#   scripts/sync-secrets.sh --replace  # also overwrite what is there
#
# Upstash's KV_* variables are not here: the Vercel Marketplace sets them.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/env.sh; load_env .env
replace=${1:-}
REPO=dstengine/rss-mobi

VERCEL=(MONGODB_CONNECTION_STRING MONGODB_DB CRON_SECRET INDEXNOW_KEY TOKEN_ENC_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
  DATAFORSEO_LOGIN DATAFORSEO_PASSWORD GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET ANTHROPIC_API_KEY)
GITHUB=(MONGODB_CONNECTION_STRING CRON_SECRET AGE_PUBLIC_KEY R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
  TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID)

existing_vercel=$(vercel env ls production 2>/dev/null | awk 'NR>2 {print $1}')
for name in "${VERCEL[@]}"; do
  value=${!name:-}
  [ -z "$value" ] && { echo "vercel: $name not in .env, skipped"; continue; }
  if grep -qx "$name" <<<"$existing_vercel"; then
    [ "$replace" != "--replace" ] && { echo "vercel: $name already set"; continue; }
    vercel env rm "$name" production --yes >/dev/null
  fi
  printf '%s' "$value" | vercel env add "$name" production >/dev/null
  echo "vercel: $name set"
done

for name in "${GITHUB[@]}"; do
  value=${!name:-}
  [ -z "$value" ] && { echo "github: $name not in .env, skipped"; continue; }
  printf '%s' "$value" | gh secret set "$name" --repo "$REPO" >/dev/null
  echo "github: $name set"
done
