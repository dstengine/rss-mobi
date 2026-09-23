// The read side: what pages and the public API show. Every function here
// returns public fields only — an edit hash or a submitter's IP hash must
// never reach a template, so they are stripped at the query, not later.
import { ObjectId, type Filter } from "mongodb";
import { feeds, items } from "./db.ts";
import { cached } from "./cache.ts";
import { toQuery, type Cursor, type Filters } from "./filters.ts";
import { linkTo } from "./policy.ts";
import type { FeedDoc, ItemDoc } from "./types.ts";

export type PublicFeed = Pick<
  FeedDoc,
  | "slug"
  | "url"
  | "siteUrl"
  | "host"
  | "title"
  | "description"
  | "lang"
  | "tags"
  | "image"
  | "format"
  | "status"
  | "itemCount"
  | "okCount"
  | "robots"
  | "linkMode"
  | "lastFetchAt"
  | "createdAt"
  | "updatedAt"
>;

export type PublicItem = Pick<
  ItemDoc,
  "feedSlug" | "url" | "host" | "title" | "excerpt" | "image" | "author" | "tags" | "lang" | "publishedAt" | "indexStatus" | "linkMode" | "updatedAt"
> & { id: string };

const FEED_FIELDS = {
  _id: 0,
  slug: 1,
  url: 1,
  siteUrl: 1,
  host: 1,
  title: 1,
  description: 1,
  lang: 1,
  tags: 1,
  image: 1,
  format: 1,
  status: 1,
  itemCount: 1,
  okCount: 1,
  robots: 1,
  linkMode: 1,
  lastFetchAt: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

const ITEM_FIELDS = {
  _id: 1,
  feedSlug: 1,
  url: 1,
  host: 1,
  title: 1,
  excerpt: 1,
  image: 1,
  author: 1,
  tags: 1,
  lang: 1,
  publishedAt: 1,
  indexStatus: 1,
  linkMode: 1,
  updatedAt: 1,
} as const;

const toItem = ({ _id, ...rest }: any): PublicItem => ({ id: String(_id), ...rest });

/** Feeds a reader can see: active, with something in them. */
const LISTED: Filter<FeedDoc> = { status: "active", itemCount: { $gt: 0 } };

export async function feedBySlug(slug: string): Promise<PublicFeed | null> {
  return (await feeds()).findOne<PublicFeed>({ slug }, { projection: FEED_FIELDS });
}

export async function recentFeeds(limit = 20, skip = 0): Promise<PublicFeed[]> {
  return (await feeds()).find<PublicFeed>(LISTED, { projection: FEED_FIELDS }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
}

export async function listedCount(): Promise<number> {
  return (await feeds()).countDocuments(LISTED);
}

export async function feedItems(slug: string, limit = 20): Promise<PublicItem[]> {
  const rows = await (await items())
    .find({ feedSlug: slug, visible: true }, { projection: ITEM_FIELDS })
    .sort({ publishedAt: -1 })
    .limit(limit)
    .toArray();
  return rows.map(toItem);
}

/** Items matching `f`, newest first, starting after `after`. */
export async function itemsFor(f: Filters, after?: Cursor): Promise<PublicItem[]> {
  const q = toQuery(f);
  if (after) q.$or = [{ publishedAt: { $lt: after.at } }, { publishedAt: after.at, _id: { $lt: new ObjectId(after.id) } }];
  const rows = await (await items()).find(q, { projection: ITEM_FIELDS }).sort({ publishedAt: -1, _id: -1 }).limit(f.limit).toArray();
  return rows.map(toItem);
}

/** Listed feeds among `slugs`, in the order given. */
export async function feedsBySlugs(slugs: string[]): Promise<PublicFeed[]> {
  if (!slugs.length) return [];
  const rows = await (await feeds()).find<PublicFeed>({ ...LISTED, slug: { $in: slugs } }, { projection: FEED_FIELDS }).toArray();
  const by = new Map(rows.map((f) => [f.slug, f]));
  return slugs.map((s) => by.get(s)).filter((f): f is PublicFeed => !!f);
}

export interface TagStat {
  tag: string;
  feeds: number;
  hosts: number;
  updatedAt: Date;
}

/** Every tag in use, with how many feeds from how many sites carry it.
    Cached for five minutes: this runs on the front page. */
export async function tagStats(limit = 200): Promise<TagStat[]> {
  const rows = await cached(`tags:${limit}`, 300, async () =>
    (await feeds())
      .aggregate<TagStat>([
        { $match: LISTED },
        { $unwind: "$tags" },
        { $group: { _id: "$tags", feeds: { $sum: 1 }, hosts: { $addToSet: "$host" }, updatedAt: { $max: "$updatedAt" } } },
        { $project: { _id: 0, tag: "$_id", feeds: 1, hosts: { $size: "$hosts" }, updatedAt: 1 } },
        { $sort: { feeds: -1, tag: 1 } },
        { $limit: limit },
      ])
      .toArray(),
  );
  // Redis hands dates back as strings.
  return rows.map((r) => ({ ...r, updatedAt: new Date(r.updatedAt) }));
}

export async function tagStat(tag: string): Promise<TagStat | null> {
  const [row] = await (await feeds())
    .aggregate<TagStat>([
      { $match: { ...LISTED, tags: tag } },
      { $group: { _id: null, feeds: { $sum: 1 }, hosts: { $addToSet: "$host" }, updatedAt: { $max: "$updatedAt" } } },
      { $project: { _id: 0, tag: { $literal: tag }, feeds: 1, hosts: { $size: "$hosts" }, updatedAt: 1 } },
    ])
    .toArray();
  return row ?? null;
}

export async function feedsByTag(tag: string, limit = 50): Promise<PublicFeed[]> {
  return (await feeds()).find<PublicFeed>({ ...LISTED, tags: tag }, { projection: FEED_FIELDS }).sort({ updatedAt: -1 }).limit(limit).toArray();
}

export async function itemsByTag(tag: string, limit = 20): Promise<PublicItem[]> {
  const rows = await (await items())
    .find({ tags: tag, visible: true }, { projection: ITEM_FIELDS })
    .sort({ publishedAt: -1 })
    .limit(limit)
    .toArray();
  return rows.map(toItem);
}

export async function searchFeeds(q: string, limit = 30): Promise<PublicFeed[]> {
  if (!q.trim()) return [];
  return (await feeds())
    .find<PublicFeed>({ ...LISTED, $text: { $search: q } }, { projection: { ...FEED_FIELDS, score: { $meta: "textScore" } } })
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .toArray();
}

/** Feed pages for the sitemap: slug and date only. */
export async function feedsForSitemap(skip: number, limit: number) {
  return (await feeds())
    .find({ status: "active" }, { projection: { _id: 0, slug: 1, status: 1, itemCount: 1, okCount: 1, robots: 1, updatedAt: 1 } })
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit)
    .toArray();
}

export const fmtDate = (d: Date | string | undefined | null) =>
  d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(d)) : "";

/** A remote image we are willing to show: https only, so a page never
    carries mixed content, and never from a private address. */
export const safeImage = (src?: string) => (src && /^https:\/\//i.test(src) ? src : undefined);

/** A feed as the public API returns it. */
export function feedJson(f: PublicFeed) {
  return {
    slug: f.slug,
    title: f.title,
    description: f.description,
    url: f.url,
    siteUrl: f.siteUrl,
    host: f.host,
    lang: f.lang,
    tags: f.tags,
    image: safeImage(f.image) ?? null,
    format: f.format,
    status: f.status,
    itemCount: f.itemCount,
    page: `https://rss.mobi/feed/${f.slug}/`,
    lastFetchAt: f.lastFetchAt ?? null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

export function itemJson(it: PublicItem) {
  const link = linkTo(it);
  return {
    id: it.id,
    feed: it.feedSlug,
    title: it.title,
    url: it.url,
    host: it.host,
    excerpt: it.excerpt,
    image: safeImage(it.image) ?? null,
    author: it.author ?? null,
    tags: it.tags,
    lang: it.lang,
    publishedAt: it.publishedAt,
    /** How rss.mobi links to the original, from policy(): `rel` is null
        for a plain link, and mode "none" means the address is shown as
        text. The reader renders links from this, not a rule of its own. */
    link: { mode: link.mode, rel: link.rel },
  };
}
