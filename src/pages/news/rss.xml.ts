// GET /news/rss.xml — the published stories as RSS 2.0: headline, dek and a
// link to the story, never the whole text. A pinned story stays in it
// until its pin lifts, however many came after it.
import type { APIRoute } from "astro";
import { cacheFor } from "../../lib/http.ts";
import { toRss, xmlHeaders } from "../../lib/rss.ts";
import { listedStories, storyPath } from "../../lib/stories.ts";
import { site } from "../../site.config.ts";

export const GET: APIRoute = async () => {
  const list = await listedStories(30);
  const xml = toRss({
    title: "News · rss.mobi",
    link: `${site.url}/news/`,
    self: `${site.url}/news/rss.xml`,
    description: "Stories rss.mobi writes from what several RSS feeds in its directory reported.",
    ttl: 60,
    items: list.map((s) => ({ feedSlug: "", url: `${site.url}${storyPath(s)}`, title: s.headline ?? "", excerpt: s.dek ?? "", tags: [], publishedAt: s.publishedAt })),
  });
  return new Response(xml, { headers: xmlHeaders("application/rss+xml", cacheFor(300)) });
};
