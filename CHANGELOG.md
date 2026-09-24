# Changelog

## Unreleased

- Nightly backups are on: the database is dumped, encrypted with age and
  stored in R2 at 02:00 UTC, and copied to the maintainer's iCloud Drive
  each morning. The first archive was restored and every collection's
  count matched.
- Rate limits and job locks live in Upstash Redis, so a limit holds
  across every function instance instead of per instance.
- `scripts/set-secret.mjs` moves a secret from the clipboard into `.env`
  without it appearing on screen.
- Search Console is read for rss.mobi only, through a service account
  (`src/lib/gsc.ts`, `scripts/gsc.mjs`); the weekly retro stats include
  clicks, impressions and top pages. Publishers no longer connect their own
  Search Console: checks of their posts go to DataForSEO (ADR 0006).
  The service account's key is in place, and `gsc.mjs submit` resubmits
  the sitemap index.
- Every post has a page at `/item/<id>/`: title, excerpt, source feed, a
  link to the original and related posts from the same feed and topics.
  It is open to search exactly while Google lacks the original, and a post
  taken down with its feed answers 410 (#3). Lists link a post's page from
  its date while the page is open.
- Open post pages are listed in `sitemap-items-<n>.xml`, dated by the
  moment they opened, and IndexNow hears when a page opens or closes (#4).
- Each index-check run asks Search Console about up to 200 open post pages
  a day, and the retro stats count how many of them Google has (#5).
- An owner's nofollow choice now reaches every link to the feed's posts —
  topic pages, collections, the reader and the API — not only the feed's
  own page: items carry the feed's `linkMode` (#13). `tests/db.test.ts`
  checks it against a real MongoDB, which CI now starts.
- The header no longer breaks words on narrow phones ("rss.m obi",
  "Sub mit" at 320 px): the wordmark and menu labels never wrap inside a
  word, and below 340 px the wordmark shows only its icon. In the
  reader's starter feeds the Follow button moves inside the card on
  phones, so a host like smashingmagazine.com no longer splits. A count
  and its word ("40 posts") and a date stay on one line everywhere, kept
  together by a `nowrap` span rather than `&nbsp;`, so copied text stays
  plain.
- The terms and about pages name an address for complaints and removal
  requests, rss-mobi@vvm.space, besides the report form (#12).
- Every new post's original is checked in Google, in the order posts
  arrived, through DataForSEO: `/api/v1/cron/index-check`, called by the
  cron workflow. Spending is capped at $0.12 a day for now, a refusal
  pauses checks until midnight UTC, and a low balance or a spent budget goes to Telegram
  once (#2).

## v0.2 — 23 Sep 2026 (slice 2: reader and collections)

- The reader at `/reader/`: follow feeds with no account, the list kept in
  the browser; newest posts from all of them in one list, one feed at a
  time, "load more" and "new since last visit"; OPML import (feeds the
  directory lacks are offered for submission) and export. Follow buttons
  on feed pages; installable to the home screen (web app manifest).
- Collections: `/c/new/` combines feeds and filters (topics, sites, words
  to require or leave out, language) into one list with a page, an RSS
  feed (`/c/<id>/rss.xml`) and an OPML file (`/c/<id>/opml.xml`); changed
  later through an edit link, like a feed.
- API v1: `GET /api/v1/items` with the shared filters and cursor paging,
  `POST /api/v1/lookup`, `POST /api/v1/collections`,
  `GET/PUT /api/v1/collections/<id>`, `GET /api/v1/collections/<id>/edit`.
  Items carry `link: {mode, rel}` from `policy()`.
- Navigation: Topics, Reader, Submit; "Combine feeds" on the front page
  and in the footer. `/submit/?url=` fills in the address.

## v0.1 — 23 Sep 2026 (slice 1: catalogue and submission)

- Feed submission with discovery from any site or feed address: RSS 2.0,
  RSS 1.0, Atom and JSON Feed; SSRF-safe fetching; spam and blocklist
  checks; no moderation queue.
- Pages: front page, topics, topic, feed, search, submit, edit link,
  about, terms; 404 and 410.
- Hourly polling with conditional GET, exponential back-off and retirement
  after ten failures; IndexNow on a feed page's first indexable moment.
- `policy()` for every robots and link decision; sitemap index with
  per-page dates; robots.txt; IndexNow key file.
- API v1: `GET/POST /api/v1/feeds`, `GET/PUT /api/v1/feeds/<slug>`,
  `GET /api/v1/feeds/<slug>/edit`, `POST /api/v1/discover`,
  `POST /api/v1/report`, `POST /api/v1/events`, `POST /api/v1/cron/fetch`.
- Anonymous events for experiments; two experiments drafted, both off.
- Live at https://rss.mobi on Vercel, `www` 308 to the apex; MongoDB Atlas
  (free M0, us-east-1) with an app user limited to the `rssmobi` database.
  Every push to `main` deploys; pull requests get previews.
- Scheduled jobs from GitHub Actions (`.github/workflows/cron.yml`) every
  15 minutes, with a monthly keepalive against GitHub's 60-day pause.
- Topics skip CMS bookkeeping ("uncategorized", "articles", "links",
  "featured"…) and a site's own name; `scripts/retag.mjs` cleans what was
  stored before.
- Source published under the AGPL-3.0, linked from every page's footer;
  security reports through GitHub's private vulnerability reporting.
