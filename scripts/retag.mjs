#!/usr/bin/env node
// Re-applies the topic rules in src/lib/feeds/parse.ts — STOP_TAGS and a
// site's own name — to what is already stored. New feeds and posts get them
// on the way in; this is for the ones saved before a rule existed. Prints
// what it would change and changes nothing without --write. Idempotent.
//
//   node scripts/retag.mjs [db]                           (reads .env.local, then .env)
//   node --env-file=.env scripts/retag.mjs rssmobi --write
import { existsSync } from "node:fs";
import { MongoClient } from "mongodb";
import { STOP_TAGS, ownName } from "../src/lib/feeds/parse.ts";

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

  for (const feed of await db.collection("feeds").find({}, { projection: { slug: 1, title: 1, host: 1, tags: 1 } }).toArray()) {
    const dropped = (t) => STOP_TAGS.has(t) || ownName(t, feed);
    const gone = (feed.tags ?? []).filter(dropped);
    if (gone.length) {
      feedsChanged++;
      console.log(`${feed.slug}: -${gone.join(" -")}`);
      if (write) await db.collection("feeds").updateOne({ _id: feed._id }, { $set: { tags: feed.tags.filter((t) => !dropped(t)), updatedAt: now } });
    }

    // A post's page shows its topics, so a post that loses one is dated now.
    const ops = [];
    for (const item of await db.collection("items").find({ feedId: feed._id }, { projection: { tags: 1 } }).toArray()) {
      const keep = (item.tags ?? []).filter((t) => !dropped(t));
      if (keep.length !== (item.tags ?? []).length) ops.push({ updateOne: { filter: { _id: item._id }, update: { $set: { tags: keep, updatedAt: now } } } });
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
