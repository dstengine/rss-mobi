// GET  /api/v1/stories/jobs            — jobs waiting or held, best first.
//      Needs write:stories.
// POST /api/v1/stories/jobs {max?}     — queues the best stories of the last
//      two days that no job covers yet (stories.ts enqueue). Needs admin.
import type { APIRoute } from "astro";
import { stories } from "../../../../../lib/db.ts";
import { body, json, requireScope } from "../../../../../lib/http.ts";
import { enqueue } from "../../../../../lib/stories.ts";

export const GET: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "write:stories");
  if (key instanceof Response) return key;
  const rows = await (await stories())
    .find({ status: { $in: ["queued", "claimed"] } }, { projection: { status: 1, score: 1, hosts: 1, leaseUntil: 1, "sources.title": 1 } })
    .sort({ score: -1 })
    .limit(50)
    .toArray();
  return json({
    jobs: rows.map((j) => ({ id: String(j._id), status: j.status, score: j.score, sites: j.hosts, leaseUntil: j.leaseUntil ?? null, title: j.sources[0]?.title ?? "" })),
  });
};

export const POST: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "admin");
  if (key instanceof Response) return key;
  const input = await body<{ max?: unknown }>(ctx, 1_000);
  const max = Math.min(Math.max(Math.trunc(Number(input?.max ?? 5)) || 5, 1), 20);
  return json(await enqueue(max), { status: 201 });
};
