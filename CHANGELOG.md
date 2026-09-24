# Changelog

## Unreleased

- Busy feeds are polled every 15 minutes (three posts a day or more) or
  30 (one a day); the rest hourly. A run polls eight feeds at a time and
  takes those due in the next two minutes too: before, a feed due just
  after a run began waited for the next, so "hourly" was really every
  75 minutes. Pages, copies and the reader's API poll the feeds they
  show once they have answered, through Vercel's `waitUntil`.
- Topic pages are ranked lists, "Best <Topic> RSS Feeds in <year>": each
  feed with its place, icon, posting pace, last post and followers, and
  Follow, Copy RSS and Website beside it. The rank (`src/lib/activity.ts`)
  weighs followers reported by readers, posts a week (capped at two a
  day) and time since the last post; every poll recomputes it with the
  pace and last post. `/about/` says how lists are ranked.
- Every feed has an icon at `/feed/<slug>/icon`: the site's
  apple-touch-icon, the feed's image, its largest linked icon or
  favicon.ico, fetched once a month and kept a week by the CDN, or its
  initial on a coloured tile (`src/lib/icon.ts`). Cards, feed pages and
  the reader's list, filters and post view show it.
- A feed's page shows a row of figures: posts a week, last post, its
  place in its first topic, and followers in other readers.
- The public API's feeds carry `postsPerWeek`, `lastPostAt`, `followers`
  and `icon`.

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
  word. In the reader's starter feeds the Follow button moves inside the card on
  phones, so a host like smashingmagazine.com no longer splits. A count
  and its word ("40 posts") and a date stay on one line everywhere, kept
  together by a `nowrap` span rather than `&nbsp;`, so copied text stays
  plain.
- Phones get a menu. The header always shows the name "rss.mobi" and a
  burger that opens a panel with search, the three sections, Combine
  feeds and About; the page dims behind it, and a tap outside or Escape
  closes it. On phones the header stays at the top while the page
  scrolls. Menu items and the main buttons carry line icons (search,
  submit, combine, follow, copy, export, open the original), and Follow
  and Copy swap their icon for a check when done. Topic chips and small
  buttons are 44 px tap targets, fields for tags and addresses no longer
  capitalise or autocorrect, and the collapsible "Narrow it down" and
  "Report a problem" show a chevron. Under 400 px the search button keeps
  only its magnifier, so "Search by site or topic…" fits whole down to
  300 px; a row of buttons that wraps fills each line instead of stacking
  at ragged widths; paragraphs no longer end on a lone short word
  ("sign-|up."), and headings wrap into even lines.
- Every feed has its own RSS feed on rss.mobi, `/feed/<slug>/rss.xml`:
  its newest 50 posts, each with its excerpt and a link to the original.
  The feed's page shows that address as a link with a Copy button in the
  same box, in place of the old read-only field; a collection's page and
  a new collection show theirs the same way. The address wraps after its
  slashes rather than mid-word, and on a phone the Copy button keeps only
  its mark. The pager under a collection's posts is a 44 px tap target.
- On a phone the site is laid out as an app. A tab bar along the bottom
  holds Home, Topics, Reader, Combine and Search, the current one in the
  accent colour, clear of the home indicator; it steps aside while the
  keyboard is up. The header is a translucent app bar, and its menu keeps
  what the tabs leave out: search, Submit a feed, About and Terms. Pages
  cross-fade while the header and tab bar stay put (where the browser
  supports cross-page view transitions, and not under reduced motion),
  links are fetched ahead as a finger lands on them, buttons and cards
  answer a tap with a pressed state instead of the browser's grey flash,
  and double-tap zoom no longer delays a tap. Installed to the home
  screen, the app offers shortcuts to Reader, Search, Topics and Combine.
  The empty search screen offers popular topics and the newest feeds. A
  feed's address wraps only after a slash, never at a hyphen.
- A collection takes any site or feed address pasted into its search box,
  on the new-collection page and when editing one. A feed the directory
  has is added at once; one it lacks is found, submitted and added in the
  same step, so a collection is no longer limited to the directory. The
  box clears as soon as an address is taken, so several can be pasted one
  after another; they are worked through in order, and one with no feed
  comes back into the box and stays named in the message. Only a feed new
  to the directory counts against the five submissions an hour.
- A feed's copy at `/feed/<slug>/rss.xml` now carries what its original
  carries: each post whole in `<content:encoded>`, its pictures, and a
  podcast's episode as an `<enclosure>`, with a thumbnail per post and the
  feed's image. The original is read when the CDN asks (every five
  minutes at most), so new posts appear within minutes instead of at the
  next hourly poll, and nothing of it is stored: `src/lib/copy.ts`. The
  HTML goes through an allowlist first (`src/lib/feeds/clean.ts`): no
  scripts, styles or handlers, embeds from YouTube and Vimeo only,
  addresses made absolute, lazy-loaded pictures resolved, counting pixels
  dropped. Posts the original has dropped still fill the copy up to 50, as
  excerpts, and when the original does not answer in six seconds the
  stored excerpts go out alone. Posts are matched by their stored key, so
  a linked-list blog's two posts at one address (Daring Fireball) are both
  kept. Measured against eight originals, the copy now has the same posts,
  text and pictures.
- The reader opens a post in place, the way a reader app does: the whole
  post as its feed carries it, pictures and a podcast's player included,
  over the list — the full screen on a phone with a bar to go back (the
  phone's back gesture works too), a sheet on wider screens. A picture's
  hover text is printed under it, since a finger never hovers (xkcd).
  **Open** and **Read on …** go to the publisher. The post comes from
  `/api/v1/items/<id>/content`, which reads the original, keeps it five
  minutes per function instance and never stores it; a post with nothing
  whole to show keeps its excerpt and the link.
- The owner can keep the copy to excerpts from the edit link (`copy` on
  the feed, `excerpts` in the edit request).
- Feedly, Inoreader, Feedbin and other readers that count their followers
  in the user agent have that count recorded when they fetch a copy, and
  our crawler passes the week's total on to the original the same way
  (`rss.mobi/1.0 (+https://rss.mobi/about/; 16 subscribers)`), so a
  publisher's follower count stays whole. The about, terms and submit
  pages and the footer say so.
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
