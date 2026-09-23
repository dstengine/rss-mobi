# 0005 — The experiment registry lives in code

**Date:** 2026-09-23 · **Status:** accepted · **Departs from the plan**

The plan put the registry in a MongoDB `experiments` collection. It lives in
`EXPERIMENTS` in `src/lib/experiments.ts` instead: an experiment changes
what a template or a script renders, so starting one is a deploy anyway,
and a registry that can drift from the code reading it is two sources of
truth. Hypotheses, sample sizes, dates and outcomes go in
`docs/experiments/<id>.md`, versioned with the code they describe.

Events still go to MongoDB (`events`, 180-day TTL), tagged with the variant
that was showing.

**Reopen if:** someone who does not deploy needs to start or stop
experiments.
