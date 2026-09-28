// GET    /api/v1/admin/blocklist                  — every blocked host.
// POST   /api/v1/admin/blocklist {host, reason?}  — blocks a host and its
//        subdomains: its feeds come down with their posts, and nothing
//        from it is accepted again.
// DELETE /api/v1/admin/blocklist {host}  (or ?host=) — lifts a block; the
//        feeds it took down come back.
// All need the admin scope.
import type { APIRoute } from "astro";
import { block, blocked, hostKey, unblock } from "../../../../lib/admin.ts";
import { body, error, json, requireScope } from "../../../../lib/http.ts";

export const GET: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "admin");
  if (key instanceof Response) return key;
  return json({ hosts: (await blocked()).map((b) => ({ host: b._id, reason: b.reason, by: b.by ?? null, createdAt: b.createdAt })) });
};

export const POST: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "admin");
  if (key instanceof Response) return key;
  const input = await body<{ host?: unknown; reason?: unknown }>(ctx, 2_000);
  const host = typeof input?.host === "string" ? hostKey(input.host) : "";
  if (!host) return error(400, 'Send {"host": "example.com", "reason": "…"}.');
  const reason = typeof input?.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  return json({ host, hidden: await block(host, reason, key.name) }, { status: 201 });
};

export const DELETE: APIRoute = async (ctx) => {
  const key = await requireScope(ctx, "admin");
  if (key instanceof Response) return key;
  const raw = ctx.url.searchParams.get("host") ?? (await body<{ host?: unknown }>(ctx, 2_000))?.host;
  const host = typeof raw === "string" ? hostKey(raw) : "";
  if (!host) return error(400, 'Send {"host": "example.com"} or ?host=example.com.');
  const restored = await unblock(host, key.name);
  return restored ? json({ host, restored }) : error(404, "That host is not blocked.");
};
