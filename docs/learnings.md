# Learnings

Observation → evidence → where it was applied. Newest first.

## 2026-10-04 — story worker

- **A submit that cannot be undone needs a way back.** Evidence: a story
  went into review citing a source that had answered 403; the worker could
  not resubmit (409), reclaim it (claim took only queued jobs), or edit it
  through the admin API, which sets a status and nothing else. Applied: a
  story in review can be claimed by id and revised, and the worker's
  routine now checks every cited source before it submits.

## 2026-09-23 — slice 1

- **MongoDB 8 does not start on Docker Desktop's Linux 6.19 kernel.**
  Evidence: `mongo:8` exits at once with SERVER-121912. Applied: local
  development uses `mongo:7`; Atlas is unaffected.
- **Astro refuses cross-site POSTs without a JSON content type.** Evidence:
  a bare `curl -X POST` to the cron endpoint got 403 "Cross-site POST form
  submissions are forbidden" before reaching our 401. Applied: the cron
  workflow and every client send `Content-Type: application/json`.
- **`process.loadEnvFile` never overwrites a variable already set.**
  Applied: `.env.local` is loaded before `.env`, so development can point
  at a local database while `.env` holds production values.
- **A side effect must be recorded only once it happened.** The first
  IndexNow version set `announcedAt` before pinging, so a missing key would
  have marked every feed announced forever. Applied: `announcedAt` is set
  only on a 200/202.
- **Feed titles carry taglines.** "Articles on Smashing Magazine — For Web
  Designers And Developers" made a 60-character slug cut mid-word. Applied:
  `slugify` keeps the part before a separator and cuts between words.
- **Excerpts often repeat the title.** Many feeds open their content with
  the post's heading. Applied: `withoutTitle()` in the parser.

## 2026-10-24 — the limiter took the API down

- **A dependency's quota is an outage.** Upstash's free plan allows 500 000
  commands a month; they ran out on the 24th and every `/api/v1/*` read
  answered 500 for the rest of the day, while the front page served: the
  cache caught its Redis errors, the rate limiter did not. Applied:
  `rateLimit()` falls back to the in-process stand-in and logs once a
  minute (tests/cache.test.ts). Still true for `lock()` and `count()`:
  they throw, and the jobs that use them stop, which is the right side to
  fail on for a lock.

## 2026-10-24 — the lock took the poller down

The limiter's fix above (PR #42) answered the symptom that was seen, the
API's 500s, and missed the one that was not: `lock()` threw on the same
Redis error, so `/api/v1/cron/fetch` and every other cron had answered
500 since 14 Oct 2026, not 24 Oct. Nobody noticed for ten days because
the pages kept serving from their fallback cache and nothing watched the
crons' status codes.

- Date an outage from the data, not from when it was noticed: items per
  day by ObjectId time (`_id` carries its creation second) and the feeds'
  greatest `lastFetchAt` gave 14 Oct 17:45 UTC in one query each.
- QStash is the cron and GitHub Actions only the fallback, so QStash's
  event log is the cron log: `GET https://qstash.upstash.io/v2/events`
  with `QSTASH_TOKEN` lists each delivery with its status code, and
  `/v2/dlq` keeps the failures.
- When one call site is fixed for a dependency's failure, grep for every
  other call into the same module before closing the incident: `lock`,
  `count` and `counter` went to the same store as `rateLimit`.
- A counter that falls back to per-instance memory is fine for a pause
  flag and wrong for a budget in dollars; the index check now asks
  `redisUp()` and stops rather than spends blind.
