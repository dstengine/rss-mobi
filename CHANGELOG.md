# Changelog

## Unreleased — v0.1 (slice 1: catalogue and submission)

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
