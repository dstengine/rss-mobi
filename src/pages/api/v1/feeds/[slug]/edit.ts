// GET /api/v1/feeds/<slug>/edit  X-Edit-Token — what the owner may change.
// A separate route from GET /feeds/<slug> so that one stays cacheable.
import type { APIRoute } from "astro";
import { json, NO_STORE } from "../../../../../lib/http.ts";
import { authorise, editable } from "../../../../../lib/edit.ts";

export const GET: APIRoute = async (ctx) => {
  const feed = await authorise(ctx);
  if (feed instanceof Response) return feed;
  return json({ feed: editable(feed) }, { cache: NO_STORE });
};
