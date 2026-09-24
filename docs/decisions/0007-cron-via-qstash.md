# 0007 — Scheduled jobs move to QStash; GitHub stays as a fallback

**Date:** 2026-09-24 · **Status:** accepted · **Supersedes part of ADR 0003**

ADR 0003 said to reopen if GitHub's schedule drifted past 30 minutes
regularly. In its first day, `*/15` ran four times in eighteen hours —
three to five hours apart. The feed poll and the index-check queue both
assume a run every quarter hour.

The jobs are now called by Upstash QStash schedules, created by
`scripts/qstash-schedules.mjs`: `/api/v1/cron/fetch` every 15 minutes and
`/api/v1/cron/index-check` seven minutes later. QStash sends the same
`Authorization: Bearer $CRON_SECRET` the workflow sends, so the routes did
not change. The free plan allows 1,000 messages a day; these use 192.
QStash comes through the Vercel Marketplace like Redis
(`upstash/upstash-qstash`), and its token is `QSTASH_TOKEN`.

The GitHub workflow keeps running, moved off the quarter hours
(`7,22,37,52`), where GitHub says it delays and drops the fewest runs. Both
jobs take Redis locks and only do what is due, so a second caller adds
nothing but a safety net.

**Reopen if:** QStash's free plan changes, a third job pushes the count
near 1,000 a day, or the project moves to Vercel Pro and its own cron.
