// Response helpers and request guards shared by every endpoint.
import type { APIContext } from "astro";
import { after } from "./after.ts";
import { apiKeys } from "./db.ts";
import { env } from "./env.ts";
import { rateLimit } from "./cache.ts";
import { hasScope, lookup, type Scope } from "./keys.ts";
import { ipHash } from "./tokens.ts";
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
  // A key's answer may carry more than the anonymous one (read:full), and
  // is never stored; the anonymous one is, and must not be handed to a key.
  headers.set("Vary", "Authorization");
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
  return r.ok ? null : tooMany(r.reset, "Too many requests. Try again shortly.");
}

const bearer = (ctx: APIContext) => ctx.request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];

const tooMany = (reset: number, message: string) =>
  json({ error: message }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))) } });

const INVALID = () => error(401, "This API key is not valid, or has been revoked.");

/** Notes when a key was last used, at most once a minute per key. */
function touch(key: ApiKeyDoc) {
  const now = new Date();
  if (key.lastUsedAt && now.getTime() - key.lastUsedAt.getTime() < 60_000) return;
  after("key", async () => (await apiKeys()).updateOne({ _id: key._id }, { $set: { lastUsedAt: now } }));
}

/** Who is calling, within their allowance. With no key, the anonymous
    per-IP limit; with a key, the key's own per-minute rate. A key that is
    presented but unknown or revoked is refused outright rather than read
    as anonymous: a site whose key was revoked should hear it, not find
    itself quietly throttled. Returns the key (null for nobody) or the
    Response to send back. */
export async function access(
  ctx: APIContext,
  anon: { bucket: string; max: number; window: `${number} ${"s" | "m" | "h" | "d"}` } = { bucket: "api-read", max: 120, window: "1 m" },
): Promise<{ key: ApiKeyDoc | null } | Response> {
  const found = await lookup(bearer(ctx));
  if (found === "invalid") return INVALID();
  if (!found) return (await limitIp(ctx, anon.bucket, anon.max, anon.window)) ?? { key: null };
  const r = await rateLimit("key", found.prefix, found.rate, "1 m");
  if (!r.ok) return tooMany(r.reset, "Rate limit for this key reached.");
  touch(found);
  return { key: found };
}

/** A valid key with `scope` (admin holds every scope), within its rate;
    otherwise the Response to send back. */
export async function requireScope(ctx: APIContext, scope: Scope): Promise<ApiKeyDoc | Response> {
  const found = await lookup(bearer(ctx));
  if (found === "invalid") return INVALID();
  if (!found) return error(401, "An API key is required: Authorization: Bearer rmk_…");
  if (!hasScope(found, scope)) return error(403, `This key lacks the ${scope} scope.`);
  const r = await rateLimit("key", found.prefix, found.rate, "1 m");
  if (!r.ok) return tooMany(r.reset, "Rate limit for this key reached.");
  touch(found);
  return found;
}

/** Caching for a read: shared by the CDN when nobody's key is in it, never
    when one is. */
export const readCache = (key: ApiKeyDoc | null, sMaxAge: number) => (key ? NO_STORE : cacheFor(sMaxAge));

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
