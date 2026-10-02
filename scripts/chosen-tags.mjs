#!/usr/bin/env node
// Tells a feed's chosen topics from those read off its posts, for feeds
// saved before the two were kept apart (FeedDoc.chosenTags, #23), and with
// --posts re-reads each feed and re-files the posts it still lists under
// the rule new posts follow (catalog.ts postTags). Prints what it would
// change; changes nothing without --write.
//
//   node --env-file=.env scripts/chosen-tags.mjs [db]                  dry run
//   node --env-file=.env scripts/chosen-tags.mjs rssmobi --write       feeds
//   node --env-file=.env scripts/chosen-tags.mjs rssmobi --write --posts
//
// Seeded feeds get the topics scripts/seed-feeds.json filed them under:
// by their own address, else by their site's. A feed a visitor submitted
// has its submitter's topics first in its tags, but not how many: it keeps
// up to two.
//
// Only posts the feed still lists are re-filed, because only for them can
// a post's own categories be told from what it inherited; older ones keep
// their topics until they expire, and topic lists already show at most one
// post in ten from any feed (views.ts diverse).
import { existsSync, readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { canonical } from "../src/lib/feeds/url.ts";
import { get } from "../src/lib/feeds/get.ts";
import { itemKey, parseFeed } from "../src/lib/feeds/parse.ts";
import { postTags } from "../src/lib/catalog.ts";

if (!process.env.MONGODB_CONNECTION_STRING) for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
const uri = process.env.MONGODB_CONNECTION_STRING;
if (!uri) {
  console.error("MONGODB_CONNECTION_STRING is not set");
  process.exit(1);
}
const args = process.argv.slice(2);
const write = args.includes("--write");
const posts = args.includes("--posts");
const dbName = args.find((a) => !a.startsWith("--")) ?? process.env.MONGODB_DB ?? "rssmobi";

const seed = JSON.parse(readFileSync(new URL("./seed-feeds.json", import.meta.url), "utf8"));
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const byUrl = new Map();
const byHost = new Map();
const add = (map, k, t) => (map.get(k) ?? map.set(k, new Set()).get(k)).add(t);
for (const [t, urls] of Object.entries(seed))
  for (const u of urls) {
    add(byUrl, canonical(u), t);
    add(byHost, host(u), t);
  }

const sameSet = (a, b) => a.length === b.length && a.every((t) => b.includes(t));

const client = await new MongoClient(uri, { appName: "rss.mobi chosen-tags" }).connect();
try {
  const db = client.db(dbName);
  const now = new Date();
  const list = await db
    .collection("feeds")
    .find({ status: { $ne: "hidden" } }, { projection: { slug: 1, url: 1, canonicalUrl: 1, host: 1, title: 1, tags: 1, chosenTags: 1, checkIndex: 1 } })
    .toArray();
  let feedsSet = 0;
  for (const f of list) {
    if (f.chosenTags) continue;
    if (f.checkIndex === false) {
      const topics = byUrl.get(f.canonicalUrl) ?? byUrl.get(canonical(f.url)) ?? byHost.get(f.host) ?? byHost.get(host(f.url)) ?? new Set();
      f.chosenTags = f.tags.filter((t) => topics.has(t));
      if (!f.chosenTags.length) f.chosenTags = f.tags.slice(0, 1);
    } else f.chosenTags = f.tags.slice(0, 2);
    feedsSet++;
    if (write) await db.collection("feeds").updateOne({ _id: f._id }, { $set: { chosenTags: f.chosenTags } });
  }
  console.log(`${write ? "" : "(dry run) "}feeds given chosen topics: ${feedsSet}`);
  let read = 0;
  let failed = 0;
  let changed = 0;
  const queue = [...list];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        await refile(f);
      } catch (e) {
        failed++;
        console.error(`${f.slug}: skipped (${e.message.split("\n")[0].slice(0, 100)})`);
      }
    }
  };
  const refile = async (f) => {
    const res = await get(f.url);
    const parsed = parseFeed(res.body, res.url);
    read++;
    const ops = [];
    const stored = new Map(
      (await db.collection("items").find({ feedId: f._id, guid: { $in: parsed.items.map((it) => itemKey(it).slice(0, 500)) } }, { projection: { guid: 1, tags: 1 } }).toArray()).map((p) => [p.guid, p]),
    );
    for (const it of parsed.items) {
      const p = stored.get(itemKey(it).slice(0, 500));
      if (!p) continue;
      const tags = postTags(it.tags, f);
      if (sameSet(tags, p.tags)) continue;
      ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { tags, updatedAt: now } } } });
    }
    if (!ops.length) return;
    changed += ops.length;
    console.log(`${f.slug}: ${ops.length} post(s) re-filed (chosen: ${f.chosenTags.join(",") || "—"})`);
    if (write) await db.collection("items").bulkWrite(ops, { ordered: false });
  };
  if (posts) await Promise.all(Array.from({ length: 4 }, worker));
  if (posts) console.log(`${write ? "" : "(dry run) "}feeds read: ${read}, failed: ${failed}; posts re-filed: ${changed}`);
} finally {
  await client.close();
}
