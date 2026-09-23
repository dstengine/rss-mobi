# rss.mobi — notes for agents

A directory of RSS feeds, a mobile reader and a feed API, in one Astro SSR
app on Vercel. Run by [DST](https://dst.llc/). **English only** in code,
comments, commits and Markdown; never delete anything — data, pages, test
databases — without the maintainer's confirmation.

Version scope: v1.0 is the MVP (catalogue, reader, collections, API,
exports, the original-index check), v1.1 adds ranking and rewriting, v1.2
policy rules and the DST network. Licence: AGPL-3.0, see `LICENSE`.

## Commands

```
npm run dev          # http://localhost:4340 (reads .env.local, then .env)
npm test             # unit tests, no services needed
npm run test:live    # RSS_MOBI_BASE=… — same HTML for Googlebot and a phone
npm run migrate      # create indexes (idempotent); `-- rssmobi_test` for another db
npm run build
node --env-file=.env scripts/migrate.mjs rssmobi   # the same, against Atlas
```

`.env.local` wins over `.env`; a script aimed at production needs
`node --env-file=.env`, or it quietly runs against the local database.
Atlas: org, project and cluster `rss-mobi` (M0, us-east-1); the app user
`rssmobi-app` has `readWrite` on `rssmobi` only.

Local MongoDB: `docker start rss-mobi-mongo7` (port 27018). It is `mongo:7`
on purpose — MongoDB 8 refuses to start on Docker Desktop's Linux 6.19
kernel (SERVER-121912). `.env.local` points at it and wins over `.env`.

## Rules that are easy to break

- **Every indexing and link decision comes from `policy()`**
  (`src/lib/policy.ts`). Templates render its answer; they never decide.
  It takes no user agent and must never take one: showing crawlers
  something else than readers is cloaking. `tests/live/cloaking.test.ts`
  checks it against a running server.
- **An item page is indexable exactly when its original is not in Google's
  index.** Every other state keeps it `noindex`.
- **SEO keyword.** `site.keyword` ("RSS feeds") goes in the title and meta
  description of every indexable page, and in the `h1` of pages we name
  ourselves (front page, topics, submit, about, terms). A feed's or post's
  `h1` is its real name. Titles end with `site.titleSuffix`; no brand in
  that slot until someone searches for it. Every `<a>` has a `title` that
  says something its label does not.
- **Sitemap dates are per page.** A feed is dated by its `updatedAt`; a
  page that lists feeds by the newest of what it lists, against its copy
  date in `COPY_UPDATED` (`src/site.config.ts`). **Edit a page's text —
  move its date there.** Only pages `policy()` indexes are listed.
- **Budgets are constants** in `src/lib/budget.ts` (`LIMITS`), reserved
  before the paid call. Never read a budget from the environment.
- **Secrets** live in `.env` (gitignored), never in the repo, never
  printed; `scripts/sync-secrets.sh` copies them to Vercel and GitHub. The
  repository is public, and so are its Actions logs: a workflow prints
  status codes, never a response body. The Telegram bot only ever calls `sendMessage`: no webhook.
- **The Google Indexing API is not used** — it is for job postings and
  livestreams only.
- **Edit tokens travel in the URL fragment** and the `X-Edit-Token`
  header, and are stored as sha256 hashes. Never put one in a query string.
- **POST endpoints need a JSON content type.** Astro's origin check refuses
  form-typed and untyped cross-site POSTs; the cron workflow
  (`.github/workflows/cron.yml`) sends `Content-Type: application/json`.

## Process

- Weekly sprints; backlog in GitHub Issues, milestones `v1.0`–`v1.2`,
  labels `story`, `bug`, `experiment`, `tech-debt`, `learning`.
- Definition of done: tests green, `npm run seo` clean, deployed, events
  wired, docs and `CHANGELOG.md` updated.
- Decisions: `docs/decisions/NNNN-*.md`, each with the condition that would
  reopen it. Lessons: `docs/learnings.md` — observation, evidence, where
  applied. Lessons that hold for every DST site also go to the network's
  notes.
- Experiments are registered in code (`EXPERIMENTS` in
  `src/lib/experiments.ts`, see ADR 0005). One primary metric each, a
  minimum sample fixed before starting, a two-proportion z-test at the end,
  and the result in `docs/experiments/<id>.md`. The loser's code is removed.
  Visitor experiments change only client-side behaviour; page experiments
  split by URL so each page shows one variant to everyone.
