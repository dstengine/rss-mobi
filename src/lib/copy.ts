// Our copy of a feed — /feed/<slug>/rss.xml — and what makes it as good to
// follow as the original.
//
// We store an excerpt of each post and no more (the free database has room
// for little else, and the text is the publisher's). A reader following
// our copy should still get what the original gives: the whole post, its
// pictures, a podcast's episode, and new posts within minutes rather than
// at our next hourly poll. So each time the CDN asks for the document, the
// original is fetched and read then and there, its posts cleaned and
// passed on, and nothing of it is kept. When the original does not answer
// in time, the stored excerpts go out instead; a copy is never empty
// because somebody else's server is slow.
//
// The owner can keep the copy to excerpts from the feed's edit page.
import { ObjectId } from "mongodb";
import { feeds, items } from "./db.ts";
import { clean } from "./feeds/clean.ts";
import { get } from "./feeds/get.ts";
import { itemKey, ownName, parseFeed, type ParsedItem } from "./feeds/parse.ts";
import type { RssItem } from "./rss.ts";
import type { Copy, FeedDoc } from "./types.ts";

/** The copy's length, as the original's usually is. */
export const COPY_ITEMS = 50;
/** Whole posts past this many characters go out as excerpts: a function
    answer is capped at 4.5 MB, and a reader has no use for more. */
const CONTENT_BUDGET = 2_000_000;
const LIVE_TIMEOUT = 6_000;
/** How long a reader's reported count stands without being reported again. */
const SUBSCRIBERS_FRESH = 7 * 24 * 3600_000;

type Source = Pick<FeedDoc, "slug" | "url" | "title" | "host" | "tags"> & { copy?: Copy; subscribers?: FeedDoc["subscribers"] };

/** A post we keep, with the key it is stored under: the publisher's guid,
    or its address when the guid is only that. Posts are matched by this
    and not by address — a linked-list blog can point two posts at one page,
    parted only by a #fragment. */
export type StoredPost = RssItem & { guid: string; publishedAt: Date };

/** A feed as its copy needs it; null for a slug that is not one. */
export async function copySource(slug: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  return (await feeds()).findOne<Source & Pick<FeedDoc, "status" | "description" | "siteUrl" | "image">>(
    { slug },
    { projection: { _id: 0, slug: 1, url: 1, title: 1, host: 1, tags: 1, copy: 1, subscribers: 1, status: 1, description: 1, siteUrl: 1, image: 1 } },
  );
}

/** The newest posts we keep for a feed. */
export async function storedPosts(slug: string, limit = COPY_ITEMS): Promise<StoredPost[]> {
  return (await items())
    .find<StoredPost>(
      { feedSlug: slug, visible: true },
      { projection: { _id: 0, guid: 1, feedSlug: 1, url: 1, title: 1, excerpt: 1, image: 1, author: 1, tags: 1, publishedAt: 1 } },
    )
    .sort({ publishedAt: -1 })
    .limit(limit)
    .toArray();
}

/** Originals read in the last five minutes, per function instance: a
    reader opening ten posts of one feed costs the publisher one fetch. */
const recent = new Map<string, { at: number; posts: Promise<ParsedItem[] | null> }>();
const RECENT_TTL = 5 * 60_000;
const RECENT_MAX = 50;

/** The original's posts as it serves them now; null when it does not
    answer in time or does not parse. */
export function livePosts(feed: Source): Promise<ParsedItem[] | null> {
  const hit = recent.get(feed.url);
  if (hit && Date.now() - hit.at < RECENT_TTL) return hit.posts;
  const posts = get(feed.url, { timeout: LIVE_TIMEOUT, subscribers: subscriberTotal(feed.subscribers) })
    .then((res) => parseFeed(res.body, res.url).items)
    .catch(() => null);
  recent.delete(feed.url);
  recent.set(feed.url, { at: Date.now(), posts });
  // A Map iterates in insertion order: the first key is the oldest.
  if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value!);
  return posts;
}

/** One post whole, for reading it in the reader: the original's HTML,
    cleaned, and its audio or video. `content` is null when the owner keeps
    the copy to excerpts, the original is out of reach, or the post has
    left its feed — the reader then shows the excerpt and a link. */
export async function postContent(id: string) {
  if (!/^[0-9a-f]{24}$/.test(id)) return null;
  const it = await (await items()).findOne(
    { _id: new ObjectId(id) },
    { projection: { guid: 1, feedSlug: 1, url: 1, visible: 1 } },
  );
  if (!it) return null;
  if (!it.visible) return { gone: true as const };
  const feed = await copySource(it.feedSlug);
  if (!feed || feed.status !== "active" || (feed.copy ?? "full") !== "full") return { content: null, media: [] };
  const post = (await livePosts(feed))?.find((p) => itemKey(p).slice(0, 500) === it.guid);
  return {
    content: post?.content ? clean(post.content, post.url) || null : null,
    media: post?.media ?? [],
  };
}

/** The posts our copy carries: every post the original carries now, whole,
    and the ones it has dropped that we still keep, as excerpts, to make up
    COPY_ITEMS — newest first, each post once. `live` is null when the
    original could not be read. */
export function copyItems(feed: Source, stored: StoredPost[], live: ParsedItem[] | null, now = new Date()): RssItem[] {
  const full = (feed.copy ?? "full") === "full";
  const kept = new Map(stored.map((it) => [it.guid, it]));
  const out: (RssItem & { sortAt: number })[] = [];
  const seen = new Set<string>();
  (live ?? []).forEach((it, i) => {
    // The key catalog.ts stores a post under.
    const key = itemKey(it).slice(0, 500);
    if (!it.url || seen.has(key)) return;
    seen.add(key);
    const mine = kept.get(key);
    const at = it.publishedAt ?? mine?.publishedAt;
    out.push({
      feedSlug: feed.slug,
      url: it.url,
      title: it.title || mine?.title || "",
      excerpt: it.excerpt || mine?.excerpt || "",
      image: it.image ?? mine?.image,
      author: it.author ?? mine?.author,
      tags: mine?.tags ?? [...new Set([...it.tags.filter((t) => !ownName(t, feed)), ...feed.tags])].slice(0, 10),
      publishedAt: at ? new Date(at) : undefined,
      content: full && it.content ? clean(it.content, it.url) : undefined,
      media: full && it.media?.length ? it.media : undefined,
      // An undated post sits where the original put it.
      sortAt: at ? new Date(at).getTime() : now.getTime() - i,
    });
  });
  let room = COPY_ITEMS - out.length;
  for (const { guid, ...it } of stored) {
    if (room <= 0) break;
    if (seen.has(guid)) continue;
    seen.add(guid);
    room--;
    out.push({ ...it, sortAt: new Date(it.publishedAt).getTime() });
  }
  out.sort((a, b) => b.sortAt - a.sortAt);
  let budget = CONTENT_BUDGET;
  return out.map(({ sortAt, ...it }) => {
    if (it.content) {
      budget -= it.content.length;
      if (budget < 0) it.content = undefined;
    }
    return it;
  });
}

/* ----------------------------------------------------------- subscribers */

/** Readers known to count their followers in the user agent, and the name
    each is filed under. Only these are believed: anyone can write "1000
    subscribers" in a header, and a publisher would read our total. */
const READERS: [string, RegExp][] = [
  ["feedly", /feedly/i],
  ["inoreader", /inoreader/i],
  ["feedbin", /feedbin/i],
  ["newsblur", /newsblur/i],
  ["theoldreader", /theoldreader/i],
  ["bazqux", /bazqux/i],
  ["feedspot", /feedspot/i],
  ["feeder", /feeder\.co/i],
];

/** The reader and its follower count, from a request's user agent. */
export function readerCount(ua: string): { reader: string; n: number } | null {
  const n = Number(ua.match(/(\d{1,7})\s+(?:subscribers|readers)\b/i)?.[1]);
  if (!n) return null;
  const reader = READERS.find(([, re]) => re.test(ua))?.[0];
  return reader ? { reader, n } : null;
}

/** Followers across readers that reported within the last week. */
export function subscriberTotal(map: FeedDoc["subscribers"], now = Date.now()): number {
  return Object.values(map ?? {}).reduce((sum, r) => (now - new Date(r.at).getTime() < SUBSCRIBERS_FRESH ? sum + r.n : sum), 0);
}

/** Records what a reader fetching our copy reported — only when it
    changed, or once a day to keep it fresh, so the CDN's few misses do
    not each cost a write. */
export async function noteSubscribers(feed: Pick<FeedDoc, "slug" | "subscribers">, ua: string): Promise<void> {
  const r = readerCount(ua);
  if (!r) return;
  const had = feed.subscribers?.[r.reader];
  if (had && had.n === r.n && Date.now() - new Date(had.at).getTime() < 24 * 3600_000) return;
  await (await feeds()).updateOne({ slug: feed.slug }, { $set: { [`subscribers.${r.reader}`]: { n: r.n, at: new Date() } } });
}
