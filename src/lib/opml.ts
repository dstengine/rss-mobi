// OPML: the file every feed reader imports and exports a subscription list
// as. Used on both sides — the server writes it for a collection, the
// reader writes and reads it in the browser — so nothing here touches the
// DOM or Node.
import { attributes, esc } from "./xml.ts";

export interface OpmlFeed {
  title: string;
  /** The feed's own address. */
  url: string;
  /** The site the feed belongs to, when known. */
  siteUrl?: string;
}

export function toOpml(title: string, feeds: OpmlFeed[], modified = new Date()): string {
  const outlines = feeds.map(
    (f) =>
      `    <outline type="rss" text="${esc(f.title)}" title="${esc(f.title)}" xmlUrl="${esc(f.url)}"${f.siteUrl ? ` htmlUrl="${esc(f.siteUrl)}"` : ""}/>`,
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<opml version="2.0">`,
    `  <head>`,
    `    <title>${esc(title)}</title>`,
    `    <dateModified>${modified.toUTCString()}</dateModified>`,
    `    <docs>https://opml.org/spec2.opml</docs>`,
    `  </head>`,
    `  <body>`,
    ...outlines,
    `  </body>`,
    `</opml>`,
    ``,
  ].join("\n");
}

/** Every feed in an OPML file, however it is nested in folders. Readers
    disagree on nearly everything else in the format, but all of them put
    the feed address in `xmlUrl`, so that is the one thing required. */
export function parseOpml(text: string, max = 1_000): OpmlFeed[] {
  const seen = new Set<string>();
  const out: OpmlFeed[] = [];
  for (const m of text.matchAll(/<outline\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    const url = (a.xmlUrl ?? a.xmlurl ?? "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: (a.title || a.text || url).trim(), url, siteUrl: a.htmlUrl || a.htmlurl || undefined });
    if (out.length >= max) break;
  }
  return out;
}
