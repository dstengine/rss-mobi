// Every decision about indexing and links, in one place.
//
// Templates never decide whether a page is indexable or how a link is
// marked: they ask `policy()`. That keeps the rules testable and keeps one
// promise that matters more than any of them — the answer depends on the
// page, never on who is asking. There is no user-agent argument, and there
// must never be one: showing crawlers something other than readers is
// cloaking, and the test suite renders every page type as both to prove it.
import type { FeedDoc, ItemDoc, LinkMode, Robots } from "./types.ts";

export const FEED_MIN_ITEMS = 3;
export const FEED_MIN_FETCHES = 3;
export const TAG_MIN_FEEDS = 5;
export const TAG_MIN_HOSTS = 3;

export interface Decision {
  robots: Robots;
  /** In the sitemap: exactly the indexable pages, nothing else. */
  sitemap: boolean;
}

export interface LinkDecision {
  mode: LinkMode;
  /** The rel attribute, or null for a plain followed link. */
  rel: string | null;
}

const INDEX: Decision = { robots: "index,follow", sitemap: true };
const NOINDEX: Decision = { robots: "noindex,follow", sitemap: false };

type FeedFacts = Pick<FeedDoc, "status" | "itemCount" | "okCount" | "robots">;
type ItemFacts = Pick<ItemDoc, "indexStatus" | "visible" | "robots">;

export type Page =
  | { type: "home" | "static" | "tags" }
  | { type: "feed"; feed: FeedFacts }
  | { type: "item"; item: ItemFacts; feed: Pick<FeedDoc, "status"> }
  | { type: "tag"; feeds: number; hosts: number }
  | { type: "collection" | "edit" | "search" };

export function policy(page: Page): Decision {
  switch (page.type) {
    case "home":
    case "static":
    case "tags":
      return INDEX;

    case "feed": {
      const f = page.feed;
      if (f.status !== "active") return NOINDEX;
      if (f.robots) return f.robots === "index,follow" ? INDEX : NOINDEX;
      // A feed page is thin until it has something on it, and a feed that
      // has only ever been fetched once may not be a feed next week.
      return f.itemCount >= FEED_MIN_ITEMS && f.okCount >= FEED_MIN_FETCHES ? INDEX : NOINDEX;
    }

    case "item": {
      const { item, feed } = page;
      if (feed.status !== "active" || !item.visible) return NOINDEX;
      if (item.robots) return item.robots === "index,follow" ? INDEX : NOINDEX;
      // The rule the product is built on: when the original is not in
      // Google's index, our page is open to it; once the original is in,
      // ours steps aside. Every other status — not checked yet, check in
      // flight, check failed — keeps ours out until we know.
      return item.indexStatus === "not_indexed" ? INDEX : NOINDEX;
    }

    case "tag":
      return page.feeds >= TAG_MIN_FEEDS && page.hosts >= TAG_MIN_HOSTS ? INDEX : NOINDEX;

    case "collection":
    case "edit":
    case "search":
      return NOINDEX;
  }
}

/** How a link from our page to an original is marked. */
export function linkTo(item: Pick<ItemDoc, "indexStatus" | "linkMode">, feed?: Pick<FeedDoc, "linkMode">): LinkDecision {
  const mode: LinkMode =
    item.linkMode ??
    feed?.linkMode ??
    // An original we are standing in for gets a plain, followed link: the
    // point of opening our page is to lead the crawler to it. Everything
    // else is user-submitted content and says so.
    (item.indexStatus === "not_indexed" ? "direct" : "ugc");
  return { mode, rel: relFor(mode) };
}

export function relFor(mode: LinkMode): string | null {
  switch (mode) {
    case "direct":
      return null;
    case "ugc":
      return "ugc";
    case "nofollow":
    case "hop":
      return "ugc nofollow";
    case "none":
      return null;
  }
}
