// GET or POST /api/v1/cron/metrics — rolls events up into metrics_daily
// (src/lib/metrics.ts). By default the last three whole UTC days, so one
// missed run is caught up by the next; ?day=YYYY-MM-DD rolls up one day,
// for a backfill. Called once a day by Vercel Cron (GET, vercel.json),
// with CRON_SECRET; a backfill is a POST by hand.
import type { APIRoute } from "astro";
import { error, isCron, json } from "../../../../lib/http.ts";
import { lastDays, rollUp } from "../../../../lib/metrics.ts";

const run: APIRoute = async (ctx) => {
  if (!isCron(ctx)) return error(401, "Not for you.");
  const one = ctx.url.searchParams.get("day");
  if (one && !/^\d{4}-\d\d-\d\d$/.test(one)) return error(400, "day is YYYY-MM-DD.");
  const days = one ? [one] : lastDays(3);
  // null for a day another run is counting.
  const rows: Record<string, number | null> = {};
  for (const day of days) rows[day] = await rollUp(day);
  return json({ rows });
};

export const GET = run;
export const POST = run;
