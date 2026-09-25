// A feed's picture in lists: its site's icon, served from our own address.
//
// A list reads like an app's when every row has its icon. Few feeds name an
// image of their own, so the icon comes from the site: its
// apple-touch-icon first — square, large, drawn to sit on a home screen —
// then the feed's own image, then the largest icon the page links, then
// /favicon.ico. It is served from /feed/<slug>/icon rather than from the
// site itself: a list page makes one connection instead of fifty, a
// visitor's address is not handed to fifty strangers' servers, and the CDN
// keeps each icon for a week. A site with no usable icon gets its initial
// on a coloured tile.
import { feeds } from "./db.ts";
import { get } from "./feeds/get.ts";
import { absolute } from "./feeds/url.ts";

const DAY = 86_400_000;
/** How long a found icon — or finding none — stands before we look again. */
const RECHECK = 30 * DAY;
const ICON_MAX = 256_000;
/** Looking for an icon stops trying new candidates after this long. */
const BUDGET = 8_000;

export interface Picture {
  bytes: Uint8Array;
  type: string;
}

/** Where a page's icons are, best first. `feedImage` is the feed's own
    image, which ranks below a touch icon: feeds often name a wide banner. */
export function iconCandidates(html: string, page: string, feedImage?: string): string[] {
  const head = html.slice(0, 200_000).split(/<\/head>/i)[0];
  const touch: [number, string][] = [];
  const icons: [number, string][] = [];
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const rel = (a.rel ?? "").toLowerCase().split(/\s+/);
    const href = a.href && absolute(a.href, page);
    if (!href || !/^https?:/.test(href)) continue;
    const size = sizeOf(a.sizes, a.type, href);
    if (rel.some((r) => r.startsWith("apple-touch-icon"))) touch.push([size || 180, href]);
    else if (rel.includes("icon")) icons.push([size, href]);
  }
  const bySize = (list: [number, string][]) => list.sort((x, y) => y[0] - x[0]).map(([, u]) => u);
  let origin = "";
  try {
    origin = new URL(page).origin;
  } catch {}
  const all = [...bySize(touch), feedImage ?? "", ...bySize(icons), origin && `${origin}/favicon.ico`];
  return [...new Set(all.filter((u) => /^https?:\/\//.test(u)))].slice(0, 5);
}

/** A tag's attributes, names lower-cased. */
export function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

/** The largest side an icon link declares; a vector counts as large. */
function sizeOf(sizes = "", type = "", href = ""): number {
  if (/any/i.test(sizes) || /svg/i.test(type) || /\.svg(\?|$)/i.test(href)) return 256;
  return Math.max(0, ...[...sizes.matchAll(/(\d+)x(\d+)/gi)].map((m) => Number(m[1])));
}

/** What an image is, from its first bytes — servers mislabel icons often
    enough that the header is not believed. Null for anything else. */
export function sniff(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  if (b.length < 64) return null;
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0, 0, 1, 0)) return "image/x-icon";
  if (at(4, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66)) return "image/avif";
  const text = new TextDecoder().decode(b.subarray(0, 1024)).trimStart().toLowerCase();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/.test(text)) return "image/svg+xml";
  return null;
}

async function picture(url: string, timeout: number): Promise<Picture | null> {
  try {
    const res = await get(url, { binary: true, accept: "image/*", timeout, maxBytes: ICON_MAX });
    const type = res.bytes && sniff(res.bytes);
    return type ? { bytes: res.bytes!, type } : null;
  } catch {
    return null;
  }
}

type IconFeed = { slug: string; title: string; siteUrl?: string; host: string; image?: string; icon?: string | null; iconAt?: Date; status: string };

/** The icon for a feed page's slug: `picture` null means the site has
    none we can use; null overall means there is no such feed to show. */
export async function feedIcon(slug: string): Promise<{ feed: IconFeed; picture: Picture | null } | null> {
  const col = await feeds();
  const feed = await col.findOne<IconFeed>(
    { slug },
    { projection: { _id: 0, slug: 1, title: 1, siteUrl: 1, host: 1, image: 1, icon: 1, iconAt: 1, status: 1 } },
  );
  if (!feed || feed.status === "hidden") return null;
  const fresh = feed.iconAt && Date.now() - new Date(feed.iconAt).getTime() < RECHECK;
  if (fresh && feed.icon === null) return { feed, picture: null };
  if (fresh && feed.icon) {
    const p = await picture(feed.icon, 5_000);
    if (p) return { feed, picture: p };
  }
  const found = await findIcon(feed);
  await col.updateOne({ slug }, { $set: { icon: found?.url ?? null, iconAt: new Date() } });
  return { feed, picture: found?.picture ?? null };
}

async function findIcon(feed: IconFeed): Promise<{ url: string; picture: Picture } | null> {
  const start = Date.now();
  const page = feed.siteUrl || `https://${feed.host}/`;
  let html = "";
  let base = page;
  try {
    const res = await get(page, { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", timeout: 5_000, maxBytes: 1_000_000 });
    html = res.body;
    base = res.url;
  } catch {}
  for (const url of iconCandidates(html, base, feed.image)) {
    const left = BUDGET - (Date.now() - start);
    if (left < 500) break;
    const p = await picture(url, Math.min(4_000, left));
    if (p) return { url, picture: p };
  }
  return null;
}

/** A site's initial on a tile, the colour fixed by its slug. */
export function monogram(title: string, slug: string): string {
  const letter = (title.match(/[\p{L}\p{N}]/u)?.[0] ?? "#").toUpperCase();
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const esc = letter.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="hsl(${h % 360} 45% 40%)"/>` +
    `<text x="32" y="32" dy=".35em" text-anchor="middle" font-family="-apple-system,system-ui,Segoe UI,Roboto,sans-serif" font-size="32" font-weight="700" fill="#fff">${esc}</text>` +
    `</svg>`
  );
}
