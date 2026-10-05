// GET /item/<id>/image/<thumb.webp|card.webp|og.jpg> — a post's picture,
// resized from the original on the way through (src/lib/pictures.ts). The
// CDN keeps each for a month, so a picture is fetched and resized once
// per size, not once per visitor.
import type { APIRoute } from "astro";
import { ObjectId } from "mongodb";
import { items } from "../../../../lib/db.ts";
import { isSize, noPicture, pictureResponse, pictureUrl } from "../../../../lib/pictures.ts";

export const GET: APIRoute = async ({ params, url, redirect }) => {
  const id = String(params.id ?? "");
  const name = String(params.name ?? "");
  if (!/^[0-9a-f]{24}$/.test(id) || !isSize(name)) return noPicture(86_400);
  // One address per picture: a query string would make every variant a
  // CDN miss, and every miss a fetch from the publisher.
  if (url.search) return redirect(`/item/${id}/image/${name}`, 301);
  const it = await (await items()).findOne({ _id: new ObjectId(id), visible: true }, { projection: { picture: 1 } });
  if (!it || !pictureUrl({ id, picture: it.picture }, name)) return noPicture(3_600);
  return pictureResponse(it.picture!.url, name);
};
