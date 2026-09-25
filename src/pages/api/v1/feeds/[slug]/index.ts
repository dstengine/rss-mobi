// GET /api/v1/feeds/<slug>            — one feed and its latest posts.
// PUT /api/v1/feeds/<slug>  X-Edit-Token — {tags?, hidden?, nofollow?}
import type { APIRoute } from "astro";
import { access, body, error, json, NO_STORE, readCache } from "../../../../../lib/http.ts";
import { hasScope } from "../../../../../lib/keys.ts";
import { feedBySlug, feedItems, feedJson, itemJson } from "../../../../../lib/views.ts";
import { applyEdit, authorise, editable, type EditRequest } from "../../../../../lib/edit.ts";

export const GET: APIRoute = async (ctx) => {
  const who = await access(ctx);
  if (who instanceof Response) return who;
  const slug = String(ctx.params.slug ?? "");
  const feed = /^[a-z0-9-]{1,80}$/.test(slug) ? await feedBySlug(slug) : null;
  if (!feed || feed.status === "hidden") return error(404, "No such feed.");
  const items = await feedItems(slug, 20);
  const full = hasScope(who.key, "read:full");
  return json({ feed: feedJson(feed, full), items: items.map((it) => itemJson(it, full)) }, { cache: readCache(who.key, 300) });
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
