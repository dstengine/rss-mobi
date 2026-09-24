// Changes made with a feed's edit token. The token arrives in the
// X-Edit-Token header, sent by the edit page's script after it reads the
// token from the URL fragment — so it never appears in a request line, a
// server log or a Referer.
import type { APIContext } from "astro";
import { feeds, items } from "./db.ts";
import { MAX_TAGS, setStatus } from "./catalog.ts";
import { topic } from "./feeds/parse.ts";
import { error, limitIp } from "./http.ts";
import { matches } from "./tokens.ts";
import type { Copy, FeedDoc } from "./types.ts";

export type Editable = Pick<FeedDoc, "slug" | "title" | "url" | "tags" | "status" | "linkMode"> & { copy: Copy };

/** The feed this request may edit, or the Response refusing it. */
export async function authorise(ctx: APIContext): Promise<FeedDoc | Response> {
  // Tokens are 192 random bits; the limit is here so nobody finds that out
  // the slow way at our expense.
  const limited = await limitIp(ctx, "edit", 30, "10 m");
  if (limited) return limited;
  const slug = String(ctx.params.slug ?? "");
  const feed = /^[a-z0-9-]{1,80}$/.test(slug) ? await (await feeds()).findOne({ slug }) : null;
  if (!feed) return error(404, "No such feed.");
  if (!matches(ctx.request.headers.get("x-edit-token"), feed.editHash)) return error(403, "That edit link is not valid for this feed.");
  return feed;
}

export const editable = (f: FeedDoc): Editable => ({
  slug: f.slug,
  title: f.title,
  url: f.url,
  tags: f.tags,
  status: f.status,
  linkMode: f.linkMode,
  copy: f.copy ?? "full",
});

export interface EditRequest {
  tags?: unknown;
  hidden?: unknown;
  nofollow?: unknown;
  /** True keeps our copy of the feed to excerpts. */
  excerpts?: unknown;
}

/** Applies what the owner may change: topics, whether the feed is listed,
    whether our copy of it carries whole posts, and whether our links to
    it are followed. Owners can ask for less
    link weight, never more — `direct` stays a decision of the rules. */
export async function applyEdit(feed: FeedDoc, req: EditRequest): Promise<FeedDoc | Response> {
  const set: Partial<FeedDoc> = {};
  if (req.tags !== undefined) {
    if (!Array.isArray(req.tags)) return error(400, "tags must be a list of strings.");
    const tags = [...new Set(req.tags.filter((t): t is string => typeof t === "string").map(topic).filter(Boolean))].slice(0, MAX_TAGS);
    if (tags.join() !== feed.tags.join()) set.tags = tags;
  }
  if (req.nofollow !== undefined) {
    const linkMode = req.nofollow === true ? "nofollow" : null;
    if (linkMode !== feed.linkMode) set.linkMode = linkMode;
  }
  if (req.excerpts !== undefined) {
    const copy: Copy = req.excerpts === true ? "excerpt" : "full";
    if (copy !== (feed.copy ?? "full")) set.copy = copy;
  }
  const col = await feeds();
  if (Object.keys(set).length) {
    await col.updateOne({ _id: feed._id }, { $set: { ...set, updatedAt: new Date() } });
    if (set.tags) {
      // Items carry the feed's tags so filters need no join; move them too.
      await (await items()).updateMany({ feedId: feed._id }, [{ $set: { tags: { $slice: [{ $setUnion: [{ $setDifference: ["$tags", feed.tags] }, set.tags] }, 10] } } }]);
    }
    if ("linkMode" in set) {
      // And the owner's link choice, which lists of many feeds, the reader
      // and the API read off the item alone.
      await (await items()).updateMany({ feedId: feed._id }, { $set: { linkMode: set.linkMode ?? null } });
    }
  }
  if (typeof req.hidden === "boolean" && feed.status !== "disabled") {
    const status = req.hidden ? "hidden" : "active";
    if (status !== feed.status) await setStatus(feed.slug, status);
  }
  return (await col.findOne({ _id: feed._id }))!;
}
