// GET /c/<id>/opml.xml — the feeds in a collection as OPML, for importing
// the whole list into another reader at once.
import type { APIRoute } from "astro";
import { byId } from "../../../lib/collections.ts";
import { cacheFor } from "../../../lib/http.ts";
import { toOpml } from "../../../lib/opml.ts";
import { xmlHeaders } from "../../../lib/rss.ts";
import { feedsBySlugs } from "../../../lib/views.ts";

export const GET: APIRoute = async ({ params }) => {
  const c = await byId(String(params.id ?? ""));
  if (!c) return new Response("No such collection.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const list = await feedsBySlugs(c.feeds);
  const xml = toOpml(c.title, list.map((f) => ({ title: f.title, url: f.url, siteUrl: f.siteUrl || undefined })), new Date(c.updatedAt));
  const headers = xmlHeaders("text/x-opml", cacheFor(300));
  headers.set("Content-Disposition", `inline; filename="rss-mobi-${c.id}.opml"`);
  return new Response(xml, { headers });
};
