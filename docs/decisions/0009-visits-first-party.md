# 0009 — Visits are counted first-party, with no analytics tag

**Date:** 2026-10-25 · **Status:** accepted

The question a product plan asks of rss.mobi is how many visits a month
it gets, and from where. The events already counted page views (`view`)
with no identifier; a view is not a visit, and a reader who opens five
posts made five. One more event answers it: `visit`, sent by the first
page a tab opens, labelled `search`, `ai`, `direct` or `other` from the
referrer's host (`src/lib/visits.ts`). A sessionStorage flag keeps a
reload and the pages after it from counting again, and a referrer on
rss.mobi itself is a visit going on, not a new one. The nightly roll-up
gives `visit` and `visit:<source>` a row a day like every other metric.

Google Analytics, or any tag that sets a cookie, was the alternative. The
terms promise "no cookies and no advertising trackers"; a GA4 tag would
make that sentence false and need a consent banner in the EU, for a
number the site can count itself. The cost of counting it ourselves:
no unique visitors over a month (a tab is the unit, and no id survives
it), no demographics, no cross-site view of the network in one property.

Visits before this change are not recoverable; `view` is their upper
bound, about 51 a day from 23 Sep to 14 Oct 2026. The events themselves
have a hole: while the Upstash quota was spent, the limiter's error
refused them, until #42 gave it a fallback (ADR 0008 has since taken
Upstash out) — none after 14 Oct 15:14 UTC but one on 20 Oct, and the
next at 24 Oct 19:12 UTC, a minute after #42 deployed.

**Reopen if:** a decision needs a figure these events cannot give —
unique visitors, or the network's sites side by side in one tool. Then a
cookieless provider first, and the terms change before the tag ships.
