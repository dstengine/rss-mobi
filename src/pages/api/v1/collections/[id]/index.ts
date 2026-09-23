// GET /api/v1/collections/<id>             — a collection, its feeds and posts.
//     ?before=<cursor> pages through the posts.
// PUT /api/v1/collections/<id>  X-Edit-Token — {title, feeds, filters}
import type { APIRoute } from "astro";
import { authorise, byId, collectionItems, collectionJson, update, type CollectionInput } from "../../../../../lib/collections.ts";
import { cursorOf, parseCursor } from "../../../../../lib/filters.ts";
import { body, cacheFor, error, json, limitIp, NO_STORE } from "../../../../../lib/http.ts";
import { feedJson, feedsBySlugs, itemJson } from "../../../../../lib/views.ts";

const PAGE = 30;

export const GET: APIRoute = async (ctx) => {
  const limited = await limitIp(ctx, "api-read", 120, "1 m");
  if (limited) return limited;
  const c = await byId(String(ctx.params.id ?? ""));
  if (!c) return error(404, "No such collection.");
  const [list, items] = await Promise.all([feedsBySlugs(c.feeds), collectionItems(c, PAGE, parseCursor(ctx.url.searchParams.get("before")))]);
  const last = items.at(-1);
  const next = items.length === PAGE && last ? `${ctx.url.pathname}?before=${encodeURIComponent(cursorOf(last))}` : null;
  return json({ collection: collectionJson(c, ctx.url.origin), feeds: list.map(feedJson), items: items.map(itemJson), next }, { cache: cacheFor(60) });
};

export const PUT: APIRoute = async (ctx) => {
  const doc = await authorise(ctx);
  if (doc instanceof Response) return doc;
  const input = await body<CollectionInput>(ctx, 20_000);
  if (!input || typeof input !== "object") return error(400, "Send a JSON object.");
  const r = await update(doc, input);
  if (typeof r === "string") return error(422, r);
  return json({ collection: collectionJson(r, ctx.url.origin) }, { cache: NO_STORE });
};
