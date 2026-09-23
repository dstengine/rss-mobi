// URL and text helpers shared by ingestion, dedupe and the index checks.
//
// `canonical`, `key` and `unescape` are copied from
// ~/dst/dst_draft/tools/events-scan.mjs, where they have been deduping event
// listings since August 2026. They are copied, not imported: this is a
// separate repository, and a shared package between the two would couple a
// product's deploys to a local tool's refactors.

/** Trailing slashes, tracking parameters, www and http/https are not
    differences between two pages. This is the identity of a URL for dedupe
    and for matching a search result against an original — never the URL we
    link to, which stays exactly as the publisher wrote it. */
export function canonical(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.hash = "";
    u.host = u.host.replace(/^www\./, "");
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|mc_cid|mc_eid)/.test(p)) u.searchParams.delete(p);
    }
    u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return url;
  }
}

/** A title reduced to what two sources reporting the same story share:
    lower case, no accents, no punctuation. */
export const key = (s: string): string =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const NAMED: Record<string, string> = {
  ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  hellip: "…", middot: "·", eacute: "é", aacute: "á", oacute: "ó", iacute: "í",
  uacute: "ú", ntilde: "ñ", laquo: "«", raquo: "»", copy: "©", reg: "®",
  trade: "™", euro: "€", pound: "£",
};

/** Feed text to plain text: CDATA unwrapped, tags dropped, entities decoded,
    whitespace collapsed. Feeds put HTML in titles more often than they should,
    and a reader must never see it as markup. */
export const unescape = (s: unknown): string =>
  String(s ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// fromCharCode in the original broke astral characters (emoji) in half.
function safeChar(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** A string cut to `max` characters at a word boundary, with an ellipsis
    when anything was cut. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "") + "…";
}

/** `href` resolved against `base`; empty when it cannot be. */
export function absolute(href: string, base: string): string {
  // An empty href resolves to the base itself, which would hand an item
  // with no link the address of the whole feed.
  if (!href?.trim()) return "";
  try {
    return new URL(href.trim(), base).toString();
  } catch {
    return "";
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

const SLUG_MAX = 50;

/** A URL-safe slug; `fallback` when the text has no latin letters left.
    A long title keeps its name and drops its tagline ("Smashing Magazine —
    For Web Designers…" is `smashing-magazine`), and a cut falls between
    words, never inside one. */
export function slugify(s: string, fallback = "feed"): string {
  const name = s.split(/\s+[—–|·:-]\s+|:\s+/)[0];
  const words = key((name.length >= 3 ? name : s).replace(/['’]/g, "")).split(/\s+/).filter(Boolean);
  let out = "";
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > SLUG_MAX) break;
    out = next;
  }
  return out || words[0]?.slice(0, SLUG_MAX) || fallback;
}
