// POST /api/v1/stories/jobs/claim {id?} — takes the best waiting job, or the
// one named, for 30 minutes: its sources and the brief. 404 when nothing is
// waiting. Needs write:stories.
import type { APIRoute } from "astro";
import { body, error, json, requireScope } from "../../../../../lib/http.ts";
import { claim, jobJson } from "../../../../../lib/stories.ts";

export const POST: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "write:stories");
  if (key instanceof Response) return key;
  const input = await body<{ id?: unknown }>(ctx, 1_000);
  const job = await claim(key.prefix, typeof input?.id === "string" ? input.id : undefined);
  return job ? json({ job: jobJson(job, ctx.url.origin) }) : error(404, "No job is waiting.");
};
