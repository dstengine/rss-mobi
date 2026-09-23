# 0003 — Scheduled jobs run from GitHub Actions

**Date:** 2026-09-23 · **Status:** accepted

Vercel's cron runs once a day on the Hobby plan; a feed reader needs to
poll every hour and the index-check queue must move continuously.
`.github/workflows/cron.yml` calls `POST /api/v1/cron/*` every 15 minutes
with `Authorization: Bearer $CRON_SECRET`. The jobs are idempotent and take
Redis locks, so a late or doubled run does no harm.

GitHub's schedule can drift by several minutes under load and pauses on
repositories with no activity for 60 days. Neither matters at hourly
polling, and the weekly retro notices a stalled queue.

**Reopen if:** the project moves to Vercel Pro (per-minute cron), or GitHub
drift exceeds 30 minutes regularly.
