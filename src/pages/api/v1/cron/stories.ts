// GET or POST /api/v1/cron/stories — clears the story queue of stale and
// abandoned jobs, then queues up to five new ones (src/lib/stories.ts).
// Called once a day by Vercel Cron (GET, vercel.json), with CRON_SECRET,
// so a worker finds the morning's stories waiting.
//
// Once a UTC day: Vercel may deliver one run twice, and each call queues
// five more jobs, so a second call the same day queues nothing. ?again=1
// runs it once more on purpose.
import type { APIRoute } from "astro";
import { utcDay } from "../../../../lib/budget.ts";
import { lock, unlock } from "../../../../lib/cache.ts";
import { error, isCron, json } from "../../../../lib/http.ts";
import { alert } from "../../../../lib/notify.ts";
import { enqueue, sweep } from "../../../../lib/stories.ts";

const run: APIRoute = async (ctx) => {
  if (!isCron(ctx)) return error(401, "Not for you.");
  const today = `stories:${utcDay()}`;
  const first = await lock(today, 26 * 3600);
  if (!first && ctx.url.searchParams.get("again") !== "1") return json({ skipped: "already ran today; ?again=1 runs it once more" });
  try {
    const swept = await sweep();
    const queued = await enqueue(5);
    if (queued.queued) await alert(`${queued.queued} story job(s) waiting at /api/v1/stories/jobs`);
    return json({ swept, queued });
  } catch (e) {
    // A run that failed has not run: the day's next call may try again.
    if (first) await unlock(today);
    throw e;
  }
};

export const GET = run;
export const POST = run;
