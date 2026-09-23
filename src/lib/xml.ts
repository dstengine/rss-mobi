// Writing and reading the small XML documents rss.mobi hands out: RSS and
// OPML. Everything that goes into one came from somebody else's feed, so
// it is escaped, and characters XML 1.0 forbids are dropped — one stray
// control character from a publisher's CMS would make the whole document
// unreadable to every reader that fetches it.

const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** Text or an attribute value, safe inside double quotes. */
export const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The five XML entities and numeric references, back to characters. */
export const unesc = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const n = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });

/** The attributes of one start tag, as written: `<outline a="1" b='2'>`. */
export function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = unesc(m[2] ?? m[3] ?? "");
  return out;
}
