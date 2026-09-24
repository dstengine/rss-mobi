// What goes in the sitemap and with which date. Only pages policy() calls
// indexable; each dated by its own updatedAt, and a page with no entry of
// its own by the newest of what it lists against the date of its copy
// (site.config.ts COPY_UPDATED). See "Sitemap dates" in AGENTS.md.
import type { Filter } from "mongodb";
import { feeds, items } from "./db.ts";
import { policy } from "./policy.ts";
import { newest, type Entry } from "./sitemap.ts";
import { itemPath, recentFeeds, tagStats } from "./views.ts";
import type { ItemDoc } from "./types.ts";
import { copyDate, site } from "../site.config.ts";

export const FEEDS_PER_FILE = 5_000;
export const ITEMS_PER_FILE = 10_000;
const STATIC = ["/c/new/", "/submit/", "/about/", "/terms/"];

const loc = (path: string) => `${site.url}${path}`;

export async function pageEntries(): Promise<Entry[]> {
  // The front page lists the thirty newest feeds, so it is as new as the
  // newest of those — not of every feed in the directory.
  const [listed, tags] = await Promise.all([recentFeeds(30), tagStats(500)]);
  return [
    { loc: loc("/"), lastmod: newest([copyDate("/"), ...listed.map((f) => f.updatedAt)]) },
    { loc: loc("/tags/"), lastmod: newest([copyDate("/tags/"), ...tags.map((t) => t.updatedAt)]) },
    // The reader's starter list is the eight newest feeds.
    { loc: loc("/reader/"), lastmod: newest([copyDate("/reader/"), ...listed.slice(0, 8).map((f) => f.updatedAt)]) },
    ...STATIC.map((p) => ({ loc: loc(p), lastmod: copyDate(p) })),
  ];
}

export async function tagEntries(): Promise<Entry[]> {
  const tags = await tagStats(5_000);
  return tags
    .filter((t) => policy({ type: "tag", feeds: t.feeds, hosts: t.hosts }).sitemap)
    .map((t) => ({ loc: loc(`/tag/${t.tag}/`), lastmod: newest([copyDate("/tag/"), t.updatedAt]) }));
}

export async function feedFileCount(): Promise<number> {
  const n = await (await feeds()).countDocuments({ status: "active" });
  return Math.max(1, Math.ceil(n / FEEDS_PER_FILE));
}

/** Feed pages for file `n` (1-based). Files are cut from all active feeds
    in creation order, so a feed never moves between files; the indexable
    ones among them are listed. */
export async function feedEntries(n: number): Promise<Entry[]> {
  const rows = await (await feeds())
    .find({ status: "active" }, { projection: { _id: 0, slug: 1, status: 1, itemCount: 1, okCount: 1, robots: 1, updatedAt: 1 } })
    .sort({ createdAt: 1, _id: 1 })
    .skip((n - 1) * FEEDS_PER_FILE)
    .limit(FEEDS_PER_FILE)
    .toArray();
  return rows.filter((f) => policy({ type: "feed", feed: f }).sitemap).map((f) => ({ loc: loc(`/feed/${f.slug}/`), lastmod: f.updatedAt }));
}

/** Posts whose page policy() can open: an override to index, or no
    override and an original Google does not have. Everything else is
    noindex whatever else is true, so the query leaves it out. */
export const OPEN_ITEMS: Filter<ItemDoc> = { visible: true, $or: [{ robots: "index,follow" }, { robots: null, indexStatus: "not_indexed" }] };

export async function itemFileCount(): Promise<number> {
  const n = await (await items()).countDocuments(OPEN_ITEMS);
  return Math.max(1, Math.ceil(n / ITEMS_PER_FILE));
}

/** Post pages for file `n` (1-based), each dated by its item's updatedAt —
    which moves when the page opens or closes, not on every check. Unlike
    feeds, a post leaves when its original is indexed, so the files are
    cut from the open ones and a post can move between files; a file's
    date in the index moves with it. */
export async function itemEntries(n: number): Promise<Entry[]> {
  const rows = await (await items())
    .find(OPEN_ITEMS, { projection: { _id: 1, visible: 1, indexStatus: 1, robots: 1, updatedAt: 1 } })
    .sort({ _id: 1 })
    .skip((n - 1) * ITEMS_PER_FILE)
    .limit(ITEMS_PER_FILE)
    .toArray();
  // A visible post's feed is active: `visible` is kept in step with it.
  return rows
    .filter((it) => policy({ type: "item", item: it, feed: { status: "active" } }).sitemap)
    .map((it) => ({ loc: loc(itemPath(String(it._id))), lastmod: it.updatedAt }));
}

export const xmlResponse = (xml: string) =>
  new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=86400",
    },
  });
