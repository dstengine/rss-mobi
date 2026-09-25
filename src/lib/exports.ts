// The directory as files a reader subscribes to or imports: RSS of any
// filter over posts (/rss.xml?…, /tag/<tag>/rss.xml) and OPML of its feeds
// (/opml.xml, /tag/<tag>/opml.xml). The posts are what /api/v1/items gives
// for the same filters — parseFilters() reads both — so a site that tried a
// query in the API gets the same answer as a feed.
//
// Following an export does not count as reading its feeds (pollIfDue): one
// reader subscribed to /rss.xml would otherwise keep every feed in the
// directory at full pace, on a CPU budget of four hours a month. Exports
// show what the poller has, at most a poll behind.
import { toSearch, type Filters } from "./filters.ts";
import { toOpml } from "./opml.ts";
import { toRss } from "./rss.ts";
import { feedsBySlugs, itemsFor, type PublicFeed } from "./views.ts";
import { site } from "../site.config.ts";

/** The path of the RSS export for `f`, spelled one way. */
export const rssPath = (f: Filters) => {
  const q = toSearch(f);
  return `/rss.xml${q ? `?${q}` : ""}`;
};

export const rssUrl = (f: Filters) => `${site.url}${rssPath(f)}`;

/** RSS 2.0 of the newest posts matching `f`. `link` is the page a reader
    app shows as the feed's home. */
export async function postsRss(f: Filters, c: { title: string; link: string; self: string; description: string }): Promise<string> {
  const items = await itemsFor(f);
  const list = await feedsBySlugs([...new Set(items.map((it) => it.feedSlug))]);
  return toRss({
    ...c,
    // Filters change more slowly than a single feed does; the CDN keeps the
    // file five minutes either way.
    ttl: 30,
    items,
    sources: new Map(list.map((f) => [f.slug, { title: f.title, url: f.url }])),
  });
}

/** OPML of `feeds`, each by its original address: an import should
    subscribe to the publishers, not to our copies. */
export const feedsOpml = (title: string, feeds: PublicFeed[]) =>
  toOpml(
    title,
    feeds.map((f) => ({ title: f.title, url: f.url, siteUrl: f.siteUrl || undefined })),
    feeds.reduce<Date | undefined>((d, f) => (!d || f.updatedAt > d ? f.updatedAt : d), undefined),
  );
