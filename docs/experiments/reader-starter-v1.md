# reader-starter-v1 — newest feeds vs topic sets for a first-time reader

Issue [#14](https://github.com/dstengine/rss-mobi/issues/14).
**Status: withdrawn before it started; topic sets shipped as the default
on the maintainer's decision, 2026-09-29.**

**What was planned.** A visitor experiment: a reader who starts with
nothing followed would see either the eight newest feeds (control) or up
to six broad topics, four feeds each, with one "Follow these 4" button
(treatment). Primary metric: the share of those visits that follow
anything. Minimum sample: 140 visits per variant.

**Why it did not run.** A product review on 2026-09-29 found:

- The control was no longer a fair baseline. Six of the ten newest feeds
  were one site's language editions, and the eight newest a mix of a
  personal blog, a regional games blog and that site. The test would
  have spent two months showing that a curated list beats a flood.
- At about six reader visits a day, 280 visits take at least seven
  weeks, and the design could only detect a threefold lift.
- The counting had flaws: a visit was counted per page load; browsers
  that keep nothing fell into the control and could never follow;
  following a set or importing an OPML file sent one event per feed.

**What shipped instead.** Topic sets for every first-time reader
(`starterSets()` in `src/lib/views.ts`); the eight newest feeds — now one
per site — only while there are too few topics for three sets.

**How it is judged.** Before and after the change, by week, from
`metrics_daily`: follows on the reader page (`follow:reader`) per reader
view (`view:reader`), and from the change on, the share of browsers that
follow anything after their first empty visit (`reader_follow:first` ÷
`reader_start:empty`, each counted once per browser, storage-less
browsers left out). Before the change the reader had 31 views and no
follows from it (23–28 September).

**Next test, when there is traffic for one** (about 30 first visits a
day): pick-your-topics against a reader that starts already following a
default set, as NetNewsWire does.
