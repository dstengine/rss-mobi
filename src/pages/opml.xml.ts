// GET /opml.xml — every feed in the directory as OPML, the most followed
// first: one file to import the lot into any reader.
import type { APIRoute } from "astro";
import { feedsOpml } from "../lib/exports.ts";
import { cacheFor } from "../lib/http.ts";
import { xmlHeaders } from "../lib/rss.ts";
import { rankedFeeds } from "../lib/views.ts";

export const GET: APIRoute = async () => {
  const headers = xmlHeaders("text/x-opml", cacheFor(3600));
  headers.set("Content-Disposition", `inline; filename="rss-mobi.opml"`);
  return new Response(feedsOpml("rss.mobi — RSS feeds directory", await rankedFeeds()), { headers });
};
