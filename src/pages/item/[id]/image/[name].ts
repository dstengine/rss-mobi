// GET /item/<id>/image/<thumb.webp|card.webp|og.jpg> — a post's picture,
// resized from the original on the way through (src/lib/pictures.ts). The
// CDN keeps each for a month, so a picture is fetched and resized once
// per size, not once per visitor.
import type { APIRoute } from "astro";
import { ObjectId } from "mongodb";
import { items } from "../../../../lib/db.ts";
import { isSize, original, pictureUrl, render } from "../../../../lib/pictures.ts";

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  // The publisher's picture, not ours to put in image search.
  "X-Robots-Tag": "noindex",
};

const missing = (seconds: number) =>
  new Response("No such picture.\n", { status: 404, headers: { ...HEADERS, "Cache-Control": `public, max-age=0, s-maxage=${seconds}` } });

export const GET: APIRoute = async ({ params, url, redirect }) => {
  const id = String(params.id ?? "");
  const name = String(params.name ?? "");
  if (!/^[0-9a-f]{24}$/.test(id) || !isSize(name)) return missing(86_400);
  // One address per picture: a query string would make every variant a
  // CDN miss, and every miss a fetch from the publisher.
  if (url.search) return redirect(`/item/${id}/image/${name}`, 301);
  const it = await (await items()).findOne({ _id: new ObjectId(id), visible: true }, { projection: { picture: 1 } });
  if (!it || !pictureUrl({ id, picture: it.picture }, name)) return missing(3_600);
  const bytes = await original(it.picture!.url);
  if (!bytes) return missing(3_600);
  try {
    const { body, type } = await render(bytes, name);
    return new Response(body, {
      headers: { ...HEADERS, "Content-Type": type, "Cache-Control": "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=2592000" },
    });
  } catch {
    return missing(3_600);
  }
};
