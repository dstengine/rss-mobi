// The catalogue: submitting a feed, storing what it publishes, polling it.
import { ObjectId, type AnyBulkWriteOperation, type Filter } from "mongodb";
import { blocklist, feeds, items } from "./db.ts";
import { discover } from "./feeds/discover.ts";
import { get, FetchError } from "./feeds/get.ts";
import { parseFeed, itemKey, topic, ownName, NotAFeed, type ParsedFeed, type Site } from "./feeds/parse.ts";
import { canonical, hostOf, slugify } from "./feeds/url.ts";
import { lock, unlock } from "./cache.ts";
import { noteActivity } from "./activity.ts";
import { subscriberTotal } from "./followers.ts";
import { alert, indexNow } from "./notify.ts";
import { policy } from "./policy.ts";
import { spamReason } from "./spam.ts";
import { newToken, sha256 } from "./tokens.ts";
import type { FeedDoc, ItemDoc } from "./types.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const ITEM_TTL_DAYS = 90;
export const FETCH_EVERY = HOUR;
/** Feeds fetched side by side in one run. */
const CONCURRENCY = 8;
/** A run also takes feeds due in the next two minutes. The scheduler calls
    every quarter hour and a feed's next turn is counted from when it was
    fetched, a few seconds into the run — without this, a feed due an hour
    later falls a few seconds after the next run starts and waits a quarter
    of an hour more, every time. */
const LOOKAHEAD = 2 * MINUTE;

/** How long a feed waits for its next poll. A feed that posts several
    times a day is read every quarter hour, as the big readers read it: its
    followers expect a post from minutes ago. The rest hourly. The
    conditional request makes a poll that finds nothing cost the site a
    304 and no more. */
export function interval(perWeek = 0): number {
  if (perWeek >= 21) return 15 * MINUTE;
  if (perWeek >= 7) return 30 * MINUTE;
  return FETCH_EVERY;
}

/** The wait after `fails` failures in a row: the feed's own interval,
    doubled for each, up to a day. A site that is down for an afternoon is
    not hammered, one that is gone stops costing anything after ten tries,
    and one slow answer from a feed read every quarter hour costs half an
    hour, not two. */
export function backoff(fails: number, perWeek = 0): number {
  return Math.min(DAY, interval(perWeek) * 2 ** Math.min(fails, 10));
}
const MAX_FAILS = 10;
export const MAX_TAGS = 5;

export class Refused extends Error {
  status: number;
  existing?: string;
  constructor(message: string, status = 422, existing?: string) {
    super(message);
    this.status = status;
    this.existing = existing;
  }
}

/* ------------------------------------------------------------ submitting */

export interface Submitted {
  feed: FeedDoc;
  editToken: string;
  added: number;
}

/** Everything a submission goes through, in order. There is no moderation
    queue: a feed that passes is live when this returns. */
export async function submit(input: string, opts: { tags?: string[]; ipHash?: string } = {}): Promise<Submitted> {
  let found;
  try {
    found = await discover(input);
  } catch (e) {
    if (e instanceof NotAFeed || e instanceof FetchError) throw new Refused(humanFetchError(e));
    throw e;
  }
  const { feed: parsed, feedUrl } = found;
  const host = hostOf(parsed.siteUrl) || hostOf(feedUrl);

  if (!parsed.items.length) throw new Refused("That feed has no items yet. Submit it once it has published something.");
  if (await isBlocked(host, hostOf(feedUrl))) throw new Refused("Feeds from this site are not accepted.", 403);
  const spam = spamReason(parsed, host);
  if (spam) throw new Refused(spam, 403);

  const col = await feeds();
  const canonicalUrl = canonical(feedUrl);
  const existing = await col.findOne({ canonicalUrl });
  if (existing) throw new Refused("That feed is already in the catalogue.", 409, existing.slug);

  const now = new Date();
  const editToken = newToken();
  const userTags = (opts.tags ?? []).map(topic).filter(Boolean).slice(0, MAX_TAGS);
  const doc: FeedDoc = {
    _id: new ObjectId(),
    slug: await freeSlug(parsed.title, host),
    url: feedUrl,
    canonicalUrl,
    siteUrl: parsed.siteUrl,
    host,
    title: parsed.title.slice(0, 200),
    description: parsed.description,
    lang: parsed.lang,
    tags: feedTags(userTags, parsed, { title: parsed.title, host }),
    image: parsed.image,
    format: parsed.format,
    status: "active",
    editHash: sha256(editToken),
    etag: found.etag,
    lastModified: found.lastModified,
    nextFetchAt: new Date(now.getTime() + FETCH_EVERY),
    lastFetchAt: now,
    failCount: 0,
    okCount: 1,
    itemCount: 0,
    robots: null,
    linkMode: null,
    submittedIpHash: opts.ipHash,
    createdAt: now,
    updatedAt: now,
  };
  await col.insertOne(doc);
  const added = await store(doc, parsed);
  doc.itemCount = added;
  await activity(doc);
  return { feed: doc, editToken, added };
}

export function humanFetchError(e: Error): string {
  const m = e.message;
  if (/private|http and https|port|credentials|not a URL|empty address/.test(m)) return "That address cannot be fetched. Use a public http(s) URL.";
  if (/does not resolve/.test(m)) return "That site does not resolve. Check the address.";
  if (/HTTP (\d+)/.test(m)) return `The site answered ${m}.`;
  if (/over \d+ bytes/.test(m)) return "That feed is too large (over 5 MB).";
  if (/No feed found/.test(m)) return m;
  return "No readable feed was found at that address.";
}

async function isBlocked(...hosts: string[]): Promise<boolean> {
  const ids = hosts.filter(Boolean).flatMap((h) => {
    // example.com blocks every subdomain of it, too.
    const parts = h.split(".");
    return parts.slice(0, -1).map((_, i) => parts.slice(i).join("."));
  });
  return ids.length > 0 && (await (await blocklist()).countDocuments({ _id: { $in: ids } }, { limit: 1 })) > 0;
}

async function freeSlug(title: string, host: string): Promise<string> {
  const col = await feeds();
  const base = slugify(title, slugify(host.replace(/\./g, " "), "feed"));
  for (const candidate of [base, `${base}-${slugify(host.split(".")[0])}`]) {
    if (!(await col.findOne({ slug: candidate }, { projection: { _id: 1 } }))) return candidate;
  }
  for (let n = 2; n < 50; n++) {
    if (!(await col.findOne({ slug: `${base}-${n}` }, { projection: { _id: 1 } }))) return `${base}-${n}`;
  }
  return `${base}-${newToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/** The submitter's tags first, then the categories the feed itself uses
    most, up to five; never the site's own name. */
export function feedTags(userTags: string[], parsed: Pick<ParsedFeed, "items">, self?: Site): string[] {
  const counts = new Map<string, number>();
  for (const it of parsed.items) for (const t of it.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const popular = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const all = [...new Set([...userTags, ...popular])];
  return (self ? all.filter((t) => !ownName(t, self)) : all).slice(0, MAX_TAGS);
}

/* --------------------------------------------------------------- storing */

/** Upserts the feed's items. New ones join the index-check queue at once;
    existing ones are left alone, so a poll that finds nothing new changes
    nothing and moves no dates. Returns how many were new. */
export async function store(feed: FeedDoc, parsed: ParsedFeed): Promise<number> {
  const now = new Date();
  const ops: AnyBulkWriteOperation<ItemDoc>[] = parsed.items.map((it) => {
    const doc: Omit<ItemDoc, "_id"> = {
      feedId: feed._id,
      feedSlug: feed.slug,
      guid: itemKey(it).slice(0, 500),
      url: it.url,
      canonicalUrl: canonical(it.url),
      host: hostOf(it.url),
      title: it.title.slice(0, 300),
      excerpt: it.excerpt,
      image: it.image,
      author: it.author,
      tags: [...new Set([...it.tags.filter((t) => !ownName(t, feed)), ...feed.tags])].slice(0, 10),
      lang: feed.lang,
      publishedAt: it.publishedAt ?? now,
      visible: feed.status === "active",
      indexStatus: "queued",
      indexNextCheckAt: now,
      indexChecks: 0,
      robots: null,
      // The owner's choice travels with each post, so every list, the
      // reader and the API mark its links the same way (applyEdit keeps
      // it in step).
      linkMode: feed.linkMode ?? null,
      expiresAt: new Date(now.getTime() + ITEM_TTL_DAYS * DAY),
      createdAt: now,
      updatedAt: now,
    };
    return { updateOne: { filter: { feedId: feed._id, guid: doc.guid }, update: { $setOnInsert: doc }, upsert: true } };
  });
  if (!ops.length) return 0;
  const res = await (await items()).bulkWrite(ops, { ordered: false });
  const added = res.upsertedCount;
  const total = await (await items()).countDocuments({ feedId: feed._id });
  await (await feeds()).updateOne(
    { _id: feed._id },
    { $set: { itemCount: total, ...(added ? { updatedAt: now } : {}) } },
  );
  return added;
}

/* --------------------------------------------------------------- polling */

export interface PollReport {
  polled: number;
  unchanged: number;
  added: number;
  failed: number;
  disabled: string[];
}

/** Polls feeds whose turn has come until `deadline` (ms since epoch). */
export async function pollDue(deadline: number, batch = 200): Promise<PollReport> {
  return pollWhere({}, deadline, batch, LOOKAHEAD);
}

/** Polls those of the named feeds whose turn has come, a few at a time.
    Pages and the API call it once they have answered, so a feed someone
    is reading is at most an hour behind its site — however late the
    scheduler runs. The lock keeps a busy page from polling a feed twice. */
export async function pollIfDue(slugs: string[], max = 4, budget = 20_000): Promise<PollReport> {
  const wanted = [...new Set(slugs)].slice(0, 200);
  if (!wanted.length) return { polled: 0, unchanged: 0, added: 0, failed: 0, disabled: [] };
  return pollWhere({ slug: { $in: wanted } }, Date.now() + budget, max, 0);
}

async function pollWhere(filter: Filter<FeedDoc>, deadline: number, batch: number, ahead: number): Promise<PollReport> {
  const report: PollReport = { polled: 0, unchanged: 0, added: 0, failed: 0, disabled: [] };
  const col = await feeds();
  const queue = await col
    .find({ ...filter, status: "active", nextFetchAt: { $lte: new Date(Date.now() + ahead) } })
    .sort({ nextFetchAt: 1 })
    .limit(batch)
    .toArray();

  // A few workers share the queue, most overdue first: one slow site
  // holds up one worker, not the run.
  const worker = async () => {
    for (let feed = queue.shift(); feed && Date.now() <= deadline; feed = queue.shift()) {
      if (!(await lock(`feed:${feed._id}`, 120))) continue;
      try {
        report.polled++;
        const outcome = await pollOne(feed);
        if (outcome === "unchanged") report.unchanged++;
        else if (typeof outcome === "number") report.added += outcome;
        else {
          report.failed++;
          if (outcome.disabled) report.disabled.push(feed.slug);
        }
      } finally {
        await unlock(`feed:${feed._id}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  if (report.disabled.length) await alert(`disabled after ${MAX_FAILS} failed fetches: ${report.disabled.join(", ")}`);
  return report;
}

async function pollOne(feed: FeedDoc): Promise<number | "unchanged" | { disabled: boolean }> {
  const col = await feeds();
  const now = new Date();
  try {
    const res = await get(feed.url, { etag: feed.etag, lastModified: feed.lastModified, subscribers: subscriberTotal(feed.subscribers) });
    const common = {
      lastFetchAt: now,
      failCount: 0,
      nextFetchAt: new Date(now.getTime() + interval(feed.postsPerWeek)),
      etag: res.etag ?? feed.etag,
      lastModified: res.lastModified ?? feed.lastModified,
    };
    if (res.notModified) {
      await col.updateOne({ _id: feed._id }, { $set: common, $inc: { okCount: 1 }, $unset: { lastError: "" } });
      await activity(feed);
      await announceIfIndexable(feed._id);
      return "unchanged";
    }
    const parsed = parseFeed(res.body, res.url);
    await col.updateOne({ _id: feed._id }, { $set: common, $inc: { okCount: 1 }, $unset: { lastError: "" } });
    const added = await store(feed, parsed);
    await activity(feed);
    await announceIfIndexable(feed._id);
    return added;
  } catch (e) {
    const fails = feed.failCount + 1;
    const disabled = fails >= MAX_FAILS;
    const wait = backoff(fails, feed.postsPerWeek);
    await col.updateOne(
      { _id: feed._id },
      {
        $set: {
          failCount: fails,
          lastError: (e as Error).message.slice(0, 300),
          lastFetchAt: now,
          nextFetchAt: new Date(now.getTime() + wait),
          ...(disabled ? { status: "disabled" as const } : {}),
        },
      },
    );
    if (disabled) await (await items()).updateMany({ feedId: feed._id }, { $set: { visible: false } });
    return { disabled };
  }
}

/** A feed's pace and rank, refreshed. Its failure is logged, never counted
    against the feed: the fetch itself went fine. */
async function activity(feed: FeedDoc): Promise<void> {
  try {
    await noteActivity(feed);
  } catch (e) {
    console.error(`activity ${feed.slug}: ${(e as Error).message}`);
  }
}

/** The first time a feed page crosses into `index`, IndexNow hears about
    it. Once only: `announcedAt` records that it was said — and only once
    a search engine accepted it, so a missing key or a failed ping is
    tried again on the next poll instead of being forgotten. */
async function announceIfIndexable(id: ObjectId): Promise<void> {
  const col = await feeds();
  const feed = await col.findOne({ _id: id, announcedAt: { $exists: false } });
  if (!feed || policy({ type: "feed", feed }).robots !== "index,follow") return;
  const status = await indexNow([`/feed/${feed.slug}/`]);
  if (status === 200 || status === 202) await col.updateOne({ _id: id }, { $set: { announcedAt: new Date() } });
}

/* ------------------------------------------------------------ visibility */

/** Hides or shows a feed and everything it published. */
export async function setStatus(slug: string, status: FeedDoc["status"]): Promise<boolean> {
  const feed = await (await feeds()).findOneAndUpdate({ slug }, { $set: { status, updatedAt: new Date() } }, { returnDocument: "after" });
  if (!feed) return false;
  await (await items()).updateMany({ feedId: feed._id }, { $set: { visible: status === "active" } });
  return true;
}
