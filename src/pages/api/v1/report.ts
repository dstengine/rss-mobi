// POST /api/v1/report {feed, reason, note?} — a reader flags a feed. There
// is no moderation queue, so reports are what stands in for one: each goes
// to the alerts chat at once.
import type { APIRoute } from "astro";
import { feeds, reports } from "../../../lib/db.ts";
import { body, clientIp, error, json, limitIp } from "../../../lib/http.ts";
import { alert } from "../../../lib/notify.ts";
import { ipHash } from "../../../lib/tokens.ts";
import { SITE } from "../../../lib/env.ts";

const REASONS = new Set(["spam", "adult", "copyright", "owner", "broken", "other"]);

export const POST: APIRoute = async (ctx) => {
  const limited = await limitIp(ctx, "report", 5, "1 h");
  if (limited) return limited;
  const r = await body<{ feed?: unknown; reason?: unknown; note?: unknown }>(ctx, 4_000);
  if (!r || typeof r.feed !== "string" || typeof r.reason !== "string" || !REASONS.has(r.reason)) {
    return error(400, 'Send {"feed": "<slug>", "reason": "spam|adult|copyright|owner|broken|other", "note": "…"}.');
  }
  const feed = await (await feeds()).findOne({ slug: r.feed }, { projection: { _id: 1, slug: 1, title: 1, host: 1 } });
  if (!feed) return error(404, "No such feed.");
  const note = typeof r.note === "string" ? r.note.trim().slice(0, 1000) : "";
  await (await reports()).insertOne({
    feedId: feed._id,
    feedSlug: feed.slug,
    reason: r.reason,
    note,
    ipHash: ipHash(clientIp(ctx)),
    status: "open",
    createdAt: new Date(),
  });
  await alert(`report (${r.reason}) on ${feed.title} (${feed.host}) ${SITE}/feed/${feed.slug}/${note ? `\n${note}` : ""}`);
  return json({ ok: true }, { status: 201 });
};
