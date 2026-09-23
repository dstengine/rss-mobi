# 0003 — Scheduled jobs run from GitHub Actions, in a public repository

**Date:** 2026-09-23 · **Status:** accepted

Vercel's cron runs once a day on the Hobby plan; a feed reader needs to
poll every hour and the index-check queue must move continuously. A
workflow calls `POST /api/v1/cron/*` every 15 minutes with
`Authorization: Bearer $CRON_SECRET`. The jobs are idempotent and take
Redis locks, so a late or doubled run does no harm.

The workflow does not run in this repository. `dstengine` is on GitHub's
free plan, which gives private repositories 2,000 Actions minutes a month;
a run every 15 minutes bills at least a minute each, about 2,900 a month.
Public repositories have no limit, so the scheduler lives in the public
`dstengine/rss-mobi-cron`. Its source is `cron/` here, published by
`scripts/publish-cron.sh`; it holds one secret, `CRON_SECRET`, and its log
prints status codes only. The private repository keeps the nightly backup
and CI, well inside the allowance.

GitHub's schedule can drift by several minutes under load, and it switches
schedules off in a public repository after 60 days without activity. A
monthly keepalive job re-enables the workflow; the weekly retro notices a
stalled queue if that ever fails.

**Reopen if:** the project moves to Vercel Pro (per-minute cron), GitHub
drift exceeds 30 minutes regularly, or GitHub objects to a repository that
exists only to run a schedule — then QStash, which comes with the Upstash
account, is the next candidate.
