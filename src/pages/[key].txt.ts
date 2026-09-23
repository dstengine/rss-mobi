// The IndexNow key file: https://rss.mobi/<key>.txt must answer with the
// key itself for search engines to accept our pings. Any other *.txt at
// the root is a 404.
import type { APIRoute } from "astro";
import { env } from "../lib/env.ts";

export const GET: APIRoute = ({ params }) => {
  const key = env("INDEXNOW_KEY");
  if (!key || params.key !== key) return new Response("Not found", { status: 404 });
  return new Response(key, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
};
