// GET /api/v1/items/<id>/content — one post whole, for the reader: its
// HTML as the original feed carries it now, cleaned, and its audio or
// video. Read from the original on request and never stored (lib/copy.ts);
// `content` is null when there is nothing whole to show, and the reader
// then offers the excerpt and the link. Not for search: the post's page is
// /item/<id>/, which shows the excerpt only.
import type { APIRoute } from "astro";
import { postContent } from "../../../../../lib/copy.ts";
import { cacheFor, error, json, limitIp } from "../../../../../lib/http.ts";

export const GET: APIRoute = async (ctx) => {
  const limited = await limitIp(ctx, "api-read", 120, "1 m");
  if (limited) return limited;
  const post = await postContent(String(ctx.params.id ?? ""));
  if (!post) return error(404, "No such post.");
  if ("gone" in post) return error(410, "This post was taken down with its feed.");
  return json(post, { cache: cacheFor(300), headers: { "X-Robots-Tag": "noindex" } });
};
