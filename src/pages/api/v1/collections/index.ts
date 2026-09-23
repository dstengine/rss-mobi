// POST /api/v1/collections {title, feeds: [slug…], filters?: {tags, lang,
//      hosts, q, exclude}} — saves a collection. Returns it with its edit
//      link, which is shown once and never again.
import type { APIRoute } from "astro";
import { create, collectionJson, type CollectionInput } from "../../../../lib/collections.ts";
import { body, clientIp, error, json, limitIp } from "../../../../lib/http.ts";
import { ipHash } from "../../../../lib/tokens.ts";

export const POST: APIRoute = async (ctx) => {
  const limited = await limitIp(ctx, "collection", 10, "1 h");
  if (limited) return limited;
  const input = await body<CollectionInput>(ctx, 20_000);
  if (!input || typeof input !== "object") return error(400, 'Send {"title": "…", "feeds": ["slug", …]}.');
  try {
    const r = await create(input, ipHash(clientIp(ctx)));
    if (typeof r === "string") return error(422, r);
    return json({ collection: collectionJson(r.collection, ctx.url.origin), editUrl: `${ctx.url.origin}/c/${r.collection.id}/edit/#${r.editToken}` }, { status: 201 });
  } catch (e) {
    console.error("collection create failed", e);
    return error(500, "Something went wrong saving that collection. Try again.");
  }
};
