# reader-starter-v1 — newest feeds vs topic sets for a first-time reader

Issue [#14](https://github.com/dstengine/rss-mobi/issues/14). Visitor
experiment: the variant is chosen in the browser from its anonymous id, and
the server HTML is the same for everyone — both lists are in it, one hidden.

**Hypothesis.** A first-time reader offered a few broad topics to follow
four feeds at a time follows something more often than one offered the
eight newest feeds.

**Variants.**

- `newest` (control) — "Start with these RSS feeds": the eight newest
  feeds, each with its own Follow button. What the reader has shown since
  launch.
- `topics` — "Start with a topic": up to six broad topics with an indexable
  page (technology, news, science, programming, design and gaming on
  2026-09-28), four of each topic's best-ranked feeds, no feed in two sets,
  and one "Follow these 4" button per topic.

**Exposure.** `reader_start` with label `empty`: a `/reader/` visit that
begins with nothing followed. One per page load.

**Primary metric.** The share of exposures followed by at least one follow
in the same visit: `reader_follow:first` ÷ `reader_start:empty`, per
variant, from `metrics_daily` (`readout()` in `src/lib/metrics.ts`).
Two-proportion z-test of `topics` against `newest`, two-sided, α = 0.05.

**Secondary.** Feeds followed per exposure: `reader_follow` ÷
`reader_start:empty`. Reported, not decided on.

**Minimum sample.** 140 exposures per variant, fixed before the start.
That is what it takes to tell 5% from 15% with power 0.8 at α = 0.05.
Nobody reads the result before both arms have it. On 2026-09-28 the reader
had about six views a day and no follows from it at all, so this takes
roughly seven to eight weeks.

**Start.** The day it ships with `active: true` — the merge date of its
pull request, written here then.

**End.** When both arms reach 140: seven to eight weeks after the start at
today's traffic.

**Result.** —
