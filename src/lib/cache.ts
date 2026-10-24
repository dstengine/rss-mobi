// Rate limits, run locks, quota counters and a short cache. The first three
// live in MongoDB, the one store the app already has (ADR 0008); the cache
// lives in process memory. Until 25 Oct 2026 all four lived in Upstash
// Redis, whose free plan's monthly command quota ran out on 14 Oct 2026 and
// took the API, the poller and every cron down with it.
//
// Every function here also works without MongoDB: with no database
// configured (local development, the tests that start no server) and
// whenever the database answers an error, an in-process stand-in counts and
// locks instead. It is per instance, so what it holds is weaker, which is
// the lesser harm. The one caller that must not run on it, the index
// check's dollar budget, asks `storeUp()` first.
import { counters, hasStore, locks } from "./db.ts";

export type Duration = `${number} ${"ms" | "s" | "m" | "h" | "d"}`;

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
const memSet = (k: string, v: unknown, ttlSec?: number) => {
  // Keys that are never read again (an address seen once) would pile up.
  if (mem.size >= 10_000) for (const [key, e] of mem) if (e.exp && e.exp < Date.now()) mem.delete(key);
  mem.set(k, { v, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
};

/** A counter in memory, with the store's rule: a count that has ended
    starts again at `by`, and a running one keeps the end it began with. */
function memBump(k: string, by: number, ttlSec: number): Tally {
  const e = mem.get(k);
  if (e && e.exp > Date.now()) {
    e.v = (e.v as number) + by;
    return { n: e.v as number, exp: e.exp };
  }
  memSet(k, by, ttlSec);
  return { n: by, exp: Date.now() + ttlSec * 1000 };
}

/** One line a minute per kind of failure, not one per request. */
const complained = new Map<string, number>();
function complain(what: string, e: unknown): void {
  const now = Date.now();
  if ((complained.get(what) ?? 0) > now - 60_000) return;
  complained.set(what, now);
  console.error(`cache: ${what} failed, using per-instance memory:`, e instanceof Error ? e.message : String(e));
}

/** MongoDB's duplicate-key error: a lock someone holds, or two first
    writers of one counter at once. */
const duplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;

/* ------------------------------------------------------------- counters */

interface Tally {
  n: number;
  /** When the count ends, in milliseconds. */
  exp: number;
}

/** Adds `by` to the count under `key` in one write. A count whose `exp`
    has passed starts again at `by` with a new end, whether or not the TTL
    index has swept it yet; a running one keeps its end. */
async function bump(key: string, by: number, ttlSec: number): Promise<Tally> {
  const now = new Date();
  const running = { $gt: ["$exp", now] };
  const update = [
    {
      $set: {
        n: { $cond: [running, { $add: ["$n", by] }, by] },
        exp: { $cond: [running, "$exp", new Date(now.getTime() + ttlSec * 1000)] },
      },
    },
  ];
  const col = await counters();
  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await col.findOneAndUpdate({ _id: key }, update, { upsert: true, returnDocument: "after" });
      if (!doc) throw new Error(`no counter came back for ${key}`);
      return { n: doc.n, exp: doc.exp.getTime() };
    } catch (e) {
      // Two first writers at once: one inserts, the other collides with it,
      // and its second try finds the document.
      if (attempt === 0 && duplicate(e)) continue;
      throw e;
    }
  }
}

/** Adds `by` to a counter that ends `ttlSec` after its first write;
    returns the total. With the database answering errors the stand-in
    counts instead, per instance: fine for a pause flag or a sample cap,
    wrong for a budget in dollars, which is what `storeUp()` is for. */
export async function count(key: string, by = 1, ttlSec = 2 * 86400): Promise<number> {
  if (hasStore()) {
    try {
      return (await bump(key, by, ttlSec)).n;
    } catch (e) {
      complain("count", e);
    }
  }
  return memBump(`n:${key}`, by, ttlSec).n;
}

export async function counter(key: string): Promise<number> {
  if (hasStore()) {
    try {
      const doc = await (await counters()).findOne({ _id: key, exp: { $gt: new Date() } });
      return doc?.n ?? 0;
    } catch (e) {
      complain("count", e);
    }
  }
  return memGet<number>(`n:${key}`) ?? 0;
}

/* ------------------------------------------------------------ rate limit */

export interface Limited {
  ok: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

/** Refused ids, until their window ends: a client that keeps asking past
    its limit costs no write until then. */
const refused = new Map<string, number>();

/** `max` requests per `window` for `id` in bucket `name`, one write a
    request. The window opens at the id's first request and closes
    `window` later, so a burst across a clock boundary gets no second
    allowance and a test never straddles one. When the database answers an
    error the stand-in takes over, so the request is still answered: a
    limiter that is down must not take the API down with it (24 Oct 2026:
    every API read answered 500 for that). */
export async function rateLimit(name: string, id: string, max: number, window: Duration): Promise<Limited> {
  const key = `rl:${name}:${id}`;
  const held = refused.get(key);
  if (held !== undefined) {
    if (held > Date.now()) return { ok: false, limit: max, remaining: 0, reset: held };
    refused.delete(key);
  }
  const ttlSec = parseWindow(window);
  let t: Tally | undefined;
  if (hasStore()) {
    try {
      t = await bump(key, 1, ttlSec);
    } catch (e) {
      complain("rate limit", e);
    }
  }
  t ??= memBump(`n:${key}`, 1, ttlSec);
  if (t.n > max) {
    if (refused.size >= 10_000) for (const [k, until] of refused) if (until <= Date.now()) refused.delete(k);
    refused.set(key, t.exp);
  }
  return { ok: t.n <= max, limit: max, remaining: Math.max(0, max - t.n), reset: t.exp };
}

function parseWindow(w: string): number {
  const [n, unit] = w.split(" ");
  const mult: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 };
  return Math.max(1, Number(n) * (mult[unit] ?? 1));
}

/* ----------------------------------------------------------------- locks */

/** Names this process in the locks it takes, so `unlock()` releases only
    its own: a run that outlived its lock does not free the next run's. */
const OWNER = crypto.randomUUID();

/** Takes `key` for `ttlSec` seconds; false if someone else holds it. One
    write: a lock that has lapsed is taken over, a missing one is created,
    and a held one makes the insert collide on the id. When the database
    answers an error the stand-in holds the lock instead: per instance, so
    two instances may run one job at once, which is the lesser harm. On 14
    Oct 2026 a lock's error stopped the poller and every cron for ten days
    while the pages served. */
export async function lock(key: string, ttlSec: number): Promise<boolean> {
  if (hasStore()) {
    const now = new Date();
    try {
      await (await locks()).updateOne(
        { _id: key, exp: { $lte: now } },
        { $set: { exp: new Date(now.getTime() + ttlSec * 1000), by: OWNER } },
        { upsert: true },
      );
      return true;
    } catch (e) {
      if (duplicate(e)) return false;
      complain("lock", e);
    }
  }
  if (memGet(`lock:${key}`)) return false;
  memSet(`lock:${key}`, 1, ttlSec);
  return true;
}

/** Releases `key` wherever this process took it: the stand-in's copy goes
    first, so a lock taken in memory while the database was down is not
    left behind. */
export async function unlock(key: string): Promise<void> {
  mem.delete(`lock:${key}`);
  if (!hasStore()) return;
  try {
    await (await locks()).deleteOne({ _id: key, by: OWNER });
  } catch (e) {
    complain("unlock", e);
  }
}

/* ---------------------------------------------------------- store probe */

/** Whether the shared store takes writes: true with no database
    configured, as local development and tests count in memory on purpose;
    false when a write fails. A job that spends money against a daily
    budget asks this first, since a counter kept per instance cannot hold a
    budget every instance shares. The probe writes because a store can
    refuse writes and still answer reads: Upstash with its quota spent did
    (24 Oct 2026), and so does an Atlas free cluster at its storage cap.
    One write a run. */
export async function storeUp(): Promise<boolean> {
  if (!hasStore()) return true;
  try {
    await (await counters()).updateOne({ _id: "probe" }, { $set: { n: 1, exp: new Date(Date.now() + 60_000) } }, { upsert: true });
    return true;
  } catch (e) {
    complain("probe", e);
    return false;
  }
}

/* ---------------------------------------------------------- short cache */

const building = new Map<string, Promise<unknown>>();

/** `fn()`, kept in this instance's memory under `key` for `ttlSec`.
    Requests that miss at once share one build. Per instance, so each warm
    instance builds it once per `ttlSec`; the pages that use it are also
    cached by the CDN. Callers get the cached value itself: copy before
    changing it. */
export async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const k = `c:${key}`;
  const hit = memGet<T>(k);
  if (hit !== null) return hit;
  let p = building.get(k) as Promise<T> | undefined;
  if (!p) {
    p = fn()
      .then((value) => {
        memSet(k, value, ttlSec);
        return value;
      })
      .finally(() => building.delete(k));
    building.set(k, p);
  }
  return p;
}
