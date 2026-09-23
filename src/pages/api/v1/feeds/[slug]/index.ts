// GET /api/v1/feeds/<slug>            — one feed and its latest posts.
// PUT /api/v1/feeds/<slug>  X-Edit-Token — {tags?, hidden?, nofollow?}
import type { APIRoute } from "astro";
import { cacheFor, body, error, json, limitIp, NO_STORE } from "../../../../../lib/http.ts";
import { feedBySlug, feedItems, feedJson, itemJson } from "../../../../../lib/views.ts";
import { applyEdit, authorise, editable, type EditRequest } from "../../../../../lib/edit.ts";

export const GET: APIRoute = async (ctx) => {
  const limited = await limitIp(ctx, "api-read", 120, "1 m");
  if (limited) return limited;
  const slug = String(ctx.params.slug ?? "");
  const feed = /^[a-z0-9-]{1,80}$/.test(slug) ? await feedBySlug(slug) : null;
  if (!feed || feed.status === "hidden") return error(404, "No such feed.");
  const items = await feedItems(slug, 20);
  return json({ feed: feedJson(feed), items: items.map(itemJson) }, { cache: cacheFor(300) });
};

export const PUT: APIRoute = async (ctx) => {
  const feed = await authorise(ctx);
  if (feed instanceof Response) return feed;
  const req = await body<EditRequest>(ctx, 4_000);
  if (!req) return error(400, "Send a JSON object.");
  const updated = await applyEdit(feed, req);
  if (updated instanceof Response) return updated;
  return json({ feed: editable(updated) }, { cache: NO_STORE });
};
