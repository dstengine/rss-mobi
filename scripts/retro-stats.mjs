#!/usr/bin/env node
// The numbers the weekly retro starts from: this week against the one
// before, straight from the database. Read-only; prints aggregates as JSON
// and nothing that identifies anyone.
//
//   node --env-file=.env scripts/retro-stats.mjs [db] [--end=2026-09-28]
//
// A week is the seven days before --end (default: today, 00:00 UTC).
import { existsSync } from "node:fs";
import { MongoClient } from "mongodb";

if (!process.env.MONGODB_CONNECTION_STRING) for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
const uri = process.env.MONGODB_CONNECTION_STRING;
if (!uri) {
  console.error("MONGODB_CONNECTION_STRING is not set");
  process.exit(1);
}
const args = process.argv.slice(2);
const dbName = args.find((a) => !a.startsWith("--")) ?? process.env.MONGODB_DB ?? "rssmobi";
const endArg = args.find((a) => a.startsWith("--end="))?.slice(6);
const DAY = 86_400_000;
const end = endArg ? new Date(`${endArg}T00:00:00Z`) : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const weeks = { this: [new Date(end - 7 * DAY), end], last: [new Date(end - 14 * DAY), new Date(end - 7 * DAY)] };

const client = await new MongoClient(uri, { appName: "rss.mobi retro" }).connect();
try {
  const db = client.db(dbName);
  const between = (field, [from, to]) => ({ [field]: { $gte: from, $lt: to } });
  const count = (name, q) => db.collection(name).countDocuments(q);
  const byName = async (range) =>
    Object.fromEntries(
      (await db.collection("events").aggregate([{ $match: between("at", range) }, { $group: { _id: "$name", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray()).map((r) => [r._id, r.n]),
    );
  const week = async (range) => ({
    from: range[0].toISOString().slice(0, 10),
    to: range[1].toISOString().slice(0, 10),
    feedsAdded: await count("feeds", between("createdAt", range)),
    itemsAdded: await count("items", between("createdAt", range)),
    collectionsCreated: await count("collections", between("createdAt", range)),
    reports: await count("reports", between("createdAt", range)),
    indexChecks: await count("index_checks", between("at", range)),
    events: await byName(range),
  });

  const openItems = { visible: true, $or: [{ robots: "index,follow" }, { robots: null, indexStatus: "not_indexed" }] };
  const status = Object.fromEntries((await db.collection("feeds").aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray()).map((r) => [r._id, r.n]));
  const indexStatus = Object.fromEntries((await db.collection("items").aggregate([{ $group: { _id: "$indexStatus", n: { $sum: 1 } } }]).toArray()).map((r) => [r._id, r.n]));
  const failing = await db
    .collection("feeds")
    .find({ status: "active", failCount: { $gt: 0 } }, { projection: { _id: 0, slug: 1, failCount: 1, lastError: 1 } })
    .sort({ failCount: -1 })
    .limit(10)
    .toArray();
  const stale = await count("feeds", { status: "active", lastFetchAt: { $lt: new Date(end - DAY) } });
  const spend = await db.collection("spend").find({}, { projection: { _id: 1, usd: 1 } }).sort({ _id: -1 }).limit(14).toArray();

  // Search Console, through the rss-mobi-workers service account. Its data
  // runs two to three days behind, so the newest days of this week are thin.
  const search = async () => {
    if (!process.env.GSC_SERVICE_ACCOUNT) return "GSC_SERVICE_ACCOUNT is not set";
    const gsc = await import("../src/lib/gsc.ts");
    const dates = ([from, to]) => ({ startDate: from.toISOString().slice(0, 10), endDate: new Date(to - DAY).toISOString().slice(0, 10) });
    const totals = async (range) => (await gsc.searchAnalytics(dates(range)))[0] ?? { clicks: 0, impressions: 0 };
    try {
      return {
        thisWeek: await totals(weeks.this),
        lastWeek: await totals(weeks.last),
        topPages: await gsc.searchAnalytics({ ...dates(weeks.this), dimensions: ["page"], rowLimit: 5 }),
        topQueries: await gsc.searchAnalytics({ ...dates(weeks.this), dimensions: ["query"], rowLimit: 5 }),
      };
    } catch (e) {
      return { error: e.message };
    }
  };

  console.log(
    JSON.stringify(
      {
        end: end.toISOString().slice(0, 10),
        totals: {
          feeds: status,
          items: await count("items", {}),
          itemsVisible: await count("items", { visible: true }),
          indexStatus,
          // Post pages open to search (the sitemap's OPEN_ITEMS), and what
          // URL Inspection last said about them: PASS is in Google.
          openPages: {
            open: await count("items", openItems),
            inspected: await count("items", { $and: [openItems, { pageCheckedAt: { $exists: true } }] }),
            inGoogle: await count("items", { $and: [openItems, { pageVerdict: "PASS" }] }),
          },
          collections: await count("collections", {}),
        },
        health: { activeFeedsNotFetchedForADay: stale, failing: failing.map((f) => ({ slug: f.slug, failCount: f.failCount, lastError: String(f.lastError ?? "").slice(0, 120) })) },
        spend,
        search: await search(),
        thisWeek: await week(weeks.this),
        lastWeek: await week(weeks.last),
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
