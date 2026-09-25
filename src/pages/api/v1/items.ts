// GET /api/v1/items — posts across the directory, newest first.
//     ?tag=a,b  ?lang=en  ?feed=slug,slug  ?host=example.com  ?q=words
//     ?exclude=word,word  ?since=<ISO date>  ?limit=1..100  ?before=<cursor>
// Filters combine with AND; a list inside one filter is OR. `next` is the
// URL of the following page, or null at the end. A key with read:full
// gets each post's index-check status as well.
import type { APIRoute } from "astro";
import { freshen } from "../../../lib/after.ts";
import { access, json, readCache } from "../../../lib/http.ts";
import { hasScope } from "../../../lib/keys.ts";
import { cursorOf, parseCursor, parseFilters } from "../../../lib/filters.ts";
import { itemJson, itemsFor } from "../../../lib/views.ts";

export const GET: APIRoute = async (ctx) => {
  const who = await access(ctx);
  if (who instanceof Response) return who;
  const p = ctx.url.searchParams;
  const f = parseFilters(p);
  const rows = await itemsFor(f, parseCursor(p.get("before")));
  // A reader asks by feed: whichever of its feeds are due are polled once
  // it has its answer, so the next refresh has what they published.
  if (!p.get("before")) freshen(f.feeds);
  const last = rows.at(-1);
  const next = rows.length === f.limit && last ? `${ctx.url.pathname}?${new URLSearchParams({ ...Object.fromEntries(p), before: cursorOf(last) })}` : null;
  const full = hasScope(who.key, "read:full");
  return json({ items: rows.map((it) => itemJson(it, full)), next }, { cache: readCache(who.key, 120) });
};
