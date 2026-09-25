// GET /tag/<tag>/rss.xml — a topic's newest posts as RSS 2.0, from every
// feed tagged with it: the topic page's list, followed in a reader.
import type { APIRoute } from "astro";
import { postsRss } from "../../../lib/exports.ts";
import { tag as normalise } from "../../../lib/feeds/parse.ts";
import { parseFilters } from "../../../lib/filters.ts";
import { cacheFor } from "../../../lib/http.ts";
import { xmlHeaders } from "../../../lib/rss.ts";
import { tagStat } from "../../../lib/views.ts";
import { counted, topicName } from "../../../lib/words.ts";
import { site } from "../../../site.config.ts";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" } });

export const GET: APIRoute = async ({ params, url }) => {
  const raw = decodeURIComponent(String(params.tag ?? ""));
  const t = normalise(raw);
  if (!t) return text("No such topic.\n", 404);
  if (t !== raw) return Response.redirect(new URL(`/tag/${t}/rss.xml`, url), 301);
  const stat = await tagStat(t);
  if (!stat) return text("No such topic.\n", 404);
  const xml = await postsRss(parseFilters({ tag: t }), {
    title: `${topicName(t)} · rss.mobi`,
    link: `${site.url}/tag/${t}/`,
    self: `${site.url}/tag/${t}/rss.xml`,
    description: `The newest ${topicName(t, false)} posts from ${counted(stat.feeds, "RSS feed")} in the rss.mobi directory.`,
  });
  return new Response(xml, { headers: xmlHeaders("application/rss+xml", cacheFor(300)) });
};
