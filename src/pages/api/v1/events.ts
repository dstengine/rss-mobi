// POST /api/v1/events — what readers did, for experiments and the weekly
// retro. Sent with sendBeacon; nothing here identifies a person: no id, no
// IP, no user agent. Kept 180 days by a TTL index on `at`.
import type { APIRoute } from "astro";
import { events } from "../../../lib/db.ts";
import { EXPERIMENTS } from "../../../lib/experiments.ts";
import { body, limitIp } from "../../../lib/http.ts";

const NAMES = new Set([
  "view",
  "outbound",
  "report",
  "subscribe_copy",
  "subscribe_open",
  "submit_start",
  "submit_preview",
  "submit_success",
  "submit_error",
  "edit_save",
  "follow",
  "unfollow",
  "reader_more",
  "read_post",
  "opml_import",
  "opml_export",
  "collection_create",
  "collection_save",
  "collection_add_url",
]);

const NO_CONTENT = () => new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });

export const POST: APIRoute = async (ctx) => {
  // Analytics never fails a page: every answer is 204, even a refusal.
  if (await limitIp(ctx, "events", 120, "10 m")) return NO_CONTENT();
  const e = await body<{ name?: unknown; path?: unknown; label?: unknown; exp?: unknown }>(ctx, 2_000);
  if (!e || typeof e.name !== "string" || !NAMES.has(e.name)) return NO_CONTENT();

  const doc: Record<string, unknown> = { name: e.name, at: new Date() };
  if (typeof e.path === "string" && e.path.startsWith("/")) doc.path = e.path.slice(0, 200);
  if (typeof e.label === "string") doc.label = e.label.slice(0, 60);
  if (e.exp && typeof e.exp === "object") {
    const exp: Record<string, string> = {};
    for (const [id, v] of Object.entries(e.exp as Record<string, unknown>)) {
      const known = EXPERIMENTS[id];
      if (known && typeof v === "string" && known.variants.some((x) => x.id === v)) exp[id] = v;
    }
    if (Object.keys(exp).length) doc.exp = exp;
  }
  try {
    await (await events()).insertOne(doc);
  } catch (err) {
    console.error("event not stored", err);
  }
  return NO_CONTENT();
};
