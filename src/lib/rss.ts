// The RSS 2.0 documents rss.mobi publishes: a collection's feed now, tag and
// filter exports in slice 4. Each post carries a link to its original, the
// excerpt we store and nothing more, and a <source> naming the feed it
// came from — a reader that follows a mix of feeds should still be able to
// tell who wrote what.
import { esc } from "./xml.ts";
import type { PublicItem } from "./views.ts";

export interface RssChannel {
  title: string;
  /** The HTML page this feed belongs to. */
  link: string;
  /** Where this document itself is served. */
  self: string;
  description: string;
  items: PublicItem[];
  /** Title and address of each feed an item may come from, by slug. */
  sources?: Map<string, { title: string; url: string }>;
}

export function toRss(c: RssChannel): string {
  const newest = c.items.reduce<Date | null>((d, it) => {
    const t = new Date(it.publishedAt);
    return !d || t > d ? t : d;
  }, null);
  const items = c.items.map((it) => {
    const src = c.sources?.get(it.feedSlug);
    return [
      `    <item>`,
      `      <title>${esc(it.title)}</title>`,
      `      <link>${esc(it.url)}</link>`,
      `      <guid isPermaLink="true">${esc(it.url)}</guid>`,
      `      <pubDate>${new Date(it.publishedAt).toUTCString()}</pubDate>`,
      it.excerpt ? `      <description>${esc(it.excerpt)}</description>` : "",
      it.author ? `      <dc:creator>${esc(it.author)}</dc:creator>` : "",
      ...it.tags.map((t) => `      <category>${esc(t)}</category>`),
      src ? `      <source url="${esc(src.url)}">${esc(src.title)}</source>` : "",
      `    </item>`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">`,
    `  <channel>`,
    `    <title>${esc(c.title)}</title>`,
    `    <link>${esc(c.link)}</link>`,
    `    <description>${esc(c.description)}</description>`,
    `    <atom:link href="${esc(c.self)}" rel="self" type="application/rss+xml"/>`,
    `    <generator>rss.mobi</generator>`,
    `    <docs>https://www.rssboard.org/rss-specification</docs>`,
    newest ? `    <lastBuildDate>${newest.toUTCString()}</lastBuildDate>` : "",
    `    <ttl>60</ttl>`,
    ...items,
    `  </channel>`,
    `</rss>`,
  ]
    .filter(Boolean)
    .join("\n")
    .concat("\n");
}

/** Headers for a feed or OPML file we publish: readers fetch it, search
    engines leave it out of their index — the page it belongs to is what
    should rank. */
export function xmlHeaders(type: string, cache: string): Headers {
  return new Headers({
    "Content-Type": `${type}; charset=utf-8`,
    "Cache-Control": cache,
    "X-Robots-Tag": "noindex",
    "Access-Control-Allow-Origin": "*",
  });
}
