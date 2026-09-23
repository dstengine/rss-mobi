// POST /api/v1/lookup {urls: ["https://…/feed.xml", …]} — which of these
// feeds the directory has. The reader sends an imported OPML file's
// addresses here; the answer names each one found and lists the rest, so
// they can be offered for submission rather than silently dropped.
import type { APIRoute } from "astro";
import { feeds } from "../../../lib/db.ts";
import { canonical } from "../../../lib/feeds/url.ts";
import { body, error, json, limitIp } from "../../../lib/http.ts";
import { feedJson, type PublicFeed } from "../../../lib/views.ts";

const MAX_URLS = 200;

export const POST: APIRoute = async (ctx) => {
  const limited = await limitIp(ctx, "lookup", 20, "10 m");
  if (limited) return limited;
  const input = await body<{ urls?: unknown }>(ctx, 100_000);
  if (!input || !Array.isArray(input.urls)) return error(400, 'Send {"urls": ["https://…", …]}.');
  const urls = [...new Set(input.urls.filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)).map((u) => u.trim()))].slice(0, MAX_URLS);
  const byCanonical = new Map(urls.map((u) => [canonical(u), u]));
  const rows = await (await feeds())
    .find<PublicFeed & { canonicalUrl: string }>(
      { canonicalUrl: { $in: [...byCanonical.keys()] }, status: "active" },
      { projection: { _id: 0, editHash: 0, submittedIpHash: 0, etag: 0, lastModified: 0, lastError: 0 } },
    )
    .toArray();
  const found = rows.map((f) => ({ url: byCanonical.get(f.canonicalUrl)!, feed: feedJson(f) }));
  const have = new Set(found.map((f) => f.url));
  return json({ found, missing: urls.filter((u) => !have.has(u)) });
};
