#!/usr/bin/env bash
# Restores an encrypted backup into a database.
#
#   scripts/restore.sh <archive.gz.age> <target-db> [connection-string]
#
# Restore into a new database name (e.g. rssmobi_restore_test) and compare
# document counts before touching the live one. Needs `age` and
# `mongorestore` (brew install age mongodb-database-tools), and the key at
# ~/.config/rss-mobi/age.key. The connection string defaults to
# MONGODB_CONNECTION_STRING from .env.
set -euo pipefail
archive=${1:?archive path}
target=${2:?target database name}
cd "$(dirname "$0")/.."
if [ -z "${3:-}" ]; then set -a; . ./.env; set +a; uri=$MONGODB_CONNECTION_STRING; else uri=$3; fi
key=${AGE_KEY_FILE:-$HOME/.config/rss-mobi/age.key}

age -d -i "$key" "$archive" | mongorestore --uri="$uri" --gzip --archive \
  --nsFrom='rssmobi.*' --nsTo="$target.*"
echo "restored into $target"
