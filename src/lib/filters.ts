// One reading of "which items", shared by the API, every RSS output and
// saved collections — so a filter that works in one works in all of them,
// and a network site reading /rss/?tag=… gets exactly what /api/v1/items
// would have given it.
import type { Filter } from "mongodb";
import { tag as toTag } from "./feeds/parse.ts";
import type { ItemDoc } from "./types.ts";

export const LIMIT_DEFAULT = 30;
export const LIMIT_MAX = 100;

export interface Filters {
  tags: string[];
  lang?: string;
  feeds: string[];
  hosts: string[];
  q?: string;
  exclude: string[];
  since?: Date;
  limit: number;
}

const list = (v: string | null | undefined, max = 20) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);

/** Query-string parameters to Filters. Unknown parameters are ignored, bad
    values are dropped rather than rejected: a feed reader cannot show an
    error message, so the most useful answer to a typo is the unfiltered
    feed. */
export function parseFilters(p: URLSearchParams | Record<string, string | undefined>): Filters {
  const get = (k: string) => (p instanceof URLSearchParams ? p.get(k) : p[k]) ?? null;
  const since = get("since") ? new Date(get("since")!) : undefined;
  const limit = Number(get("limit") ?? LIMIT_DEFAULT);
  const lang = (get("lang") ?? "").toLowerCase().match(/^[a-z]{2,3}$/)?.[0];
  const q = (get("q") ?? "").trim().slice(0, 100) || undefined;
  return {
    tags: list(get("tag") ?? get("tags")).map(toTag).filter(Boolean),
    lang,
    feeds: list(get("feed") ?? get("feeds"), 200).filter((s) => /^[a-z0-9-]{1,80}$/.test(s)),
    hosts: list(get("host") ?? get("hosts")).map((h) => h.toLowerCase().replace(/^www\./, "")).filter((h) => /^[a-z0-9.-]+$/.test(h)),
    q,
    exclude: list(get("exclude")).map((w) => w.toLowerCase()).filter((w) => w.length >= 2).slice(0, 10),
    since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    limit: Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), LIMIT_MAX) : LIMIT_DEFAULT,
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Filters to a MongoDB query over items. Only visible items, always. */
export function toQuery(f: Filters): Filter<ItemDoc> {
  const q: Filter<ItemDoc> = { visible: true };
  if (f.tags.length) q.tags = { $in: f.tags };
  if (f.lang) q.lang = f.lang;
  if (f.feeds.length) q.feedSlug = { $in: f.feeds };
  if (f.hosts.length) q.host = { $in: f.hosts };
  if (f.since) q.publishedAt = { $gte: f.since };
  if (f.q) q.$text = { $search: f.q };
  if (f.exclude.length) q.title = { $not: new RegExp(f.exclude.map(escapeRe).join("|"), "i") };
  return q;
}

/** Filters back to a canonical query string — the cache key, and the URL
    a collection's RSS output advertises. Order is fixed so two spellings
    of the same filter share one cache entry. */
export function toSearch(f: Filters): string {
  const p = new URLSearchParams();
  if (f.tags.length) p.set("tag", [...f.tags].sort().join(","));
  if (f.lang) p.set("lang", f.lang);
  if (f.feeds.length) p.set("feed", [...f.feeds].sort().join(","));
  if (f.hosts.length) p.set("host", [...f.hosts].sort().join(","));
  if (f.q) p.set("q", f.q);
  if (f.exclude.length) p.set("exclude", [...f.exclude].sort().join(","));
  if (f.since) p.set("since", f.since.toISOString());
  if (f.limit !== LIMIT_DEFAULT) p.set("limit", String(f.limit));
  return p.toString();
}

/** Where the next page of items starts: the last item's date and id. The
    date alone is not enough — a feed that gives no dates stores a whole
    batch under one timestamp, and a cursor on the date would skip all but
    the first of them. */
export interface Cursor {
  at: Date;
  id: string;
}

export const cursorOf = (it: { publishedAt: Date | string; id: string }) => `${new Date(it.publishedAt).toISOString()}_${it.id}`;

export function parseCursor(s: string | null | undefined): Cursor | undefined {
  const m = (s ?? "").match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z)_([a-f0-9]{24})$/);
  if (!m) return undefined;
  const at = new Date(m[1]);
  return Number.isNaN(at.getTime()) ? undefined : { at, id: m[2] };
}
