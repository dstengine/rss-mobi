// GET  /api/v1/feeds  — the directory, newest first.
//      ?tag=…  ?q=…  ?limit=1..100  ?before=<createdAt of the last one seen>
// POST /api/v1/feeds {url, tags?} — submits a feed. Live when it returns.
// POST /api/v1/feeds {feeds: [{url, tags?, title?}, …]} — up to 20 at once,
//      for a key with write:feeds; one result per feed, in order.
import type { APIRoute } from "astro";
import type { Filter } from "mongodb";
import { feeds } from "../../../../lib/db.ts";
import { tag as toTag } from "../../../../lib/feeds/url.ts";
import { submit, Refused, MAX_TAGS } from "../../../../lib/catalog.ts";
import { access, body, clientIp, error, json, limitIp, readCache } from "../../../../lib/http.ts";
import { hasScope } from "../../../../lib/keys.ts";
import { alert } from "../../../../lib/notify.ts";
import { ipHash } from "../../../../lib/tokens.ts";
import { SITE } from "../../../../lib/env.ts";
import { feedJson, type PublicFeed } from "../../../../lib/views.ts";
import { counted } from "../../../../lib/words.ts";
import type { FeedDoc } from "../../../../lib/types.ts";

/** Feeds one batch may carry, how many are read at once, and when it stops
    starting new ones: each is fetched while the caller waits, and the
    function has a minute. */
export const BATCH_MAX = 20;
const BATCH_LANES = 4;
const BATCH_BUDGET_MS = 35_000;

export const GET: APIRoute = async (ctx) => {
  const who = await access(ctx);
  if (who instanceof Response) return who;
  const p = ctx.url.searchParams;
  const limit = Math.min(Math.max(Math.trunc(Number(p.get("limit") ?? 30)) || 30, 1), 100);
  const q: Filter<FeedDoc> = { status: "active", itemCount: { $gt: 0 } };
  const t = toTag(p.get("tag") ?? "");
  if (t) q.tags = t;
  const search = (p.get("q") ?? "").trim().slice(0, 100);
  if (search) q.$text = { $search: search };
  const before = p.get("before") ? new Date(p.get("before")!) : null;
  if (before && !Number.isNaN(before.getTime())) q.createdAt = { $lt: before };

  const rows = await (await feeds())
    .find<PublicFeed>(q, { projection: { _id: 0, editHash: 0, submittedIpHash: 0, etag: 0, lastModified: 0, lastError: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  const last = rows.at(-1);
  const next = rows.length === limit && last ? `${ctx.url.pathname}?${new URLSearchParams({ ...Object.fromEntries(p), before: new Date(last.createdAt).toISOString() })}` : null;
  const full = hasScope(who.key, "read:full");
  return json({ feeds: rows.map((f) => feedJson(f, full)), next }, { cache: readCache(who.key, 120) });
};

type Entry = { url?: unknown; tags?: unknown; title?: unknown };

const tagsOf = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string").slice(0, MAX_TAGS) : []);

export const POST: APIRoute = async (ctx) => {
  // A key with write:feeds submits at its own rate; everyone else gets a
  // handful an hour per address, which is plenty for a person and useless
  // to a script.
  const who = await access(ctx, { bucket: "submit", max: 5, window: "1 h" });
  if (who instanceof Response) return who;
  const writer = hasScope(who.key, "write:feeds");
  if (who.key && !writer) {
    // A key without write:feeds submits as anyone does.
    const limited = await limitIp(ctx, "submit", 5, "1 h");
    if (limited) return limited;
  }

  const input = await body<Entry & { feeds?: unknown }>(ctx, 40_000);
  if (input && Array.isArray(input.feeds)) {
    if (!writer) return error(who.key ? 403 : 401, "Submitting several feeds at once needs an API key with write:feeds.");
    return batch(ctx, input.feeds as Entry[], who.key!.name);
  }
  if (!input || typeof input.url !== "string" || !input.url.trim()) return error(400, 'Send {"url": "https://…", "tags": ["…"]}.');

  try {
    const { feed, editToken, added } = await submit(input.url, {
      tags: tagsOf(input.tags),
      ipHash: ipHash(clientIp(ctx)),
      ...(writer && typeof input.title === "string" && { title: input.title }),
    });
    // No moderation queue, so a person sees every submission as it lands.
    await alert(`new feed: ${feed.title} (${feed.host}, ${added} posts)${who.key ? ` via key ${who.key.name}` : ""} ${SITE}/feed/${feed.slug}/`);
    return json({ feed: feedJson(feed), added, editUrl: `${ctx.url.origin}/f/${feed.slug}/edit/#${editToken}` }, { status: 201 });
  } catch (e) {
    if (e instanceof Refused) return error(e.status, e.message, e.existing ? { existing: e.existing } : {});
    console.error("submit failed", e);
    return error(500, "Something went wrong saving that feed. Try again.");
  }
};

/** Several feeds from one key: each goes through submit() exactly as a
    single one would, four at a time. What the time budget leaves unstarted
    comes back as 503, to send again. */
async function batch(ctx: Parameters<APIRoute>[0], list: Entry[], keyName: string): Promise<Response> {
  if (!list.length || list.length > BATCH_MAX) return error(400, `Send between 1 and ${BATCH_MAX} feeds: {"feeds": [{"url": "https://…"}]}.`);
  const stopAt = Date.now() + BATCH_BUDGET_MS;
  const ip = ipHash(clientIp(ctx));
  const results: Record<string, unknown>[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const e = list[i] ?? {};
      const url = typeof e.url === "string" ? e.url.trim() : "";
      if (!url) {
        results[i] = { url: null, status: 400, error: "No url." };
        continue;
      }
      if (Date.now() > stopAt) {
        results[i] = { url, status: 503, error: "Not tried: the call ran out of time. Send it again." };
        continue;
      }
      try {
        const { feed, editToken, added } = await submit(url, { tags: tagsOf(e.tags), ipHash: ip, ...(typeof e.title === "string" && { title: e.title }) });
        results[i] = { url, status: 201, feed: feedJson(feed), added, editUrl: `${ctx.url.origin}/f/${feed.slug}/edit/#${editToken}` };
      } catch (err) {
        if (err instanceof Refused) results[i] = { url, status: err.status, error: err.message, ...(err.existing && { existing: err.existing }) };
        else {
          console.error("batch submit failed", url, err);
          results[i] = { url, status: 500, error: "Something went wrong saving that feed." };
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_LANES, list.length) }, worker));
  const made = results.filter((r) => r.status === 201);
  if (made.length) {
    const names = made.map((r) => (r.feed as { title: string }).title).join(", ");
    await alert(`${counted(made.length, "new feed")} via key ${keyName}: ${names}`.slice(0, 1_000));
  }
  return json({ results });
}
