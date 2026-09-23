// From whatever the visitor pasted — a home page, a blog post, the feed
// itself — to the feed URL, with a parsed preview of it.
//
// Order: the URL itself if it already is a feed; then every
// <link rel="alternate"> the page advertises; then the paths the common
// engines use. The first candidate that parses wins, and the others are
// returned so the form can offer them.
import { get, FetchError } from "./get.ts";
import { parseFeed, NotAFeed, type ParsedFeed } from "./parse.ts";
import { absolute, unescape } from "./url.ts";

const COMMON_PATHS = ["/feed", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/rss", "/feed/", "/blog/feed", "/blog/rss.xml", "/feed.json"];
const FEED_TYPES = /application\/(rss|atom|feed)\+(xml|json)|application\/(rdf\+)?xml|text\/xml/i;

export interface Discovered {
  feedUrl: string;
  feed: ParsedFeed;
  etag?: string;
  lastModified?: string;
  /** Other feeds the page advertised, for a site with several. */
  alternates: { url: string; title: string }[];
}

export async function discover(input: string): Promise<Discovered> {
  const start = normalizeInput(input);
  const page = await get(start);

  try {
    return { feedUrl: page.url, feed: parseFeed(page.body, page.url), etag: page.etag, lastModified: page.lastModified, alternates: [] };
  } catch (e) {
    if (!(e instanceof NotAFeed)) throw e;
  }

  const advertised = alternates(page.body, page.url);
  const origin = new URL(page.url).origin;
  const candidates = [...advertised.map((a) => a.url), ...COMMON_PATHS.map((p) => origin + p)];
  const tried = new Set<string>();

  for (const url of candidates) {
    if (tried.has(url)) continue;
    tried.add(url);
    try {
      const res = await get(url);
      const feed = parseFeed(res.body, res.url);
      return {
        feedUrl: res.url,
        feed,
        etag: res.etag,
        lastModified: res.lastModified,
        alternates: advertised.filter((a) => a.url !== url && a.url !== res.url),
      };
    } catch (e) {
      if (e instanceof NotAFeed || e instanceof FetchError) continue;
      throw e;
    }
  }
  throw new NotAFeed("No feed found at that address or advertised by it.");
}

/** What a visitor types, as a URL: a bare domain gets https://. */
export function normalizeInput(input: string): string {
  const s = input.trim();
  if (!s) throw new FetchError("empty address");
  return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
}

/** Every feed an HTML page advertises in its <head>. */
export function alternates(html: string, base: string): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (name: string) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? "";
    if (!/\balternate\b/i.test(attr("rel")) || !FEED_TYPES.test(attr("type"))) continue;
    const url = absolute(unescape(attr("href")), base);
    if (url && !out.some((o) => o.url === url)) out.push({ url, title: unescape(attr("title")) });
  }
  // Comment feeds are feeds, but nobody submitting a site means them.
  return out.sort((a, b) => Number(/comment/i.test(a.url + a.title)) - Number(/comment/i.test(b.url + b.title)));
}
