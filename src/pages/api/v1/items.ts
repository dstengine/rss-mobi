// GET /api/v1/items — posts across the directory, newest first.
//     ?tag=a,b  ?lang=en  ?feed=slug,slug  ?host=example.com  ?q=words
//     ?exclude=word,word  ?since=<ISO date>  ?limit=1..100  ?before=<cursor>
// Filters combine with AND; a list inside one filter is OR. `next` is the
// URL of the following page, or null at the end.
import type { APIRoute } from "astro";
import { cacheFor, json, limitIp } from "../../../lib/http.ts";
import { cursorOf, parseCursor, parseFilters } from "../../../lib/filters.ts";
import { itemJson, itemsFor } from "../../../lib/views.ts";

export const GET: APIRoute = async (ctx) => {
  const limited = await limitIp(ctx, "api-read", 120, "1 m");
  if (limited) return limited;
  const p = ctx.url.searchParams;
  const f = parseFilters(p);
  const rows = await itemsFor(f, parseCursor(p.get("before")));
  const last = rows.at(-1);
  const next = rows.length === f.limit && last ? `${ctx.url.pathname}?${new URLSearchParams({ ...Object.fromEntries(p), before: cursorOf(last) })}` : null;
  return json({ items: rows.map(itemJson), next }, { cache: cacheFor(120) });
};
