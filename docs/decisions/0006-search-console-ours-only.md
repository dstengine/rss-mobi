# 0006 — Search Console: ours only

**Date:** 2026-09-24 · **Status:** accepted · **Departs from the plan**

The plan let publishers connect their own Search Console from the feed's
edit page (Google OAuth), so URL Inspection could check their posts for
free and the connection could prove ownership. That is dropped before any
of it shipped.

An unverified Google app shows every publisher a "Google hasn't verified
this app" warning, stops at 100 users, and the Search Console scopes are
sensitive, so lifting both means Google's verification: a privacy policy
under the Limited Use rules, a demo video, branding review and days to
weeks of back and forth. A directory whose promise is "submit in one step"
cannot open with a warning screen, and the refresh tokens would be the
only personal data we hold.

Instead:

- **Whether someone else's post is in Google** is a question for
  DataForSEO, under the `serp` budget. It costs money, so it is capped
  daily and every check is logged.
- **Our own property, `https://rss.mobi/`,** is read by the service account
  `rss-mobi-workers@rss-mobi-509607.iam.gserviceaccount.com`, a Full user of
  the property. No consent screen, no user tokens; the key is
  `GSC_SERVICE_ACCOUNT` and the client is `src/lib/gsc.ts`. Scheduled jobs
  and the weekly retro read clicks, sitemaps and URL Inspection (2,000 a
  day) through it.

What verification would take is kept in the owner's todo, not here.

**Reopen if:** publishers ask to connect Search Console and Google's
verification has passed.
