// What an admin key can do that no edit link can: take any feed down or
// put it back, and block a host so nothing from it is listed or accepted.
// Spam that gets past the filters comes down in one call; each call is
// announced in Telegram, so a takedown is never silent.
import { blocklist, feeds } from "./db.ts";
import { setStatus } from "./catalog.ts";
import { alert } from "./notify.ts";
import type { FeedDoc } from "./types.ts";

/** A host as the blocklist keys it: lower case, without www, without a
    scheme or path if an address was given. Empty when it is not one. */
export function hostKey(input: string): string {
  let h = input.trim().toLowerCase();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(h)) h = new URL(h).hostname;
  } catch {
    return "";
  }
  h = h.replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  return /^(?=.{3,253}$)([a-z0-9-]{1,63}\.)+[a-z0-9-]{2,63}$/.test(h) ? h : "";
}

/** Feeds whose site or feed address is on `host` or under it. */
const onHost = (host: string) => {
  const esc = host.replace(/\./g, "\\.");
  return { $or: [{ host: { $regex: `(^|\\.)${esc}$` } }, { url: { $regex: `^https?://([^/?#]*\\.)?${esc}(:\\d+)?([/?#]|$)`, $options: "i" } }] };
};

export type HideResult = { feed: FeedDoc; changed: boolean } | "missing" | "blocked";

/** Hides or restores one feed. Restoring a feed whose host is blocked is
    refused — lift the block instead — or the directory would list a site
    it refuses submissions from. */
export async function hideFeed(slug: string, hidden: boolean, who: string, reason = ""): Promise<HideResult> {
  const col = await feeds();
  const feed = await col.findOne({ slug });
  if (!feed) return "missing";
  if (!hidden && (await blockedFor(feed))) return "blocked";
  const target = hidden ? "hidden" : "active";
  const changed = feed.status !== target || (hidden && feed.hiddenBy !== "admin");
  if (changed) {
    await setStatus(slug, target, "admin");
    await alert(`${hidden ? "hid" : "restored"} ${feed.title} (${feed.host}) via key ${who}${reason ? `: ${reason}` : ""}`);
  }
  return { feed: (await col.findOne({ slug }))!, changed };
}

/** The blocklist entry that covers a feed, if one does. */
async function blockedFor(feed: Pick<FeedDoc, "host" | "url">): Promise<string | null> {
  const hosts = [feed.host, hostKey(feed.url)].filter(Boolean);
  const ids = hosts.flatMap((h) => {
    const parts = h.split(".");
    return parts.slice(0, -1).map((_, i) => parts.slice(i).join("."));
  });
  const hit = await (await blocklist()).findOne({ _id: { $in: ids } });
  return hit?._id ?? null;
}

/** Blocks a host and every subdomain of it: new submissions from it are
    refused (catalog.ts isBlocked), and its listed feeds come down with
    their posts. Returns the slugs it took down. */
export async function block(host: string, reason: string, who: string): Promise<string[]> {
  await (await blocklist()).updateOne({ _id: host }, { $set: { reason, by: who }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  const hit = await (await feeds()).find({ ...onHost(host), status: { $ne: "hidden" } }, { projection: { slug: 1 } }).toArray();
  for (const f of hit) await setStatus(f.slug, "hidden", "blocklist");
  await alert(`blocked ${host} via key ${who}${reason ? `: ${reason}` : ""}${hit.length ? ` — took down ${hit.map((f) => f.slug).join(", ")}` : ""}`);
  return hit.map((f) => f.slug);
}

/** Lifts a block. The feeds the block took down come back, unless another
    block still covers them; feeds taken down by hand stay down. Null when
    the host was not blocked. */
export async function unblock(host: string, who: string): Promise<string[] | null> {
  const { deletedCount } = await (await blocklist()).deleteOne({ _id: host });
  if (!deletedCount) return null;
  const back: string[] = [];
  for (const f of await (await feeds()).find({ ...onHost(host), status: "hidden", hiddenBy: "blocklist" }, { projection: { slug: 1, host: 1, url: 1 } }).toArray()) {
    if (await blockedFor(f)) continue;
    await setStatus(f.slug, "active");
    back.push(f.slug);
  }
  await alert(`unblocked ${host} via key ${who}${back.length ? ` — restored ${back.join(", ")}` : ""}`);
  return back;
}

export async function blocked() {
  return (await blocklist()).find({}).sort({ createdAt: -1 }).toArray();
}
