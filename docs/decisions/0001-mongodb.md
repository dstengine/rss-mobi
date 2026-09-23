# 0001 — MongoDB Atlas for the catalogue

**Date:** 2026-09-23 · **Status:** accepted

Feeds and items are documents with uneven shapes (four feed formats,
optional media and authors), written in bulk by the poller and read by
filters over tags, hosts and dates. Atlas gives this with a text index, TTL
expiry of old items and upserts keyed on `{feedId, guid}`, on a free tier.

One client per function instance (`src/lib/db.ts`); indexes are created by
`scripts/migrate.mjs`, never implicitly.

**Reopen if:** filter queries need joins across items and feeds on every
request, or the free tier's 512 MB is reached before v1.1 — then weigh a paid
tier against Postgres with a JSONB column.
