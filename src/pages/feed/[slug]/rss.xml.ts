// GET /feed/<slug>/rss.xml — our copy of one feed, the address a feed's
// page offers to copy. It carries what the original carries (the whole
// post, pictures, a podcast's episode) and is at most five minutes behind
// it; lib/copy.ts says how. Each post links to its original and names the
// feed in <source>.
import type { APIRoute } from "astro";
import { copyItems, copySource, livePosts, noteSubscribers, storedPosts } from "../../../lib/copy.ts";
import { cacheFor } from "../../../lib/http.ts";
import { toRss, xmlHeaders } from "../../../lib/rss.ts";
import { site } from "../../../site.config.ts";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" } });

export const GET: APIRoute = async ({ params, request }) => {
  const feed = await copySource(String(params.slug ?? ""));
  if (!feed) return text("No such feed.\n", 404);
  // Gone on purpose, like its page: a reader should stop asking.
  if (feed.status === "hidden") return text("This feed was taken out of the directory.\n", 410);
  const [stored, live] = await Promise.all([
    storedPosts(feed.slug),
    // A feed the poller gave up on is not asked again on every request.
    feed.status === "active" ? livePosts(feed) : null,
    noteSubscribers(feed, request.headers.get("user-agent") ?? "").catch(() => {}),
  ]);
  const self = `${site.url}/feed/${feed.slug}/rss.xml`;
  const xml = toRss({
    title: feed.title,
    link: feed.siteUrl || `${site.url}/feed/${feed.slug}/`,
    self,
    description: feed.description || `Latest posts from ${feed.host}.`,
    image: feed.image,
    ttl: 15,
    items: copyItems(feed, stored, live),
    sources: new Map([[feed.slug, { title: feed.title, url: feed.url }]]),
  });
  // Five minutes at the CDN, so the original hears from us at most that
  // often however many readers follow the copy.
  return new Response(xml, { headers: xmlHeaders("application/rss+xml", cacheFor(300)) });
};
