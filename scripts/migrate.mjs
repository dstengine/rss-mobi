#!/usr/bin/env node
// Creates every index the app relies on. Idempotent: createIndex on an
// index that already exists with the same definition is a no-op, so this
// runs safely on every deploy and twice in a row prints the same thing.
//
//   node scripts/migrate.mjs            (reads .env.local, then .env)
//   node scripts/migrate.mjs rssmobi_test
import { existsSync } from "node:fs";
import { MongoClient } from "mongodb";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
const uri = process.env.MONGODB_CONNECTION_STRING;
if (!uri) {
  console.error("MONGODB_CONNECTION_STRING is not set");
  process.exit(1);
}
const dbName = process.argv[2] ?? process.env.MONGODB_DB ?? "rssmobi";
const DAY = 86_400;

const INDEXES = {
  feeds: [
    [{ slug: 1 }, { unique: true }],
    [{ canonicalUrl: 1 }, { unique: true }],
    [{ status: 1, nextFetchAt: 1 }],
    [{ status: 1, updatedAt: -1 }],
    [{ tags: 1 }],
    // A topic's list, best first.
    [{ tags: 1, rank: -1 }],
    [{ host: 1 }],
    [{ title: "text", description: "text", host: "text", tags: "text" }, { default_language: "none", weights: { title: 4, tags: 2, host: 2, description: 1 }, name: "text" }],
  ],
  items: [
    [{ feedId: 1, guid: 1 }, { unique: true }],
    [{ visible: 1, publishedAt: -1 }],
    [{ feedSlug: 1, publishedAt: -1 }],
    [{ tags: 1, publishedAt: -1 }],
    [{ indexStatus: 1, indexNextCheckAt: 1 }],
    // The index-check queue: due items, the longest-waiting first.
    [{ visible: 1, indexNextCheckAt: 1 }],
    [{ serpTaskId: 1 }, { sparse: true }],
    // Pages whose robots changed and IndexNow has not heard yet.
    [{ announce: 1 }, { sparse: true }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
    // Posts whose picture nobody has looked for yet, newest first.
    [{ pictureAt: 1, publishedAt: -1 }],
    // default_language "none": items arrive in every language, and English
    // stemming applied to Spanish titles finds worse matches than none.
    [{ title: "text", excerpt: "text" }, { default_language: "none", weights: { title: 3, excerpt: 1 }, name: "text" }],
  ],
  collections: [[{ id: 1 }, { unique: true }]],
  api_keys: [[{ hash: 1 }, { unique: true }], [{ prefix: 1 }]],
  index_checks: [[{ itemId: 1, at: -1 }], [{ at: 1 }, { expireAfterSeconds: 180 * DAY }]],
  events: [[{ at: 1 }, { expireAfterSeconds: 180 * DAY }], [{ name: 1, at: -1 }]],
  metrics_daily: [[{ day: 1, metric: 1, variant: 1 }, { unique: true }]],
  reports: [[{ createdAt: -1 }]],
};

const client = await new MongoClient(uri, { appName: "rss.mobi migrate" }).connect();
try {
  const db = client.db(dbName);
  for (const [name, specs] of Object.entries(INDEXES)) {
    const col = db.collection(name);
    for (const [keys, options = {}] of specs) {
      const created = await col.createIndex(keys, options);
      console.log(`${name}: ${created}`);
    }
  }
} finally {
  await client.close();
}
