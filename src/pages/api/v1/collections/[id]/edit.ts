// GET /api/v1/collections/<id>/edit  X-Edit-Token — the collection with
// its feeds' titles, for the edit form. Separate from GET /collections/<id>
// so that one stays cacheable.
import type { APIRoute } from "astro";
import { authorise, collectionJson, publicOf } from "../../../../../lib/collections.ts";
import { json, NO_STORE } from "../../../../../lib/http.ts";
import { feedJson, feedsBySlugs } from "../../../../../lib/views.ts";

export const GET: APIRoute = async (ctx) => {
  const doc = await authorise(ctx);
  if (doc instanceof Response) return doc;
  const list = await feedsBySlugs(doc.feeds);
  return json({ collection: collectionJson(publicOf(doc), ctx.url.origin), feeds: list.map(feedJson) }, { cache: NO_STORE });
};
