// A post's picture: the thumbnail beside it in a list, the picture at the
// top of its page and the card a shared link unfolds into.
//
// Feeds name a picture for fewer than half their posts, and many of those
// are http:// — which a page served over https cannot show — or sized for
// a desktop hero. So a background job looks once for each new post: the
// feed's own image, else the article's og:image, twitter:image or
// image_src. It downloads the candidate, makes sure it is an image of a
// usable size, and records where it is and how big (`ItemDoc.picture`).
//
// /item/<id>/image/<name> then serves it resized, from our own address: a
// list makes one connection instead of thirty, a visitor's address is not
// handed to thirty strangers' servers, and a phone downloads a 10 KB
// thumbnail instead of a 2 MB photograph. The CDN keeps each size, so the
// resize runs once per picture and size, not once per visitor.
import { items } from "./db.ts";
import { lock, unlock } from "./cache.ts";
import { get } from "./feeds/get.ts";
import { absolute } from "./feeds/url.ts";
import { attrs, sniff } from "./icon.ts";
import type { ItemDoc } from "./types.ts";

const DAY = 86_400_000;
/** Only posts this recent are looked at: lists show the newest. */
const LOOK_BACK = 7 * DAY;
const WORKERS = 8;
/** The largest original we download. */
const MAX_BYTES = 8_000_000;
/** An article page is read this far; og:image sits in the head. */
const PAGE_BYTES = 1_500_000;
/** Smaller than this is an icon, a tracking pixel or a button. */
const MIN_W = 160;
const MIN_H = 90;
/** Wider or taller than this is a banner or a divider, not a picture. */
const MAX_RATIO = 4;

export type Picture = NonNullable<ItemDoc["picture"]>;

/** The sizes served, by file name. */
export const SIZES = {
  /** Beside a post in a list: 84 CSS pixels square at 2x. */
  "thumb.webp": { width: 168, height: 168, format: "webp", min: 0 },
  /** The top of a post's page. */
  "card.webp": { width: 720, height: 378, format: "webp", min: 360 },
  /** What a shared link unfolds into: Open Graph's 1.91:1 at its size. */
  "og.jpg": { width: 1200, height: 630, format: "jpeg", min: 600 },
} as const;
export type SizeName = keyof typeof SIZES;

export const isSize = (name: string): name is SizeName => Object.hasOwn(SIZES, name);

/** Our address for a post's picture at `size`, or null when it has none —
    or none wide enough for that size, which would only be a blur. */
export function pictureUrl(it: { id: string; picture?: Picture | null }, size: SizeName): string | null {
  if (!it.picture || it.picture.w < SIZES[size].min) return null;
  return `/item/${it.id}/image/${size}`;
}

/** The pictures an article's head names for sharing, best first. */
export function pageCandidates(html: string, page: string): string[] {
  const head = html.slice(0, 300_000).split(/<\/head>/i)[0];
  const found: [number, string][] = [];
  const rank: Record<string, number> = { "og:image:secure_url": 0, "og:image": 1, "og:image:url": 1, "twitter:image": 2, "twitter:image:src": 2 };
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const key = (a.property ?? a.name ?? "").toLowerCase();
    if (key in rank && a.content) found.push([rank[key], a.content]);
  }
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    if ((a.rel ?? "").toLowerCase() === "image_src" && a.href) found.push([3, a.href]);
  }
  const urls = found
    .sort((x, y) => x[0] - y[0])
    .map(([, u]) => absolute(u.trim().replace(/&amp;/g, "&"), page))
    .filter((u): u is string => !!u && /^https?:\/\//i.test(u));
  return [...new Set(urls)].slice(0, 3);
}

/** Whether an image of this size is worth showing. */
export function usable(w: number, h: number): boolean {
  return w >= MIN_W && h >= MIN_H && w / h <= MAX_RATIO && h / w <= MAX_RATIO;
}

/** An original's bytes, if it is a raster image we can resize. SVG is
    left out: a drawing from a stranger is a document that can carry
    script, and an icon file is a favicon, not a post's picture. */
export async function original(url: string, timeout = 6_000): Promise<Uint8Array | null> {
  try {
    const res = await get(url, { binary: true, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8", timeout, maxBytes: MAX_BYTES });
    const type = res.bytes && sniff(res.bytes);
    return type && type !== "image/svg+xml" && type !== "image/x-icon" ? res.bytes! : null;
  } catch {
    return null;
  }
}

const sharp = async () => (await import("sharp")).default;

async function measure(url: string): Promise<Picture | null> {
  const bytes = await original(url);
  if (!bytes) return null;
  try {
    const meta = await (await sharp())(bytes).metadata();
    // An EXIF rotation swaps the sides the viewer sees.
    const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
    return w && h && usable(w, h) ? { url, w, h } : null;
  } catch {
    return null;
  }
}

/** Looks for a post's picture, within `budget` ms. */
export async function findPicture(it: Pick<ItemDoc, "url" | "image">, budget = 15_000): Promise<Picture | null> {
  const start = Date.now();
  if (it.image && /^https?:\/\//i.test(it.image)) {
    const p = await measure(it.image);
    if (p) return p;
  }
  let html = "";
  let base = it.url;
  try {
    const res = await get(it.url, { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", timeout: 5_000, maxBytes: PAGE_BYTES });
    if (!/html|xml/i.test(res.type)) return null;
    html = res.body;
    base = res.url;
  } catch {
    return null;
  }
  for (const url of pageCandidates(html, base)) {
    if (url === it.image || Date.now() - start > budget) continue;
    const p = await measure(url);
    if (p) return p;
  }
  return null;
}

/** Looks for the pictures of recent posts not looked at yet, newest
    first, until `deadline` (ms since epoch). Each post is looked at once:
    finding none is recorded too. */
export async function fillPictures(deadline: number, batch = 150): Promise<{ looked: number; found: number }> {
  const report = { looked: 0, found: 0 };
  if (!(await lock("pictures", 90))) return report;
  try {
    const col = await items();
    const queue = await col
      .find({ pictureAt: null, visible: true, publishedAt: { $gte: new Date(Date.now() - LOOK_BACK) } }, { projection: { url: 1, image: 1 } })
      .sort({ pictureAt: 1, publishedAt: -1 })
      .limit(batch)
      .toArray();
    const worker = async () => {
      for (let it = queue.shift(); it && Date.now() < deadline; it = queue.shift()) {
        const picture = await findPicture(it, Math.max(2_000, deadline - Date.now()));
        const at = new Date();
        report.looked++;
        if (picture) report.found++;
        // A picture changes the post's page, so its date moves; none does not.
        await col.updateOne({ _id: it._id }, { $set: { picture, pictureAt: at, ...(picture ? { updatedAt: at } : {}) } });
      }
    };
    await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, worker));
  } finally {
    await unlock("pictures");
  }
  return report;
}

/** An original resized to `size`. */
export async function render(bytes: Uint8Array, size: SizeName): Promise<{ body: Uint8Array; type: string }> {
  const s = SIZES[size];
  const img = (await sharp())(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: s.width, height: s.height, fit: "cover", position: "attention" });
  const body =
    s.format === "jpeg"
      ? await img.flatten({ background: "#ffffff" }).jpeg({ quality: 80, mozjpeg: true }).toBuffer()
      : await img.webp({ quality: 70, effort: 4 }).toBuffer();
  return { body: new Uint8Array(body), type: s.format === "jpeg" ? "image/jpeg" : "image/webp" };
}
