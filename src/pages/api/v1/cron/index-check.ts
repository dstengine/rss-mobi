// POST /api/v1/cron/index-check — collects the index checks that have come
// back and files the next batch (src/lib/indexcheck.ts), then spends the
// time left asking Search Console about the post pages we opened
// (src/lib/pagecheck.ts). Called every 15 minutes by QStash, with GitHub
// Actions as the fallback, with CRON_SECRET.
import type { APIRoute } from "astro";
import { runIndexCheck } from "../../../../lib/indexcheck.ts";
import { inspectOpenPages } from "../../../../lib/pagecheck.ts";
import { error, isCron, json } from "../../../../lib/http.ts";

export const POST: APIRoute = async (ctx) => {
  if (!isCron(ctx)) return error(401, "Not for you.");
  const started = Date.now();
  // Stop starting new calls 15s before the function's 60s limit.
  const report = await runIndexCheck(started + 45_000);
  const pages = await inspectOpenPages(started + 50_000);
  return json({ ...report, pages, ms: Date.now() - started });
};
