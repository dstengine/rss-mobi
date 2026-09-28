// What an admin key can do that no edit link can: take any feed down or
// put it back, and block a host so nothing from it is listed or accepted.
// Spam that gets past the filters comes down in one call; each call is
// announced in Telegram, so a takedown is never silent.
import { blocklist, feeds, items } from "./db.ts";
import { isBlocked } from "./catalog.ts";
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

/** Takes a feed down with its posts, remembering what it was — active, a
    dead feed that was disabled, one its owner had hidden — so putting it
    back restores that, not "active" whatever it was. A second takedown
    keeps the first one's memory. */
async function takeDown(f: FeedDoc, by: "admin" | "blocklist") {
  const prior = f.prior ?? { status: f.status, ...(f.hiddenBy && { hiddenBy: f.hiddenBy }) };
  await (await feeds()).updateOne({ _id: f._id }, { $set: { status: "hidden", hiddenBy: by, prior, updatedAt: new Date() } });
  await (await items()).updateMany({ feedId: f._id }, { $set: { visible: false } });
}

async function putBack(f: FeedDoc) {
  const prior = f.prior ?? { status: "active" as const };
  await (await feeds()).updateOne(
    { _id: f._id },
    { $set: { status: prior.status, updatedAt: new Date(), ...(prior.hiddenBy && { hiddenBy: prior.hiddenBy }) }, $unset: { prior: "", ...(!prior.hiddenBy && { hiddenBy: "" }) } },
  );
  await (await items()).updateMany({ feedId: f._id }, { $set: { visible: prior.status === "active" } });
}

/** Takes one feed down, or undoes an admin's takedown of it. Undoing one
    a block made is refused — lift the block instead — or the directory
    would list a site it refuses submissions from; a feed its owner hid,
    or one nobody took down, is left as it is. */
export async function hideFeed(slug: string, hidden: boolean, who: string, reason = ""): Promise<HideResult> {
  const col = await feeds();
  const feed = await col.findOne({ slug });
  if (!feed) return "missing";
  let changed = false;
  if (hidden && feed.hiddenBy !== "admin") {
    await takeDown(feed, "admin");
    changed = true;
  } else if (!hidden && feed.hiddenBy === "admin") {
    if (await isBlocked(feed.host, hostKey(feed.url))) return "blocked";
    await putBack(feed);
    changed = true;
  } else if (!hidden && feed.hiddenBy === "blocklist") {
    return "blocked";
  }
  if (changed) await alert(`${hidden ? "hid" : "restored"} ${feed.title} (${feed.host}) via key ${who}${reason ? `: ${reason}` : ""}`);
  return { feed: (await col.findOne({ slug }))!, changed };
}

/** Blocks a host and every subdomain of it: new submissions from it are
    refused (catalog.ts isBlocked), and its feeds come down with their
    posts — including one its owner had hidden, which the edit link could
    otherwise bring back past the block. Returns the slugs it took down. */
export async function block(host: string, reason: string, who: string): Promise<string[]> {
  await (await blocklist()).updateOne({ _id: host }, { $set: { reason, by: who }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  const hit = await (await feeds()).find({ ...onHost(host), hiddenBy: { $nin: ["admin", "blocklist"] } }).toArray();
  for (const f of hit) await takeDown(f, "blocklist");
  await alert(`blocked ${host} via key ${who}${reason ? `: ${reason}` : ""}${hit.length ? ` — took down ${hit.map((f) => f.slug).join(", ")}` : ""}`);
  return hit.map((f) => f.slug);
}

/** Lifts a block. The feeds it took down go back to what they were,
    unless another block still covers them; feeds an admin took down by
    hand stay down. Null when the host was not blocked. */
export async function unblock(host: string, who: string): Promise<string[] | null> {
  const { deletedCount } = await (await blocklist()).deleteOne({ _id: host });
  if (!deletedCount) return null;
  const back: string[] = [];
  for (const f of await (await feeds()).find({ ...onHost(host), hiddenBy: "blocklist" }).toArray()) {
    if (await isBlocked(f.host, hostKey(f.url))) continue;
    await putBack(f);
    back.push(f.slug);
  }
  await alert(`unblocked ${host} via key ${who}${back.length ? ` — restored ${back.join(", ")}` : ""}`);
  return back;
}

export async function blocked() {
  return (await blocklist()).find({}).sort({ createdAt: -1 }).toArray();
}
