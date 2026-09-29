// POST /api/v1/cron/stories — clears the story queue of stale and
// abandoned jobs, then queues up to five new ones (src/lib/stories.ts).
// Called once a day by QStash, with CRON_SECRET, so a worker finds the
// morning's stories waiting.
import type { APIRoute } from "astro";
import { error, isCron, json } from "../../../../lib/http.ts";
import { alert } from "../../../../lib/notify.ts";
import { enqueue, sweep } from "../../../../lib/stories.ts";

export const POST: APIRoute = async (ctx) => {
  if (!isCron(ctx)) return error(401, "Not for you.");
  const swept = await sweep();
  const queued = await enqueue(5);
  if (queued.queued) await alert(`${queued.queued} story job(s) waiting at /api/v1/stories/jobs`);
  return json({ swept, queued });
};
