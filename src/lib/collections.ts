// Collections: a reader's own mix of feeds and filters, saved under a short
// public id and published as a page, an RSS feed and an OPML file. There
// are no accounts; whoever holds the edit link may change it, the same
// arrangement as a submitted feed's.
import type { APIContext } from "astro";
import { collections, feeds } from "./db.ts";
import { parseFilters, type Cursor, type Filters } from "./filters.ts";
import { error, limitIp } from "./http.ts";
import { looksLikeSpam } from "./spam.ts";
import { matches, newToken, sha256, shortId } from "./tokens.ts";
import { itemsFor, type PublicItem } from "./views.ts";
import type { CollectionDoc, SavedFilters } from "./types.ts";

export const MAX_FEEDS = 200;
export const MAX_TITLE = 100;
const ID = /^[a-z0-9x]{8}$/;

export type PublicCollection = Pick<CollectionDoc, "id" | "title" | "feeds" | "filters" | "createdAt" | "updatedAt">;
const FIELDS = { _id: 0, id: 1, title: 1, feeds: 1, filters: 1, createdAt: 1, updatedAt: 1 } as const;

export interface CollectionInput {
  title?: unknown;
  feeds?: unknown;
  filters?: unknown;
}

export interface Normalised {
  title: string;
  feeds: string[];
  filters: SavedFilters;
}

const words = (v: unknown): string | undefined =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").join(",") : typeof v === "string" ? v : undefined;

/** What a create or an edit may store, or the reason it may not. Filters
    go through the same `parseFilters` as every query string, so a saved
    collection means exactly what the same filters in a URL would. */
export function normalise(input: CollectionInput): Normalised | string {
  const title = typeof input.title === "string" ? input.title.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (!title) return "Give the collection a title.";
  if (title.length > MAX_TITLE) return `Keep the title under ${MAX_TITLE} characters.`;
  if (looksLikeSpam(title)) return "That title looks like spam.";

  if (input.feeds !== undefined && !Array.isArray(input.feeds)) return "feeds must be a list of feed slugs.";
  const slugs = ((input.feeds as unknown[] | undefined) ?? []).filter((s): s is string => typeof s === "string" && /^[a-z0-9-]{1,80}$/.test(s));
  const unique = [...new Set(slugs)];
  if (unique.length > MAX_FEEDS) return `A collection holds up to ${MAX_FEEDS} feeds.`;

  const raw = input.filters && typeof input.filters === "object" ? (input.filters as Record<string, unknown>) : {};
  const f = parseFilters({
    tag: words(raw.tags ?? raw.tag),
    lang: typeof raw.lang === "string" ? raw.lang : undefined,
    host: words(raw.hosts ?? raw.host),
    q: typeof raw.q === "string" ? raw.q : undefined,
    exclude: words(raw.exclude),
  });
  const filters: SavedFilters = { tags: f.tags, hosts: f.hosts, exclude: f.exclude };
  if (f.lang) filters.lang = f.lang;
  if (f.q) filters.q = f.q;

  // A collection with neither feeds nor a narrowing filter would be the
  // whole catalogue under someone's title.
  if (!unique.length && !filters.tags.length && !filters.hosts.length && !filters.q) return "Add at least one feed, topic, site or search word.";
  return { title, feeds: unique, filters };
}

/** The slugs among `slugs` that name a feed we have, in the order given. */
async function known(slugs: string[]): Promise<string[]> {
  if (!slugs.length) return [];
  const rows = await (await feeds()).find({ slug: { $in: slugs }, status: { $ne: "disabled" } }, { projection: { _id: 0, slug: 1 } }).toArray();
  const have = new Set(rows.map((r) => r.slug));
  return slugs.filter((s) => have.has(s));
}

async function resolve(input: CollectionInput): Promise<Normalised | string> {
  const n = normalise(input);
  if (typeof n === "string") return n;
  const feedsKept = await known(n.feeds);
  if (n.feeds.length && !feedsKept.length && !n.filters.tags.length && !n.filters.hosts.length && !n.filters.q) return "None of those feeds are in the directory.";
  return { ...n, feeds: feedsKept };
}

export async function create(input: CollectionInput, ipHash?: string): Promise<{ collection: PublicCollection; editToken: string } | string> {
  const n = await resolve(input);
  if (typeof n === "string") return n;
  const editToken = newToken();
  const now = new Date();
  const col = await collections();
  // 48 random bits; a clash is unlikely, and a retry costs one round trip.
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = { id: shortId(), editHash: sha256(editToken), ...n, createdIpHash: ipHash, createdAt: now, updatedAt: now };
    try {
      await col.insertOne(doc as CollectionDoc);
      const { editHash: _h, createdIpHash: _ip, ...pub } = doc;
      return { collection: pub, editToken };
    } catch (e: any) {
      if (e?.code !== 11000) throw e;
    }
  }
  throw new Error("could not allocate a collection id");
}

export async function update(doc: CollectionDoc, input: CollectionInput): Promise<PublicCollection | string> {
  const n = await resolve(input);
  if (typeof n === "string") return n;
  const col = await collections();
  await col.updateOne({ _id: doc._id }, { $set: { ...n, updatedAt: new Date() } });
  return (await col.findOne<PublicCollection>({ _id: doc._id }, { projection: FIELDS }))!;
}

export async function byId(id: string): Promise<PublicCollection | null> {
  if (!ID.test(id)) return null;
  return (await collections()).findOne<PublicCollection>({ id }, { projection: FIELDS });
}

/** A collection's posts: from its feeds, when it names any, and matching
    every filter it keeps. */
export function collectionFilters(c: Pick<PublicCollection, "feeds" | "filters">, limit: number): Filters {
  return { tags: [], hosts: [], exclude: [], ...c.filters, feeds: c.feeds, limit };
}

export function collectionItems(c: PublicCollection, limit = 30, after?: Cursor): Promise<PublicItem[]> {
  return itemsFor(collectionFilters(c, limit), after);
}

/** The collection this request may edit, or the Response refusing it. */
export async function authorise(ctx: APIContext): Promise<CollectionDoc | Response> {
  const limited = await limitIp(ctx, "edit", 30, "10 m");
  if (limited) return limited;
  const id = String(ctx.params.id ?? "");
  const doc = ID.test(id) ? await (await collections()).findOne({ id }) : null;
  if (!doc) return error(404, "No such collection.");
  if (!matches(ctx.request.headers.get("x-edit-token"), doc.editHash)) return error(403, "That edit link is not valid for this collection.");
  return doc;
}

export const publicOf = ({ id, title, feeds, filters, createdAt, updatedAt }: PublicCollection): PublicCollection => ({ id, title, feeds, filters, createdAt, updatedAt });

export function collectionJson(c: PublicCollection, origin = "https://rss.mobi") {
  return {
    id: c.id,
    title: c.title,
    feeds: c.feeds,
    filters: c.filters,
    page: `${origin}/c/${c.id}/`,
    rss: `${origin}/c/${c.id}/rss.xml`,
    opml: `${origin}/c/${c.id}/opml.xml`,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
