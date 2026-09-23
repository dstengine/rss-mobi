// Sitemap fields, the same way the DST network sets them.
//
// `changefreqFor` and `priorityFor` are copied from tools/sitemap.mjs in
// https://github.com/dstengine/dst with the same thresholds, so every site
// the group runs answers a crawler the same way. The difference is where
// lastmod comes from: there it is git history, here it is each document's
// own updatedAt — a per-page date, never the date of the file it came from.

const DAY = 24 * 60 * 60 * 1000;

export type Changefreq = "daily" | "weekly" | "monthly" | "yearly";

/** How often this page has any business changing, read off its own date. */
export function changefreqFor(depth: number, date?: Date | string | null): Changefreq {
  if (!date) return depth <= 1 ? "weekly" : "monthly";
  const age = Date.now() - new Date(date).getTime();
  if (age <= 7 * DAY) return "daily";
  if (age <= 31 * DAY) return "weekly";
  if (age <= 365 * DAY) return "monthly";
  return "yearly";
}

/** Relative importance within this site: depth is the whole of it. */
export function priorityFor(depth: number): number {
  if (depth === 0) return 1.0;
  if (depth === 1) return 0.8;
  if (depth === 2) return 0.6;
  return 0.4;
}

export interface Entry {
  loc: string;
  lastmod?: Date | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const day = (d: Date) => d.toISOString();

export function depthOf(loc: string): number {
  return new URL(loc).pathname.split("/").filter(Boolean).length;
}

/** A <urlset> with loc, lastmod, changefreq and priority on every entry.
    lastmod is left out only for a page that genuinely has no date — a made
    up one teaches the crawler to ignore the field. */
export function urlset(entries: Entry[]): string {
  const body = entries
    .map((e) => {
      const depth = depthOf(e.loc);
      return [
        "<url>",
        `<loc>${esc(e.loc)}</loc>`,
        e.lastmod ? `<lastmod>${day(e.lastmod)}</lastmod>` : "",
        `<changefreq>${changefreqFor(depth, e.lastmod)}</changefreq>`,
        `<priority>${priorityFor(depth).toFixed(1)}</priority>`,
        "</url>",
      ].join("");
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** The index, each child dated by the newest entry inside it. */
export function sitemapIndex(children: Entry[]): string {
  const body = children
    .map((c) => `<sitemap><loc>${esc(c.loc)}</loc>${c.lastmod ? `<lastmod>${day(c.lastmod)}</lastmod>` : ""}</sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

export const newest = (dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);
