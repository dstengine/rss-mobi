#!/usr/bin/env node
// Seeds the catalogue with well-known feeds, by topic, from
// scripts/seed-feeds.json. Each goes in through submit(), the path a
// visitor's submission takes, so the same checks apply: it must answer,
// parse and pass the spam filter. A feed listed under several topics gets
// them all as tags, up to five. One already in the catalogue gains the
// topics it lacks. scripts/seed-names.json names the feeds whose own title
// is a page title ("Home - CBSNews.com") or a tagline, by the publisher's
// name, which also becomes the address of their page.
//
// Seeded feeds are big publishers, whose posts Google has within minutes;
// their posts skip the index-check queue (FeedDoc.checkIndex), which
// would otherwise spend its daily budget confirming that, while the posts
// of the webmasters it exists for waited behind them.
//
// Two steps. The dry run reads every source and writes a report: which
// answer, what feed each leads to, how often it posts. The second submits
// the report's usable rows, and only those — so what goes in is what was
// looked at.
//
//   node --env-file=.env.local scripts/seed.mts --dry --out report.json [--only a,b]
//   node --env-file=.env scripts/seed.mts --from report.json
//       submits to the database MONGODB_DB names (rssmobi by default)
import { readFileSync, writeFileSync } from "node:fs";
import { discover } from "../src/lib/feeds/discover.ts";
import { canonical } from "../src/lib/feeds/url.ts";
import { topic } from "../src/lib/feeds/parse.ts";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = flag("--out");
const from = flag("--from");
const only = flag("--only")?.split(",");
/** A feed whose newest post is older than this is not worth seeding. */
const STALE_DAYS = 180;
/** Posts a day past which a feed is left out: one wire service would fill
    every list it shares with others, and cost more to keep than the rest
    of its topic together. Anyone may still submit it. */
const MAX_PACE = 45;
const WORKERS = 6;
const DAY = 86_400_000;

const byTopic: Record<string, string[]> = JSON.parse(readFileSync(new URL("./seed-feeds.json", import.meta.url), "utf8"));
const names: Record<string, string> = JSON.parse(readFileSync(new URL("./seed-names.json", import.meta.url), "utf8"));
const sources = new Map<string, string[]>();
for (const [t, urls] of Object.entries(byTopic)) {
  if (only && !only.includes(t)) continue;
  for (const url of urls) {
    const tags = sources.get(url) ?? [];
    if (!tags.includes(topic(t))) tags.push(topic(t));
    sources.set(url, tags);
  }
}

interface Row {
  input: string;
  tags: string[];
  ok: boolean;
  feedUrl?: string;
  title?: string;
  /** What it is called here, when its own title will not do. */
  name?: string;
  items?: number;
  newest?: string;
  /** Posts a day, from the dates the feed carries. */
  pace?: number;
  lang?: string;
  images?: number;
  result?: string;
}

/** Posts a day, over the span the feed's dated items cover (a day at
    least): a feed carrying fifty posts from one morning is a firehose. */
function pace(dates: number[], now = Date.now()): number {
  const recent = dates.filter((d) => d > now - 28 * DAY && d <= now + DAY);
  if (!recent.length) return 0;
  const span = Math.max(DAY, now - Math.min(...recent));
  return Math.round((recent.length / (span / DAY)) * 10) / 10;
}

async function look(input: string, tags: string[]): Promise<Row> {
  try {
    const { feed, feedUrl } = await discover(input);
    const dates = feed.items.map((i) => i.publishedAt?.getTime() ?? 0).filter(Boolean);
    const newest = dates.length ? Math.max(...dates) : 0;
    return {
      input,
      tags,
      ok: true,
      feedUrl,
      title: feed.title,
      ...(names[input] ? { name: names[input] } : {}),
      items: feed.items.length,
      newest: newest ? new Date(newest).toISOString().slice(0, 10) : undefined,
      pace: pace(dates),
      lang: feed.lang,
      images: feed.items.filter((i) => i.image).length,
    };
  } catch (e) {
    return { input, tags, ok: false, result: (e as Error).message.slice(0, 120) };
  }
}

async function pool<T>(list: T[], work: (t: T) => Promise<void>): Promise<void> {
  const queue = [...list];
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await work(t);
  }));
}

const rows: Row[] = [];
if (dry) {
  let n = 0;
  await pool([...sources], async ([input, tags]) => {
    const row = await look(input, tags);
    rows.push(row);
    console.error(`${++n}/${sources.size} ${row.ok ? "ok  " : "FAIL"} ${input} ${row.ok ? `${row.items} items, newest ${row.newest}, ${row.pace}/day` : row.result}`);
  });
  // Two inputs that lead to one feed seed it once, with both topics.
  const seen = new Map<string, Row>();
  for (const r of rows.filter((r) => r.ok)) {
    const key = canonical(r.feedUrl!);
    const first = seen.get(key);
    if (!first) seen.set(key, r);
    else {
      first.tags = [...new Set([...first.tags, ...r.tags])];
      r.ok = false;
      r.result = `same feed as ${first.input}`;
    }
  }
  const cutoff = new Date(Date.now() - STALE_DAYS * DAY).toISOString().slice(0, 10);
  for (const r of rows) if (r.ok && (!r.newest || r.newest < cutoff)) Object.assign(r, { ok: false, result: `stale: newest ${r.newest ?? "undated"}` });
  for (const r of rows) if (r.ok && (r.pace ?? 0) > MAX_PACE) Object.assign(r, { ok: false, result: `firehose: ${r.pace} a day` });
  const good = rows.filter((r) => r.ok);
  console.log(`\n${good.length} of ${sources.size} usable; about ${Math.round(good.reduce((s, r) => s + (r.pace ?? 0), 0))} new posts a day between them`);
  console.log(`busiest (over 20 a day): ${good.filter((r) => (r.pace ?? 0) > 20).map((r) => `${r.input} ${r.pace}`).join(", ") || "none"}`);
  console.log(`\nleft out:`);
  for (const r of rows.filter((r) => !r.ok)) console.log(`  ${r.input}: ${r.result}`);
  const count: Record<string, number> = {};
  for (const r of good) for (const t of r.tags) count[t] = (count[t] ?? 0) + 1;
  console.log(`\nfeeds per topic: ${Object.entries(count).sort((a, b) => a[1] - b[1]).map(([t, n]) => `${t} ${n}`).join(", ")}`);
  const unused = Object.keys(names).filter((u) => !sources.has(u));
  if (unused.length && !only) console.log(`\nnames for no source (a typo?): ${unused.join(", ")}`);
  if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
} else {
  if (!from) throw new Error("Pass --from with a report from --dry.");
  const rows: Row[] = JSON.parse(readFileSync(from, "utf8"));
  const usable = new Map(rows.filter((r) => r.ok).map((r) => [r.feedUrl!, r]));
  const { submit, Refused, MAX_TAGS } = await import("../src/lib/catalog.ts");
  const { feeds, client } = await import("../src/lib/db.ts");
  const tally = { added: 0, tagged: 0, refused: 0 };
  let n = 0;
  await pool([...usable], async ([input, { tags, name }]) => {
    let line: string;
    try {
      const { feed, added } = await submit(input, { tags, checkIndex: false, title: name });
      tally.added++;
      line = `added ${feed.slug} (${added} posts) [${feed.tags.join(" ")}]`;
    } catch (e) {
      if (e instanceof Refused && e.status === 409 && e.existing) {
        const col = await feeds();
        const feed = await col.findOne({ slug: e.existing }, { projection: { tags: 1 } });
        const merged = [...new Set([...(feed?.tags ?? []), ...tags])].slice(0, MAX_TAGS);
        if (feed && merged.length !== feed.tags.length) {
          await col.updateOne({ _id: feed._id }, { $set: { tags: merged, updatedAt: new Date() } });
          tally.tagged++;
          line = `tagged ${e.existing} [${merged.join(" ")}]`;
        } else line = `already ${e.existing}`;
      } else {
        tally.refused++;
        line = `REFUSED ${(e as Error).message.slice(0, 120)}`;
      }
    }
    console.log(`${++n}/${usable.size} ${input}: ${line}`);
  });
  console.log(`\n${tally.added} added, ${tally.tagged} existing ones tagged, ${tally.refused} refused`);
  await (await client()).close();
}
