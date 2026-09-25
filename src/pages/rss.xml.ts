// GET /rss.xml — the directory's newest posts as RSS 2.0, narrowed by any
// filter /api/v1/items takes: ?tag=ai,robotics&lang=en&q=agents&exclude=crypto.
// With none, every feed's newest posts. /rss/ explains the filters and
// builds the address.
import type { APIRoute } from "astro";
import { postsRss, rssPath, rssUrl } from "../lib/exports.ts";
import { describe, narrowed, parseFilters, spelling, toSearch } from "../lib/filters.ts";
import { cacheFor } from "../lib/http.ts";
import { xmlHeaders } from "../lib/rss.ts";
import { site } from "../site.config.ts";

export const GET: APIRoute = async ({ url }) => {
  const f = parseFilters(url.searchParams);
  // One spelling per filter — order, case, unknown parameters — so every
  // reader of the same filter shares one cached file.
  if (spelling(url.search) !== toSearch(f)) return Response.redirect(new URL(rssPath(f), url), 301);
  const topicOnly = f.tags.length === 1 && !narrowed({ ...f, tags: [] });
  const xml = await postsRss(f, {
    title: narrowed(f) ? `${describe(f)} · rss.mobi` : "Newest posts · rss.mobi",
    link: topicOnly ? `${site.url}/tag/${f.tags[0]}/` : `${site.url}/rss/`,
    self: rssUrl(f),
    description: narrowed(f)
      ? `${describe(f)}, newest first, from the RSS feeds in the rss.mobi directory.`
      : "The newest posts from every RSS feed in the rss.mobi directory.",
  });
  return new Response(xml, { headers: xmlHeaders("application/rss+xml", cacheFor(300)) });
};
