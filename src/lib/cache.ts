// Upstash Redis: rate limits, job locks, quota counters and a short cache
// for hot responses. Every function here also works without Redis — with an
// in-process stand-in — so local development and tests need no account.
// In production the stand-in would be per-instance and nearly useless,
// which is why `redis()` logs loudly when it falls back there.
import { Redis } from "@upstash/redis";
import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { env } from "./env.ts";

let client: Redis | null | undefined;

export function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = env("KV_REST_API_URL") ?? env("UPSTASH_REDIS_REST_URL");
  const token = env("KV_REST_API_TOKEN") ?? env("UPSTASH_REDIS_REST_TOKEN");
  client = url && token ? new Redis({ url, token }) : null;
  if (!client && process.env.VERCEL_ENV === "production") console.error("cache: no Redis configured, using per-instance memory");
  return client;
}

/* ------------------------------------------------------- memory stand-in */

const mem = new Map<string, { v: unknown; exp: number }>();
const memGet = <T,>(k: string): T | null => {
  const e = mem.get(k);
  if (!e) return null;
  if (e.exp && e.exp < Date.now()) {
    mem.delete(k);
    return null;
  }
  return e.v as T;
};
const memSet = (k: string, v: unknown, ttlSec?: number) => mem.set(k, { v, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });

/* ------------------------------------------------------------ rate limit */

export interface Limited {
  ok: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

const limiters = new Map<string, Ratelimit>();

/** One line a minute per subject, not one per request: a quota that is
    spent stays spent for the rest of the month. */
const complained = new Map<string, number>();
function complain(what: string, e: unknown): void {
  const now = Date.now();
  if ((complained.get(what) ?? 0) > now - 60_000) return;
  complained.set(what, now);
  console.error(`cache: ${what} failed, using per-instance memory:`, e instanceof Error ? e.message : String(e));
}

/** `max` requests per `window` for `id` in bucket `name`. When Redis is
    configured but answers with an error — the plan's monthly command quota
    spent (24 Oct 2026: every API read answered 500 for that), the store
    unreachable — the in-process stand-in takes over, so the request is
    still answered. A limiter that is down must not take the API down with
    it; the stand-in is per instance and generous, which is the lesser harm. */
export async function rateLimit(name: string, id: string, max: number, window: Duration): Promise<Limited> {
  const r = redis();
  if (r) {
    const k = `${name}:${max}:${window}`;
    let l = limiters.get(k);
    if (!l) {
      l = new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(max, window), prefix: `rl:${name}` });
      limiters.set(k, l);
    }
    try {
      const res = await l.limit(id);
      return { ok: res.success, limit: res.limit, remaining: res.remaining, reset: res.reset };
    } catch (e) {
      complain("rate limit", e);
    }
  }
  const seconds = parseWindow(window);
  const key = `rl:${name}:${id}:${Math.floor(Date.now() / 1000 / seconds)}`;
  const n = (memGet<number>(key) ?? 0) + 1;
  memSet(key, n, seconds);
  return { ok: n <= max, limit: max, remaining: Math.max(0, max - n), reset: Date.now() + seconds * 1000 };
}

function parseWindow(w: string): number {
  const [n, unit] = w.split(" ");
  const mult: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 };
  return Math.max(1, Number(n) * (mult[unit] ?? 1));
}

/* ----------------------------------------------------------------- locks */

/** Takes `key` for `ttlSec` seconds; false if someone else holds it. When
    Redis is configured but answers an error, the in-process stand-in holds
    the lock instead: per instance, so two instances may run one job at
    once, which is the lesser harm. On 14 Oct 2026 the plan's quota ran out
    and the per-feed lock's error stopped the poller and every cron for ten
    days while the pages served. */
export async function lock(key: string, ttlSec: number): Promise<boolean> {
  const r = redis();
  if (r) {
    try {
      return (await r.set(`lock:${key}`, "1", { nx: true, ex: ttlSec })) === "OK";
    } catch (e) {
      complain("lock", e);
    }
  }
  if (memGet(`lock:${key}`)) return false;
  memSet(`lock:${key}`, 1, ttlSec);
  return true;
}

/** Releases `key` wherever it was taken: the stand-in's copy goes first,
    so a lock taken in memory while Redis was down is not left behind. */
export async function unlock(key: string): Promise<void> {
  mem.delete(`lock:${key}`);
  const r = redis();
  if (!r) return;
  try {
    await r.del(`lock:${key}`);
  } catch (e) {
    complain("unlock", e);
  }
}

/* -------------------------------------------------------------- counters */

/** Adds `by` to a counter that expires after `ttlSec`; returns the total.
    With Redis answering errors the stand-in counts instead, per instance:
    fine for a pause flag or a sample cap, wrong for a budget in dollars,
    which is what `redisUp()` is for. */
export async function count(key: string, by = 1, ttlSec = 2 * 86400): Promise<number> {
  const r = redis();
  if (r) {
    let n: number | undefined;
    try {
      n = await r.incrby(`n:${key}`, by);
    } catch (e) {
      complain("count", e);
    }
    if (n !== undefined) {
      if (n === by) await r.expire(`n:${key}`, ttlSec).catch((e) => complain("count", e));
      return n;
    }
  }
  const n = (memGet<number>(`n:${key}`) ?? 0) + by;
  memSet(`n:${key}`, n, ttlSec);
  return n;
}

export async function counter(key: string): Promise<number> {
  const r = redis();
  if (r) {
    try {
      return Number((await r.get(`n:${key}`)) ?? 0);
    } catch (e) {
      complain("count", e);
    }
  }
  return memGet<number>(`n:${key}`) ?? 0;
}

/** Whether the shared store takes writes: true with no Redis configured,
    as local development and tests count in memory on purpose; false when
    Redis is configured and a write fails. A job that spends money against
    a daily budget asks this first, since a counter kept per instance
    cannot hold a budget every instance shares. The probe writes because a
    spent quota still answers reads: probed on 24 Oct 2026, GET and PING
    passed while SET, INCRBY and DEL were refused. One command a run. */
export async function redisUp(): Promise<boolean> {
  const r = redis();
  if (!r) return true;
  try {
    await r.set("probe", "1", { ex: 60 });
    return true;
  } catch (e) {
    complain("probe", e);
    return false;
  }
}

/* ---------------------------------------------------------- short cache */

/** `fn()`, cached under `key` for `ttlSec`. Values must be JSON-safe. */
export async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const r = redis();
  const k = `c:${key}`;
  try {
    const hit = r ? await r.get<T>(k) : memGet<T>(k);
    if (hit !== null && hit !== undefined) return hit;
  } catch (e) {
    console.error("cache read failed", e);
  }
  const value = await fn();
  try {
    if (r) await r.set(k, value, { ex: ttlSec });
    else memSet(k, value, ttlSec);
  } catch (e) {
    console.error("cache write failed", e);
  }
  return value;
}
