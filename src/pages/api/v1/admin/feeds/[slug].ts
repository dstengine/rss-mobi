// GET /api/v1/admin/feeds/<slug>  — any feed, whatever its status, with
//     who took it down if someone did.
// PUT /api/v1/admin/feeds/<slug>  {hidden: true|false, reason?} — takes a
//     feed down with its posts, or puts it back. Needs the admin scope.
import type { APIRoute } from "astro";
import { hideFeed } from "../../../../../lib/admin.ts";
import { body, error, json, requireScope } from "../../../../../lib/http.ts";
import { feeds } from "../../../../../lib/db.ts";
import { feedJson } from "../../../../../lib/views.ts";
import type { FeedDoc } from "../../../../../lib/types.ts";

const adminJson = (f: Pick<FeedDoc, "hiddenBy"> & Parameters<typeof feedJson>[0]) => ({ ...feedJson(f, true), hiddenBy: f.hiddenBy ?? null });

export const GET: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "admin");
  if (key instanceof Response) return key;
  const feed = await (await feeds()).findOne({ slug: String(ctx.params.slug ?? "") });
  return feed ? json({ feed: adminJson(feed) }) : error(404, "No such feed.");
};

export const PUT: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "admin");
  if (key instanceof Response) return key;
  const input = await body<{ hidden?: unknown; reason?: unknown }>(ctx, 2_000);
  if (!input || typeof input.hidden !== "boolean") return error(400, 'Send {"hidden": true} or {"hidden": false}, with an optional "reason".');
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  const r = await hideFeed(String(ctx.params.slug ?? ""), input.hidden, key.name, reason);
  if (r === "missing") return error(404, "No such feed.");
  if (r === "blocked") return error(409, "This feed's host is blocked. Lift the block to bring its feeds back.");
  return json({ feed: adminJson(r.feed), changed: r.changed });
};
