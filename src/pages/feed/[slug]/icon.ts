// GET /feed/<slug>/icon — the feed's site icon, or its initial on a tile;
// lib/icon.ts says where it comes from. Always an image, so a list never
// shows a broken one. The CDN keeps a found icon for a week and a stand-in
// for a day, in case the site gains one.
import type { APIRoute } from "astro";
import { feedIcon, monogram } from "../../../lib/icon.ts";

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  // An SVG opened on its own is a document on our origin: no scripts,
  // no origin of its own.
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  // Other people's logos are not ours to put in image search.
  "X-Robots-Tag": "noindex",
};

export const GET: APIRoute = async ({ params, url, redirect }) => {
  const slug = String(params.slug ?? "");
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return new Response("No such feed.\n", { status: 404 });
  // One address per icon: a query string would make every variant a CDN
  // miss, and every miss a fetch from the publisher.
  if (url.search) return redirect(`/feed/${slug}/icon`, 301);
  const found = await feedIcon(slug);
  if (!found) return new Response("No such feed.\n", { status: 404, headers: { "Cache-Control": "public, max-age=0, s-maxage=300" } });
  if (found.picture) {
    return new Response(found.picture.bytes, {
      headers: {
        ...HEADERS,
        "Content-Type": found.picture.type,
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  }
  return new Response(monogram(found.feed.title, slug), {
    headers: {
      ...HEADERS,
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
};
