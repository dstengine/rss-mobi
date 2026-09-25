// Any feed a webmaster might submit, read into one shape.
//
// events-scan.mjs reads feeds with regular expressions, which is fine for a
// dozen sources somebody chose by hand. Here the sources are whatever the
// public sends, so the four real formats are parsed properly: RSS 2.0
// (and 0.9x), RSS 1.0 / RDF, Atom, and JSON Feed.
import { XMLParser } from "fast-xml-parser";
import { absolute, canonical, clip, tag, unescape, unhtml } from "./url.ts";

export { tag };

export const EXCERPT_MAX = 300;
const ITEMS_MAX = 100;

export interface ParsedItem {
  guid: string;
  url: string;
  title: string;
  excerpt: string;
  /** The post as the feed publishes it, raw HTML. Passed on, never stored
      (catalog.ts names the fields it keeps). */
  content?: string;
  /** Audio and video attached to the post: a podcast's episode. */
  media?: Media[];
  image?: string;
  author?: string;
  publishedAt?: Date;
  tags: string[];
}

export interface Media {
  url: string;
  type: string;
  length?: number;
}

export interface ParsedFeed {
  format: "rss" | "rdf" | "atom" | "json";
  title: string;
  description: string;
  siteUrl: string;
  lang: string;
  image?: string;
  items: ParsedItem[];
}

export class NotAFeed extends Error {}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Everything that can repeat is always an array, so the code below never
  // has to ask whether a feed with one item gave it an object or a list.
  isArray: (name) => ["item", "entry", "category", "link", "media:content", "media:thumbnail", "enclosure"].includes(name),
});

/** Parses `body` as a feed; throws NotAFeed when it is not one. `base` is
    the URL it was fetched from, for resolving relative links. */
export function parseFeed(body: string, base: string): ParsedFeed {
  const feed = parseAny(body, base);
  for (const it of feed.items) it.excerpt = withoutTitle(it.excerpt, it.title);
  return feed;
}

/** Many feeds open their content with the post's own heading, so the
    excerpt would say the title twice. */
export function withoutTitle(excerpt: string, title: string): string {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  if (!title || !norm(excerpt).startsWith(norm(title))) return excerpt;
  const rest = excerpt.replace(/\s+/g, " ").trim().slice(norm(title).length).replace(/^[\s:.,;—–-]+/, "");
  return rest;
}

function parseAny(body: string, base: string): ParsedFeed {
  const text = body.replace(/^﻿/, "").trim();
  if (text.startsWith("{")) return parseJson(text, base);
  if (!text.startsWith("<")) throw new NotAFeed("neither XML nor JSON");

  let doc: any;
  try {
    doc = xml.parse(text);
  } catch (e) {
    throw new NotAFeed(`XML does not parse: ${(e as Error).message}`);
  }
  if (doc.rss?.channel) return parseRss(doc.rss.channel, base);
  if (doc["rdf:RDF"]) return parseRdf(doc["rdf:RDF"], base);
  if (doc.feed) return parseAtom(doc.feed, base);
  throw new NotAFeed("no rss, rdf:RDF or feed root");
}

/* ---------------------------------------------------------------- RSS */

function parseRss(ch: any, base: string): ParsedFeed {
  const siteUrl = home(text(first(ch.link)), base);
  return {
    format: "rss",
    title: unescape(text(ch.title)) || hostName(siteUrl),
    description: clip(unhtml(text(ch.description)), 500),
    siteUrl,
    lang: lang(text(ch.language)),
    image: absolute(text(ch.image?.url) || text(ch["itunes:image"]?.["@href"]), siteUrl) || undefined,
    items: (ch.item ?? []).slice(0, ITEMS_MAX).map((it: any) => rssItem(it, siteUrl)).filter(valid),
  };
}

function rssItem(it: any, base: string): ParsedItem {
  const url = absolute(text(first(it.link)) || guidLink(it.guid), base);
  const html = text(it["content:encoded"]) || text(it.description);
  const excerpt = clip(unhtml(text(it.description) || html), EXCERPT_MAX);
  return {
    guid: text(it.guid) || url || text(it.title),
    url,
    // RSS 2.0 allows an item with no title at all; microblogs do it
    // constantly. The start of its text is the best name it has.
    title: unescape(text(it.title)) || clip(excerpt, 90),
    excerpt,
    content: html || undefined,
    media: media(it, base),
    image: mediaImage(it, base) ?? firstImg(html, base),
    author: unescape(text(it["dc:creator"]) || text(it.author)) || undefined,
    publishedAt: date(text(it.pubDate) || text(it["dc:date"])),
    tags: categories(it.category),
  };
}

function guidLink(guid: any): string {
  const g = text(guid);
  const permalink = typeof guid === "object" ? guid?.["@isPermaLink"] !== "false" : true;
  return permalink && /^https?:\/\//.test(g) ? g : "";
}

/* ---------------------------------------------------------------- RDF */

function parseRdf(rdf: any, base: string): ParsedFeed {
  const ch = rdf.channel ?? {};
  const siteUrl = home(text(first(ch.link)), base);
  return {
    format: "rdf",
    title: unescape(text(ch.title)) || hostName(siteUrl),
    description: clip(unhtml(text(ch.description)), 500),
    siteUrl,
    lang: lang(text(ch["dc:language"])),
    items: (rdf.item ?? []).slice(0, ITEMS_MAX).map((it: any) => {
      const url = absolute(text(first(it.link)) || text(it["@rdf:about"]), siteUrl);
      return {
        guid: text(it["@rdf:about"]) || url,
        url,
        title: unescape(text(it.title)),
        excerpt: clip(unhtml(text(it.description)), EXCERPT_MAX),
        content: text(it["content:encoded"]) || text(it.description) || undefined,
        author: unescape(text(it["dc:creator"])) || undefined,
        publishedAt: date(text(it["dc:date"])),
        tags: categories(it["dc:subject"]),
      };
    }).filter(valid),
  };
}

/* --------------------------------------------------------------- Atom */

function parseAtom(feed: any, base: string): ParsedFeed {
  const siteUrl = home(atomLink(feed.link, "alternate"), base);
  return {
    format: "atom",
    title: unescape(text(feed.title)) || hostName(siteUrl),
    description: clip(unhtml(text(feed.subtitle)), 500),
    siteUrl,
    lang: lang(text(feed["@xml:lang"])),
    image: absolute(text(feed.logo) || text(feed.icon), siteUrl) || undefined,
    items: (feed.entry ?? []).slice(0, ITEMS_MAX).map((e: any) => {
      const url = absolute(atomLink(e.link, "alternate"), siteUrl);
      const html = text(e.content) || text(e.summary);
      return {
        guid: text(e.id) || url,
        url,
        title: unescape(text(e.title)),
        excerpt: clip(unhtml(text(e.summary) || html), EXCERPT_MAX),
        content: html || undefined,
        media: [
          ...media(e, siteUrl),
          ...(e.link ?? [])
            .filter((l: any) => l?.["@rel"] === "enclosure" && /^(audio|video)\//.test(l?.["@type"] ?? ""))
            .map((l: any) => ({ url: absolute(l["@href"], siteUrl), type: l["@type"], length: Number(l["@length"]) || undefined })),
        ].filter((m) => m.url),
        image: mediaImage(e, siteUrl) ?? firstImg(html, siteUrl),
        author: unescape(text(e.author?.name)) || undefined,
        publishedAt: date(text(e.published) || text(e.updated)),
        tags: (e.category ?? []).map((c: any) => text(c?.["@term"] ?? c)).map(topic).filter(Boolean),
      };
    }).filter(valid),
  };
}

function atomLink(links: any[] | undefined, rel: string): string {
  const list = links ?? [];
  const pick =
    list.find((l) => (l?.["@rel"] ?? "alternate") === rel && (!l?.["@type"] || /html/.test(l["@type"]))) ??
    list.find((l) => (l?.["@rel"] ?? "alternate") === rel) ??
    list[0];
  return pick?.["@href"] ?? (typeof pick === "string" ? pick : "");
}

/* ---------------------------------------------------------- JSON Feed */

function parseJson(body: string, base: string): ParsedFeed {
  let f: any;
  try {
    f = JSON.parse(body);
  } catch {
    throw new NotAFeed("JSON does not parse");
  }
  if (!String(f?.version ?? "").includes("jsonfeed.org")) throw new NotAFeed("JSON but not JSON Feed");
  const siteUrl = home(f.home_page_url ?? "", base);
  return {
    format: "json",
    title: unescape(f.title) || hostName(siteUrl),
    description: clip(unescape(f.description), 500),
    siteUrl,
    lang: lang(f.language ?? ""),
    image: absolute(f.icon ?? f.favicon ?? "", siteUrl) || undefined,
    items: (Array.isArray(f.items) ? f.items : []).slice(0, ITEMS_MAX).map((it: any) => {
      const url = absolute(it.url ?? it.external_url ?? "", siteUrl);
      return {
        guid: String(it.id ?? url),
        url,
        title: unescape(it.title ?? ""),
        excerpt: clip(unescape(it.summary ?? it.content_text ?? it.content_html ?? ""), EXCERPT_MAX),
        content: it.content_html ?? (it.content_text ? plainToHtml(String(it.content_text)) : undefined),
        media: (Array.isArray(it.attachments) ? it.attachments : [])
          .filter((a: any) => /^(audio|video)\//.test(a?.mime_type ?? ""))
          .map((a: any) => ({ url: absolute(a.url ?? "", siteUrl), type: a.mime_type, length: Number(a.size_in_bytes) || undefined }))
          .filter((m: Media) => m.url),
        image: absolute(it.image ?? it.banner_image ?? "", siteUrl) || undefined,
        author: unescape(it.authors?.[0]?.name ?? it.author?.name ?? "") || undefined,
        publishedAt: date(it.date_published ?? it.date_modified ?? ""),
        tags: (Array.isArray(it.tags) ? it.tags : []).map(topic).filter(Boolean),
      };
    }).filter(valid),
  };
}

/* ------------------------------------------------------------ helpers */

/** Text content of a parsed node, whatever shape the parser gave it. */
function text(v: any): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return text(v["#text"] ?? "");
  return "";
}

const first = <T,>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);

function categories(v: any): string[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return [...new Set(list.map((c) => topic(text(c))).filter(Boolean))].slice(0, 10);
}

/** A tag worth storing as a topic: `tag()` minus STOP_TAGS. Everything
    that files a feed or a post under a topic goes through this. */
export function topic(s: unknown): string {
  const t = tag(s);
  return STOP_TAGS.has(t) ? "" : t;
}

/** Categories that name the CMS's bookkeeping or the post's format, not
    what it is about. Every blog has "uncategorized"; as a topic it would
    gather the whole catalogue and mean nothing. Only words that are never a
    subject go here — "news", "video" and "podcast" are topics someone
    browses for, and stay. */
export const STOP_TAGS: ReadonlySet<string> = new Set([
  // Defaults a CMS fills in
  "uncategorized", "uncategorised", "general", "misc", "miscellaneous", "other", "others", "various", "random",
  "default", "none", "null", "undefined", "untagged", "na", "n-a", "all",
  // What the post is, not what it is about
  "blog", "blogs", "blog-post", "blog-posts", "post", "posts", "article", "articles", "entry", "entries",
  "link", "links", "resource", "resources", "page", "pages", "archive", "archives",
  "tag", "tags", "category", "categories",
  // Placement on the publisher's own site
  "featured", "feature", "features", "featured-posts", "highlights", "sticky", "homepage", "front-page",
  "frontpage", "main", "top", "top-stories", "latest", "latest-news", "new", "recent", "update", "updates",
  "trending", "popular", "editors-pick", "editors-picks", "recommended",
  // Paid placement
  "sponsored", "sponsor", "ad", "ads", "advert", "advertisement", "promoted", "partner-content",
]);

export type Site = { title: string; host: string };

/** A category that is the site's own name — "daring-fireball" on
    daringfireball.net — says where a post is from, which the page says
    already. As a topic it would only ever hold that one feed. */
export function ownName(t: string, site: Site): boolean {
  const flat = (s: string) => s.replace(/-/g, "");
  const names = [tag(site.title), siteName(site.host)].map(flat).filter(Boolean);
  return names.includes(flat(t));
}

/** The registrable name in a host: "ycombinator" in news.ycombinator.com,
    "example" in blog.example.co.uk. Subdomains are words like "news" and
    "blog", which are topics, not names. */
function siteName(host: string): string {
  const labels = host.toLowerCase().split(".").slice(0, -1);
  if (labels.length > 1 && SECOND_LEVEL.has(labels.at(-1)!)) labels.pop();
  return labels.at(-1) ?? "";
}

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ne", "or"]);

function mediaImage(it: any, base: string): string | undefined {
  const candidates = [
    ...(it["media:thumbnail"] ?? []),
    ...(it["media:content"] ?? []).filter((m: any) => !m?.["@medium"] || m["@medium"] === "image" || /^image\//.test(m?.["@type"] ?? "")),
    ...(it.enclosure ?? []).filter((e: any) => /^image\//.test(e?.["@type"] ?? "")),
  ];
  const url = candidates.map((c: any) => c?.["@url"]).find(Boolean);
  return url ? absolute(url, base) || undefined : undefined;
}

/** Audio and video enclosures, and media:content that is audio or video. */
function media(it: any, base: string): Media[] {
  const list = [
    ...(it.enclosure ?? []).map((e: any) => ({ url: e?.["@url"], type: e?.["@type"] ?? "", length: e?.["@length"] })),
    ...(it["media:content"] ?? [])
      .filter((m: any) => m?.["@medium"] === "audio" || m?.["@medium"] === "video" || /^(audio|video)\//.test(m?.["@type"] ?? ""))
      .map((m: any) => ({ url: m?.["@url"], type: m?.["@type"] ?? `${m["@medium"]}/*`, length: m?.["@fileSize"] })),
  ];
  const seen = new Set<string>();
  return list
    .filter((m) => /^(audio|video)\//.test(m.type) && m.url)
    .map((m) => ({ url: absolute(m.url, base), type: m.type, length: Number(m.length) || undefined }))
    .filter((m) => m.url && !seen.has(m.url) && seen.add(m.url));
}

function plainToHtml(s: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return s.split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
}

function firstImg(html: string, base: string): string | undefined {
  const src = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  return src && !src.startsWith("data:") ? absolute(src, base) || undefined : undefined;
}

function date(s: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s.trim());
  if (Number.isNaN(d.getTime())) return undefined;
  // A date more than a day in the future is a CMS bug, not a scoop.
  return d.getTime() > Date.now() + 86_400_000 ? undefined : d;
}

function lang(s: string): string {
  const m = s.trim().toLowerCase().match(/^[a-z]{2,3}/);
  return m ? m[0] : "";
}

/** The site a feed names as its home, or the feed's own origin when it
    names none — or one that cannot be a site: a publisher's template that
    runs a path into the domain gives "entrepreneur.comrss-feed", and no
    top-level domain has a hyphen in it. */
function home(href: string, base: string): string {
  const url = absolute(href, base);
  try {
    const tld = new URL(url).hostname.split(".").at(-1)!;
    if (/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i.test(tld)) return url;
  } catch {}
  return origin(base);
}

function origin(url: string): string {
  try {
    return new URL(url).origin + "/";
  } catch {
    return "";
  }
}

function hostName(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "Untitled feed";
  }
}

const valid = (it: ParsedItem) => Boolean(it.url && it.title && /^https?:\/\//.test(it.url));

/** The identity an item is stored under: its guid when the feed gives a
    stable one, otherwise the canonical form of its link. */
export const itemKey = (it: ParsedItem): string => (it.guid && it.guid !== it.url ? it.guid : canonical(it.url));
