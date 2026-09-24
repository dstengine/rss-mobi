// POST /api/v1/cron/fetch — polls the feeds whose turn has come, eight at
// a time. Called every 15 minutes by QStash, with GitHub Actions as the
// fallback, with CRON_SECRET; Vercel's own cron runs once a day on this
// plan, which is not a feed reader. Pages poll the feeds they show, too
// (src/lib/after.ts).
import type { APIRoute } from "astro";
import { pollDue } from "../../../../lib/catalog.ts";
import { error, isCron, json } from "../../../../lib/http.ts";

export const POST: APIRoute = async (ctx) => {
  if (!isCron(ctx)) return error(401, "Not for you.");
  const started = Date.now();
  // Stop taking new feeds 15s before the function's 60s limit, so the
  // last fetch in flight has time to finish and be recorded.
  const report = await pollDue(started + 45_000);
  return json({ ...report, ms: Date.now() - started });
};
