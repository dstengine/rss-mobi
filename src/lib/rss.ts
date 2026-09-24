// The RSS 2.0 documents rss.mobi publishes: a feed's and a collection's
// now, tag and filter exports in slice 4. Each post carries a link to its
// original, its excerpt, and a <source> naming the feed it came from — a
// reader that follows a mix of feeds should still be able to tell who
// wrote what. A feed's own copy also carries what its original does: the
// whole post in <content:encoded>, the episode in <enclosure>, the
// picture in <media:thumbnail>.
import type { Media } from "./feeds/parse.ts";
import { esc } from "./xml.ts";
import type { PublicItem } from "./views.ts";

export type RssItem = Pick<PublicItem, "feedSlug" | "url" | "title" | "excerpt" | "image" | "author" | "tags"> & {
  /** Undated only for a post the original lists without a date. */
  publishedAt?: Date;
  /** Clean HTML (feeds/clean.ts), never raw. */
  content?: string;
  media?: Media[];
};

export interface RssChannel {
  title: string;
  /** The page this feed belongs to: ours for a collection, the
      publisher's site for a feed's copy. */
  link: string;
  /** Where this document itself is served. */
  self: string;
  description: string;
  image?: string;
  /** Minutes a reader may cache the document. */
  ttl?: number;
  items: RssItem[];
  /** Title and address of each feed an item may come from, by slug. */
  sources?: Map<string, { title: string; url: string }>;
}

/** HTML inside CDATA: only "]]>" ends it early, so that is split. */
const cdata = (html: string) => `<![CDATA[${html.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

export function toRss(c: RssChannel): string {
  const newest = c.items.reduce<Date | null>((d, it) => {
    if (!it.publishedAt) return d;
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
      it.publishedAt ? `      <pubDate>${new Date(it.publishedAt).toUTCString()}</pubDate>` : "",
      it.excerpt ? `      <description>${esc(it.excerpt)}</description>` : "",
      it.content ? `      <content:encoded>${cdata(it.content)}</content:encoded>` : "",
      // RSS 2.0 has room for one enclosure; the rest ride as media:content.
      ...(it.media ?? []).map((m, i) =>
        i === 0
          ? `      <enclosure url="${esc(m.url)}" length="${m.length ?? 0}" type="${esc(m.type)}"/>`
          : `      <media:content url="${esc(m.url)}" type="${esc(m.type)}"${m.length ? ` fileSize="${m.length}"` : ""}/>`,
      ),
      it.image ? `      <media:thumbnail url="${esc(it.image)}"/>` : "",
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
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">`,
    `  <channel>`,
    `    <title>${esc(c.title)}</title>`,
    `    <link>${esc(c.link)}</link>`,
    `    <description>${esc(c.description)}</description>`,
    `    <atom:link href="${esc(c.self)}" rel="self" type="application/rss+xml"/>`,
    c.image ? `    <image>\n      <url>${esc(c.image)}</url>\n      <title>${esc(c.title)}</title>\n      <link>${esc(c.link)}</link>\n    </image>` : "",
    `    <generator>rss.mobi</generator>`,
    `    <docs>https://www.rssboard.org/rss-specification</docs>`,
    newest ? `    <lastBuildDate>${newest.toUTCString()}</lastBuildDate>` : "",
    `    <ttl>${c.ttl ?? 60}</ttl>`,
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
