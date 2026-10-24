# 0008 — Off Upstash: limits, locks and counters in MongoDB, jobs on Vercel Cron

**Date:** 2026-10-25 · **Status:** accepted · **Supersedes ADR 0002 and ADR 0007**

Upstash's free plan, 500 000 Redis commands a month, ran out on 14 Oct
2026 and took the API, the poller and every cron down for ten days
(docs/learnings.md). Once the per-feed lock left Redis (dstengine/rss-mobi#45),
what Redis still held came to about 2 500 commands a day: the limiter,
three run locks, the quota counters and a short cache. QStash called the
jobs from the same account. On 25 Oct the owner decided that rss.mobi uses
no Upstash at all. One store and one quota fewer to watch is worth more
than a second store that costs nothing.

**Limits, locks and counters live in MongoDB**, in the collections
`counters` and `locks` (`src/lib/cache.ts`), one write an operation:

- A counter is one `findOneAndUpdate` upsert whose pipeline update starts
  the count again once its `exp` has passed.
- The limiter is a counter per id whose window opens at the id's first
  request, a fixed window where Upstash's was sliding. An id can get up to
  twice its allowance across the end of one window and the start of the
  next, which these limits can bear. A refused id is held in process until
  its window ends, so a client that keeps asking costs no write.
- A lock is an `updateOne` upsert on `{ _id, exp ≤ now }`. A held lock makes
  the insert collide on `_id`, and that collision is the refusal. `unlock`
  deletes only a lock this process took.
- TTL indexes on `exp` sweep both collections (`scripts/migrate.mjs`). The
  code reads `exp` itself, so the sweep's lag holds nothing.

At today's traffic that is some 2 500 writes a day. The Atlas M0 cluster
allows about 100 operations a second, and every API read already queries
it. As before, each function falls back to process memory when the
database answers an error, and says so once a minute. `storeUp()` probes
with a write, because an Atlas free cluster at its storage cap refuses
writes and still answers reads; the index check, which spends money
against a shared daily budget, stops when the probe fails.

**The short cache lives in process memory**: the tag statistics, five
minutes per warm instance. The pages that show them send CDN cache headers
already, so the CDN absorbs the repeats.

**The jobs run on Vercel Cron Jobs** (`vercel.json`), now that the team is
on the Pro plan (21 Oct 2026): `fetch` every 15 minutes, `index-check` at
7, 22, 37 and 52 past the hour, `metrics` at 00:41 and `stories` at 05:05
UTC. Vercel calls with GET and `Authorization: Bearer $CRON_SECRET`, so the
routes take GET as well as POST. Vercel retries no failed run and may
deliver one twice, so every job is safe to repeat: `fetch` claims each
feed, `index-check` and `metrics` take locks, and `stories` runs once a UTC
day. The GitHub Actions workflow stays as the fallback (ADR 0003).

**Reopen if:** the API's traffic makes the limiter's writes a real share of
what the cluster allows (tens of requests a second); the team leaves Pro,
since Hobby runs a cron once a day and fails a deploy that asks for more;
or Vercel Cron misses runs that the fallback then has to carry.
