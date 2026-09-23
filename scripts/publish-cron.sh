#!/usr/bin/env bash
# Publishes cron/ to the public repository dstengine/rss-mobi-cron, which
# runs the scheduled jobs (docs/decisions/0003). cron/ here is the source;
# the public repository is only ever written by this script.
#
#   scripts/publish-cron.sh
#
# Pushing a workflow file needs a GitHub token with the `workflow` scope:
# `gh auth refresh -h github.com -s workflow` once.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=dstengine/rss-mobi-cron
src=$PWD/cron
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

gh repo clone "$REPO" "$tmp/repo" -- --quiet
cd "$tmp/repo"
git ls-files -z | xargs -0 rm -f
cp -R "$src/." .
git add -A
if git diff --cached --quiet; then
  echo "$REPO is up to date"
  exit 0
fi
git commit --quiet -m "Update from the rss.mobi repository ($(git -C "$src" rev-parse --short HEAD))"
git push --quiet origin HEAD
echo "$REPO updated"
