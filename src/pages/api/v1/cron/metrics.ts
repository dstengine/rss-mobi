// POST /api/v1/cron/metrics — rolls events up into metrics_daily
// (src/lib/metrics.ts). By default the last three whole UTC days, so one
// missed run is caught up by the next; ?day=YYYY-MM-DD rolls up one day,
// for a backfill. Called once a day by QStash, with CRON_SECRET.
import type { APIRoute } from "astro";
import { error, isCron, json } from "../../../../lib/http.ts";
import { lastDays, rollUp } from "../../../../lib/metrics.ts";

export const POST: APIRoute = async (ctx) => {
  if (!isCron(ctx)) return error(401, "Not for you.");
  const one = ctx.url.searchParams.get("day");
  if (one && !/^\d{4}-\d\d-\d\d$/.test(one)) return error(400, "day is YYYY-MM-DD.");
  const days = one ? [one] : lastDays(3);
  const rows: Record<string, number> = {};
  for (const day of days) rows[day] = await rollUp(day);
  return json({ rows });
};
