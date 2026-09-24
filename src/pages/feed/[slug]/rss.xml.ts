// GET /feed/<slug>/rss.xml — one feed from the directory as RSS 2.0: its
// newest posts, each linking to its original and naming the feed in
// <source>. This is the address a feed's page offers to copy.
import type { APIRoute } from "astro";
import { cacheFor } from "../../../lib/http.ts";
import { toRss, xmlHeaders } from "../../../lib/rss.ts";
import { feedBySlug, feedItems } from "../../../lib/views.ts";
import { site } from "../../../site.config.ts";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" } });

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug ?? "");
  const feed = /^[a-z0-9-]{1,80}$/.test(slug) ? await feedBySlug(slug) : null;
  if (!feed) return text("No such feed.\n", 404);
  // Gone on purpose, like its page: a reader should stop asking.
  if (feed.status === "hidden") return text("This feed was taken out of the directory.\n", 410);
  const items = await feedItems(feed.slug, 50);
  const page = `${site.url}/feed/${feed.slug}/`;
  const xml = toRss({
    title: feed.title,
    link: page,
    self: `${page}rss.xml`,
    description: feed.description || `Latest posts from ${feed.host}.`,
    items,
    sources: new Map([[feed.slug, { title: feed.title, url: feed.url }]]),
  });
  return new Response(xml, { headers: xmlHeaders("application/rss+xml", cacheFor(300)) });
};
