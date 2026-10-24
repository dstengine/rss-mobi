# 0002 — Upstash Redis for limits, locks and the short cache

**Date:** 2026-09-23 · **Status:** accepted

Serverless instances share no memory, so rate limits, job locks and quota
counters need a store all of them can see, answering in single-digit
milliseconds over HTTP. Upstash is attached through the Vercel Marketplace,
so its credentials arrive as project env vars.

Every function in `src/lib/cache.ts` falls back to process memory when Redis
is not configured, so development and tests need no account. In production
that fallback is per-instance and nearly useless, and it logs an error.

**Reopen if:** the free tier's command allowance is exceeded, or rate limits
move to Vercel's own firewall rules.

**2026-10-25:** the allowance was exceeded on 14 Oct, and the per-feed
poll lock left Redis for MongoDB — a `findOneAndUpdate` claim on the feed
itself (`pollingUntil`, `claim()` in `src/lib/catalog.ts`). At two
commands a poll it was some 24 000 commands a day, nearly all of the
store's traffic. Redis keeps the limiter, the three run locks, the quota
counters and the short cache: about 2 500 commands a day, a seventh of
the plan (docs/learnings.md). The condition above stands.
