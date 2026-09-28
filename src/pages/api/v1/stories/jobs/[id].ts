// GET    /api/v1/stories/jobs/<id> — a job the key holds, as claimed.
// POST   /api/v1/stories/jobs/<id> {headline, dek, sections, keyPoints,
//        cited} — the story for it. 422 lists what to fix, and the job stays
//        held; 200 files the story for review.
// DELETE /api/v1/stories/jobs/<id> {reject?, reason?} — hands the job back,
//        or rejects it with the reason.
// All need write:stories, and the job held by the calling key.
import type { APIRoute } from "astro";
import { ObjectId } from "mongodb";
import { stories } from "../../../../../lib/db.ts";
import { body, error, json, requireScope } from "../../../../../lib/http.ts";
import { jobJson, release, storyPath, submit } from "../../../../../lib/stories.ts";

const id = (ctx: Parameters<APIRoute>[0]) => String(ctx.params.id ?? "");

export const GET: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "write:stories");
  if (key instanceof Response) return key;
  const job = ObjectId.isValid(id(ctx)) ? await (await stories()).findOne({ _id: new ObjectId(id(ctx)), claimedBy: key.prefix }) : null;
  return job ? json({ job: jobJson(job, ctx.url.origin) }) : error(404, "No such job held by this key.");
};

export const POST: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "write:stories");
  if (key instanceof Response) return key;
  const input = await body<unknown>(ctx, 60_000);
  if (!input) return error(400, "Send the story as JSON.");
  const r = await submit(id(ctx), key, input);
  if (r.status === 404) return error(404, "No such job.");
  if (r.status === 409) return error(409, "This key does not hold that job, or its lease ran out. Claim it again.");
  if (r.status === 422) return error(422, "The story needs changes.", { problems: r.problems });
  const s = r.story!;
  return json({ story: { id: String(s._id), status: s.status, words: s.words, preview: `${ctx.url.origin}${storyPath(s)}` } });
};

export const DELETE: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "write:stories");
  if (key instanceof Response) return key;
  const input = (await body<{ reject?: unknown; reason?: unknown }>(ctx, 2_000)) ?? {};
  const job = await release(id(ctx), key.prefix, { reject: input.reject === true, reason: typeof input.reason === "string" ? input.reason : "" });
  return job ? json({ id: String(job._id), status: job.status }) : error(409, "This key does not hold that job.");
};
