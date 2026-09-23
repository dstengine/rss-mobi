// GET  /api/v1/feeds  — the directory, newest first.
//      ?tag=…  ?q=…  ?limit=1..100  ?before=<createdAt of the last one seen>
// POST /api/v1/feeds {url, tags?} — submits a feed. Live when it returns.
import type { APIRoute } from "astro";
import type { Filter } from "mongodb";
import { feeds } from "../../../../lib/db.ts";
import { tag as toTag } from "../../../../lib/feeds/parse.ts";
import { submit, Refused, MAX_TAGS } from "../../../../lib/catalog.ts";
import { apiKey, body, cacheFor, clientIp, error, json, limitIp } from "../../../../lib/http.ts";
import { rateLimit } from "../../../../lib/cache.ts";
import { alert } from "../../../../lib/notify.ts";
import { ipHash } from "../../../../lib/tokens.ts";
import { SITE } from "../../../../lib/env.ts";
import { feedJson, type PublicFeed } from "../../../../lib/views.ts";
import type { FeedDoc } from "../../../../lib/types.ts";

export const GET: APIRoute = async (ctx) => {
  const limited = await limitIp(ctx, "api-read", 120, "1 m");
  if (limited) return limited;
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
  return json({ feeds: rows.map(feedJson), next }, { cache: cacheFor(120) });
};

export const POST: APIRoute = async (ctx) => {
  // A key with write:feeds submits at its own rate; everyone else gets a
  // handful an hour per address, which is plenty for a person and useless
  // to a script.
  const key = await apiKey(ctx);
  if (key && (key.scopes.includes("write:feeds") || key.scopes.includes("admin"))) {
    const r = await rateLimit("key", key.prefix, key.rate, "1 m");
    if (!r.ok) return error(429, "Rate limit for this key reached.");
  } else {
    const limited = await limitIp(ctx, "submit", 5, "1 h");
    if (limited) return limited;
  }

  const input = await body<{ url?: unknown; tags?: unknown }>(ctx, 4_000);
  if (!input || typeof input.url !== "string" || !input.url.trim()) return error(400, 'Send {"url": "https://…", "tags": ["…"]}.');
  const tags = Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === "string").slice(0, MAX_TAGS) : [];

  try {
    const { feed, editToken, added } = await submit(input.url, { tags, ipHash: ipHash(clientIp(ctx)) });
    // No moderation queue, so a person sees every submission as it lands.
    await alert(`new feed: ${feed.title} (${feed.host}, ${added} posts) ${SITE}/feed/${feed.slug}/`);
    return json({ feed: feedJson(feed), added, editUrl: `${ctx.url.origin}/f/${feed.slug}/edit/#${editToken}` }, { status: 201 });
  } catch (e) {
    if (e instanceof Refused) return error(e.status, e.message, e.existing ? { existing: e.existing } : {});
    console.error("submit failed", e);
    return error(500, "Something went wrong saving that feed. Try again.");
  }
};
