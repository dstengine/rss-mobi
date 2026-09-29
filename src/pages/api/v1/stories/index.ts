// GET /api/v1/stories — published stories whole, newest first, with the
//     sources each cites. ?before=<publishedAt of the last one seen>
//     pages back. Needs read:stories: the text is ours, and the sites that
//     republish it are the ones given a key.
import type { APIRoute } from "astro";
import { json, requireScope } from "../../../../lib/http.ts";
import { publishedStories, storyJson } from "../../../../lib/stories.ts";

export const GET: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "read:stories");
  if (key instanceof Response) return key;
  const p = ctx.url.searchParams;
  const limit = Math.min(Math.max(Math.trunc(Number(p.get("limit") ?? 20)) || 20, 1), 50);
  const before = p.get("before") ? new Date(p.get("before")!) : undefined;
  const list = await publishedStories(limit, before && !Number.isNaN(before.getTime()) ? before : undefined);
  const last = list.at(-1);
  const next = list.length === limit && last?.publishedAt ? `${ctx.url.pathname}?${new URLSearchParams({ limit: String(limit), before: last.publishedAt.toISOString() })}` : null;
  return json({ stories: list.map(storyJson), next });
};
