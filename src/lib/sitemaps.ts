// What goes in the sitemap and with which date. Only pages policy() calls
// indexable; each dated by its own updatedAt, and a page with no entry of
// its own by the newest of what it lists against the date of its copy
// (site.config.ts COPY_UPDATED). See ~/dst/CLAUDE.md.
import { feeds } from "./db.ts";
import { policy } from "./policy.ts";
import { newest, type Entry } from "./sitemap.ts";
import { recentFeeds, tagStats } from "./views.ts";
import { copyDate, site } from "../site.config.ts";

export const FEEDS_PER_FILE = 5_000;
const STATIC = ["/submit/", "/about/", "/terms/"];

const loc = (path: string) => `${site.url}${path}`;

export async function pageEntries(): Promise<Entry[]> {
  // The front page lists the thirty newest feeds, so it is as new as the
  // newest of those — not of every feed in the directory.
  const [listed, tags] = await Promise.all([recentFeeds(30), tagStats(500)]);
  return [
    { loc: loc("/"), lastmod: newest([copyDate("/"), ...listed.map((f) => f.updatedAt)]) },
    { loc: loc("/tags/"), lastmod: newest([copyDate("/tags/"), ...tags.map((t) => t.updatedAt)]) },
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

export const xmlResponse = (xml: string) =>
  new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=86400",
    },
  });
