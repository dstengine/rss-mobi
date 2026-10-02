#!/usr/bin/env node
// Re-applies the topic rules in src/lib/feeds/parse.ts and url.ts —
// STOP_TAGS, a site's own name, and one name per topic (TOPIC_ALIASES) —
// to what is already stored. New feeds and posts get them
// on the way in; this is for the ones saved before a rule existed. Prints
// what it would change and changes nothing without --write. Idempotent.
//
//   node scripts/retag.mjs [db]                           (reads .env.local, then .env)
//   node --env-file=.env scripts/retag.mjs rssmobi --write
import { existsSync } from "node:fs";
import { MongoClient } from "mongodb";
import { STOP_TAGS, ownName } from "../src/lib/feeds/parse.ts";
import { TOPIC_ALIASES } from "../src/lib/feeds/url.ts";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
const uri = process.env.MONGODB_CONNECTION_STRING;
if (!uri) {
  console.error("MONGODB_CONNECTION_STRING is not set");
  process.exit(1);
}
const args = process.argv.slice(2);
const write = args.includes("--write");
const dbName = args.find((a) => !a.startsWith("--")) ?? process.env.MONGODB_DB ?? "rssmobi";

const client = new MongoClient(uri);
try {
  const db = client.db(dbName);
  const now = new Date();
  let feedsChanged = 0;
  let itemsChanged = 0;

  for (const feed of await db.collection("feeds").find({}, { projection: { slug: 1, title: 1, host: 1, tags: 1, chosenTags: 1 } }).toArray()) {
    const dropped = (t) => STOP_TAGS.has(t) || ownName(t, feed);
    const fix = (tags) => [...new Set((tags ?? []).map((t) => TOPIC_ALIASES[t] ?? t))].filter((t) => !dropped(t));
    const same = (a, b) => a.length === (b ?? []).length && a.every((t, i) => t === b[i]);
    const tags = fix(feed.tags);
    const chosen = feed.chosenTags && fix(feed.chosenTags);
    if (!same(tags, feed.tags) || (chosen && !same(chosen, feed.chosenTags))) {
      feedsChanged++;
      console.log(`${feed.slug}: ${(feed.tags ?? []).join(",")} → ${tags.join(",")}`);
      if (write) await db.collection("feeds").updateOne({ _id: feed._id }, { $set: { tags, ...(chosen && { chosenTags: chosen }), updatedAt: now } });
    }

    // A post's page shows its topics, so a post that loses one is dated now.
    const ops = [];
    for (const item of await db.collection("items").find({ feedId: feed._id }, { projection: { tags: 1 } }).toArray()) {
      const keep = fix(item.tags);
      if (!same(keep, item.tags)) ops.push({ updateOne: { filter: { _id: item._id }, update: { $set: { tags: keep, updatedAt: now } } } });
    }
    if (ops.length) {
      itemsChanged += ops.length;
      console.log(`${feed.slug}: ${ops.length} posts retagged`);
      if (write) await db.collection("items").bulkWrite(ops, { ordered: false });
    }
  }

  console.log(`${dbName}: ${feedsChanged} feeds, ${itemsChanged} posts ${write ? "changed" : "would change (dry run; --write to apply)"}`);
} finally {
  await client.close();
}
