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
