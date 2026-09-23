// GET /c/<id>/rss.xml — a collection as RSS 2.0: its newest posts, each
// linking to its original and naming its feed in <source>.
import type { APIRoute } from "astro";
import { byId, collectionItems } from "../../../lib/collections.ts";
import { cacheFor } from "../../../lib/http.ts";
import { toRss, xmlHeaders } from "../../../lib/rss.ts";
import { feedsBySlugs } from "../../../lib/views.ts";
import { site } from "../../../site.config.ts";

export const GET: APIRoute = async ({ params }) => {
  const c = await byId(String(params.id ?? ""));
  if (!c) return new Response("No such collection.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const items = await collectionItems(c, 50);
  // Items may come from feeds outside the list when the collection is all
  // filters; name those too.
  const list = await feedsBySlugs([...new Set([...c.feeds, ...items.map((it) => it.feedSlug)])]);
  const page = `${site.url}/c/${c.id}/`;
  const xml = toRss({
    title: c.title,
    link: page,
    self: `${page}rss.xml`,
    description: `${c.title} — a combined RSS feed from rss.mobi.`,
    items,
    sources: new Map(list.map((f) => [f.slug, { title: f.title, url: f.url }])),
  });
  return new Response(xml, { headers: xmlHeaders("application/rss+xml", cacheFor(300)) });
};
