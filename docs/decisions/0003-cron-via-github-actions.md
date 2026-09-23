# 0003 — Scheduled jobs run from GitHub Actions

**Date:** 2026-09-23 · **Status:** accepted

Vercel's cron runs once a day on the Hobby plan; a feed reader needs to
poll every hour and the index-check queue must move continuously.
`.github/workflows/cron.yml` calls `POST /api/v1/cron/*` every 15 minutes
with `Authorization: Bearer $CRON_SECRET`. The jobs are idempotent and take
Redis locks, so a late or doubled run does no harm.

This works because the repository is public. `dstengine` is on GitHub's
free plan: a private repository gets 2,000 Actions minutes a month, and a
run every 15 minutes bills at least a minute each, about 2,900 a month.
While the code was private the workflow lived in a separate public
repository, `dstengine/rss-mobi-cron`, now archived. The log is public, so
the job prints status codes only.

GitHub's schedule can drift by several minutes under load, and it switches
schedules off in a public repository after 60 days without activity. A
monthly keepalive job re-enables the workflow; the weekly retro notices a
stalled queue if that ever fails.

**Reopen if:** the repository goes private again (bring back a public
scheduler repository, or run hourly), the project moves to Vercel Pro
(per-minute cron), GitHub drift exceeds 30 minutes regularly, or GitHub
objects to the schedule — then QStash, which comes with the Upstash
account, is the next candidate.
