// PUT /api/v1/admin/stories/<id> {status: "published" | "review" | "rejected"}
// — publishes a written story, takes it back to review, or rejects it.
// Needs admin.
import type { APIRoute } from "astro";
import { body, error, json, requireScope } from "../../../../../lib/http.ts";
import { alert } from "../../../../../lib/notify.ts";
import { decide, storyPath } from "../../../../../lib/stories.ts";
import { SITE } from "../../../../../lib/env.ts";

const STATUSES = ["published", "review", "rejected"] as const;

export const PUT: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "admin");
  if (key instanceof Response) return key;
  const input = await body<{ status?: unknown }>(ctx, 1_000);
  const status = STATUSES.find((s) => s === input?.status);
  if (!status) return error(400, 'Send {"status": "published"}, "review" or "rejected".');
  const s = await decide(String(ctx.params.id ?? ""), status);
  if (!s) return error(404, "No written story with that id.");
  if (status === "published") await alert(`published story: ${s.headline} ${SITE}${storyPath(s)}`);
  return json({ id: String(s._id), status: s.status, url: `${ctx.url.origin}${storyPath(s)}` });
};
