// Response helpers and request guards shared by every endpoint.
import type { APIContext } from "astro";
import { apiKeys } from "./db.ts";
import { env } from "./env.ts";
import { rateLimit } from "./cache.ts";
import { ipHash, sha256 } from "./tokens.ts";
import type { ApiKeyDoc } from "./types.ts";

/** CDN caching: fresh for `sMaxAge`, served stale while revalidating for a
    day. Browsers do not cache (max-age=0), so a reader who reloads gets
    whatever the edge has. */
export const cacheFor = (sMaxAge = 300) => `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=86400`;
export const NO_STORE = "private, no-store";

export function json(data: unknown, init: ResponseInit & { cache?: string } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", init.cache ?? NO_STORE);
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export const error = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  json({ error: message, ...extra }, { status });

export function clientIp(ctx: APIContext): string {
  const fwd = ctx.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) return fwd;
  try {
    return ctx.clientAddress;
  } catch {
    return "0.0.0.0";
  }
}

/** Per-IP limit for anonymous calls; returns a 429 Response or null. */
export async function limitIp(ctx: APIContext, bucket: string, max: number, window: `${number} ${"s" | "m" | "h" | "d"}`) {
  const r = await rateLimit(bucket, ipHash(clientIp(ctx)), max, window);
  if (r.ok) return null;
  return json(
    { error: "Too many requests. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((r.reset - Date.now()) / 1000))) } },
  );
}

/** The API key presented in `Authorization: Bearer …`, if valid. */
export async function apiKey(ctx: APIContext): Promise<ApiKeyDoc | null> {
  const token = ctx.request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || !token.startsWith("rmk_")) return null;
  const key = await (await apiKeys()).findOne({ hash: sha256(token), revokedAt: { $exists: false } });
  if (key) void (await apiKeys()).updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } });
  return key;
}

/** A valid key with `scope`, rate-limited by its own allowance; otherwise
    the Response to send back. */
export async function requireScope(ctx: APIContext, scope: string): Promise<ApiKeyDoc | Response> {
  const key = await apiKey(ctx);
  if (!key) return error(401, "An API key is required: Authorization: Bearer rmk_…");
  if (!key.scopes.includes(scope) && !key.scopes.includes("admin")) return error(403, `This key lacks the ${scope} scope.`);
  const r = await rateLimit("key", key.prefix, key.rate, "1 m");
  if (!r.ok) return error(429, "Rate limit for this key reached.");
  return key;
}

/** The scheduler's shared secret; constant-time compare. */
export function isCron(ctx: APIContext): boolean {
  const secret = env("CRON_SECRET");
  const got = ctx.request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || got.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

export async function body<T>(ctx: APIContext, maxBytes = 50_000): Promise<T | null> {
  const text = await ctx.request.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
