# Learnings

Observation → evidence → where it was applied. Newest first.

## 2026-10-25 — leaving Upstash

- **A free second store is still a second quota to watch.** Evidence:
  once the poll lock left Redis, the store held some 2 500 commands a
  day, a seventh of its free plan, and it had still taken the API, the
  poller and every cron down for ten days on 14 Oct with nothing watching
  it. Applied: the owner dropped Upstash. The limiter, the run locks and
  the quota counters live in MongoDB, which every request reaches anyway,
  and the jobs run on Vercel Cron (ADR 0008).
- **A scheduler that may deliver twice needs jobs that may run twice.**
  Evidence: Vercel documents cron delivery as best effort, a run missed or
  delivered more than once, and a failed one never retried; the daily
  story job queued five more jobs on every call. Applied: `stories` runs
  once a UTC day, behind a `stories:<day>` lock that is never released;
  `fetch` already claimed each feed, `index-check` and `metrics` already
  locked.

## 2026-10-25 — where the Redis commands went

- **One small lock, taken for every item, is the whole bill.** Evidence:
  Upstash counted 504 000 commands between 23 Sep and 14 Oct 2026, when
  the free plan's 500 000 a month ran out and took the poller and every
  cron down; 98% of them were writes. The feeds' `okCount` summed to
  326 000 polls over those 21 days, 12 200 a day, and each poll took a
  per-feed lock — `SET NX` and `DEL`, two writes — 24 400 commands a day,
  nineteen commands in twenty. Nothing else came to more than a few
  hundred a day. Applied: the poller claims a feed in MongoDB with one
  `findOneAndUpdate` (`pollingUntil`, `claim()` in `src/lib/catalog.ts`),
  released by the poll's own update; a run that dies mid-poll leaves the
  claim to lapse after two minutes.
- **Count what an operation costs in commands, not what its keys look
  like.** Evidence: the lock key was tiny and lived seconds, and was still
  the bill. Applied: `tests/fixtures/fake-redis.ts` stands in for Upstash
  and records every command it is sent; `tests/redis-commands.test.ts`
  states the cost of each operation in `src/lib/cache.ts`, and
  `tests/db.test.ts` that a poll costs none. Both stand-ins went with
  Upstash on 25 Oct 2026; `tests/cache.test.ts` now counts the store
  calls each operation makes.

Commands a day, before and after, as per-run counts times runs a day. A
fetch run polled some 64 feeds; the schedulers run 192 times a day
(QStash every 15 minutes, and the GitHub Actions fallback at 7, 22, 37
and 52 past the hour while `CRON_ENABLED` is true). The limiter is one
`EVALSHA` a request, and the API and the beacon see about a hundred a
day; a refused address is then held in process until its window turns.

| Writer | Per run, before | A day, before | Per run, after | A day, after |
|---|---|---|---|---|
| Per-feed lock: `SET NX` + `DEL` a poll | ≈128 | ≈24 400 | 0 | 0 |
| Fetch run lock `pictures`: `SET NX` + `DEL` | 2 | 384 | 2 | 384 |
| Index-check run: probe `SET`, lock, counters | ≈6 | ≈1 150 | ≈6 | ≈1 150 |
| Page checks and Search Console counters | — | ≤400 | — | ≤400 |
| Tag statistics cache: a `GET` a view, a `SET` a miss | — | ≈100–200 | — | ≈100–200 |
| Limiter: one `EVALSHA` a request | 1 | ≈100–150 | 1 | ≈100–150 |
| Metrics lock, daily | — | 2 | — | 2 |
| **A fetch run / a day** | **≈130** | **≈26 000** | **2** | **≈2 100–2 500** |

A month: ≈780 000 modelled, against the 504 000 Upstash counted over the
21 days the plan lasted (24 000 a day — polls fell back to memory
whenever Redis answered an error, and the model counts every one), and
≈65 000–75 000 after: a seventh of the plan, and three times under the
250 000 a month the diet aimed at. Not done, and why: holding the
anonymous limiter's verdict in process would save one command a request,
under 150 a day at today's traffic. It pays once the API sees some 5 000
requests a day, when the limiter and the rest together reach the
8 000-a-day mark that 250 000 a month allows.

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
- A spent quota is not a dead store: on 24 Oct GET and PING still
  answered while SET, INCRBY and DEL were refused, so a liveness probe
  must do what the job does; `redisUp()` writes a probe key.
