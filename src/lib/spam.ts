// The automatic checks that stand in for moderation.
//
// Nobody reviews a submission before it goes live, and .mobi is the zone
// Spamhaus named the most abused in 2025 — so the catalogue is exactly
// where casino and pharma spam would try to land. These checks refuse the
// obvious cases at the door. Everything that gets through still starts out
// noindex (see policy.ts), so a miss here costs a page nobody can find, not
// the domain's standing.
import type { ParsedFeed } from "./feeds/parse.ts";

const PATTERNS: RegExp[] = [
  /\b(casino|slots?|jackpot|roulette|poker\s?online|sportsbook|betting|bet\d+|1xbet|mostbet|pin-?up)\b/i,
  /\b(viagra|cialis|levitra|kamagra|tramadol|xanax|oxycodone|pharmacy\s?online|no\s?prescription)\b/i,
  /\b(porn|xxx|nsfw|escort|onlyfans|camgirl|sex\s?cam|nude)\b/i,
  /\b(payday\s?loans?|crypto\s?signals?|forex\s?signals?|binary\s?options|guaranteed\s?profit)\b/i,
  /\b(buy\s?(followers|likes|backlinks)|seo\s?backlinks|link\s?building\s?service)\b/i,
];

/** Share of item titles that may match before the feed is refused. One
    news story about a casino is journalism; a feed that is mostly casino is
    a casino. */
const ITEM_SHARE = 0.3;

export function spamReason(feed: Pick<ParsedFeed, "title" | "description" | "items">, host: string): string | null {
  const head = `${feed.title} ${feed.description} ${host}`;
  if (PATTERNS.some((p) => p.test(head))) return "The feed's title or description looks like spam.";
  const titles = feed.items.slice(0, 30).map((i) => i.title);
  if (titles.length) {
    const hits = titles.filter((t) => PATTERNS.some((p) => p.test(t))).length;
    if (hits / titles.length > ITEM_SHARE) return "Too many of the feed's items look like spam.";
  }
  return null;
}
