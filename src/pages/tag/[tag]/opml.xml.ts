// GET /tag/<tag>/opml.xml — a topic's feeds as OPML, in the order its page
// ranks them: import it and a reader follows each of them separately.
import type { APIRoute } from "astro";
import { feedsOpml } from "../../../lib/exports.ts";
import { tag as normalise } from "../../../lib/feeds/parse.ts";
import { cacheFor } from "../../../lib/http.ts";
import { xmlHeaders } from "../../../lib/rss.ts";
import { feedsByTag } from "../../../lib/views.ts";
import { topicName } from "../../../lib/words.ts";

export const GET: APIRoute = async ({ params, url }) => {
  const raw = decodeURIComponent(String(params.tag ?? ""));
  const t = normalise(raw);
  const none = () => new Response("No such topic.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" } });
  if (!t) return none();
  if (t !== raw) return Response.redirect(new URL(`/tag/${t}/opml.xml`, url), 301);
  const list = await feedsByTag(t, 500);
  if (!list.length) return none();
  const headers = xmlHeaders("text/x-opml", cacheFor(3600));
  headers.set("Content-Disposition", `inline; filename="rss-mobi-${t}.opml"`);
  return new Response(feedsOpml(`${topicName(t)} RSS feeds — rss.mobi`, list), { headers });
};
