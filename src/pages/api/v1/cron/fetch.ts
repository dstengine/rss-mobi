// POST /api/v1/cron/fetch — polls the feeds whose turn has come, eight at
// a time, then looks for new posts' pictures (src/lib/pictures.ts). Called every 15 minutes by QStash, with GitHub Actions as the
// fallback, with CRON_SECRET; Vercel's own cron runs once a day on this
// plan, which is not a feed reader. Pages poll the feeds they show, too
// (src/lib/after.ts).
import type { APIRoute } from "astro";
import { pollDue } from "../../../../lib/catalog.ts";
import { fillPictures } from "../../../../lib/pictures.ts";
import { error, isCron, json } from "../../../../lib/http.ts";

export const POST: APIRoute = async (ctx) => {
  if (!isCron(ctx)) return error(401, "Not for you.");
  const started = Date.now();
  // Feeds first. The time they leave goes to looking for new posts'
  // pictures, and nothing new starts after 40s: the last fetches in flight
  // need time to finish and be recorded inside the function's 60s.
  const report = await pollDue(started + 35_000);
  const pictures = await fillPictures(started + 40_000);
  return json({ ...report, pictures, ms: Date.now() - started });
};
