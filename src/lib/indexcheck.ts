// The index-check queue: is each post's original in Google's index?
//
// Every new item joins the queue with `indexNextCheckAt` = the moment it
// arrived, and checks go out in that order. A run first collects the
// answers to tasks it filed earlier, then files the next batch — as many as
// today's `serp` budget still covers, at most 100.
//
// Spending is watched four ways. The batch is reserved against
// LIMITS.serp before the POST and settled to the real cost after it. The
// balance is read once a day, and Telegram hears when it is low. An
// account-level refusal (payment, rate limit, credentials) pauses checks
// until 00:00 UTC instead of retrying into it. And each check's cost is
// logged in `index_checks` beside its verdict.
//
// A verdict that opens or closes a post's page flags it for IndexNow, and
// the end of every run tells Bing and Yandex about the flagged pages.
import type { ObjectId } from "mongodb";
import { indexChecks, items, spend } from "./db.ts";
import { count, counter, lock, unlock } from "./cache.ts";
import { alert as telegram, indexNow } from "./notify.ts";
import { BudgetExceeded, LIMITS, headroom, reserve, settle, utcDay, type Ledger } from "./budget.ts";
import { CHECK_USD, MAX_TASKS, SerpStop, dataForSeo, keywordFor, listed, type Collected, type Posted, type SerpApi } from "./serp.ts";
import { itemPath } from "./views.ts";
import type { IndexStatus, ItemDoc } from "./types.ts";

const DAY = 86_400_000;
/** A task is not asked for sooner than this after it was filed. */
const SETTLE_MS = 60_000;
/** A task that has not come back in a day is filed again. */
const LOST_MS = DAY;
/** Below this many days of the ceiling, the balance is worth a message. */
export const LOW_BALANCE_DAYS = 10;

export type Verdict = "indexed" | "not_indexed" | "error";

export type Queued = Pick<ItemDoc, "_id" | "url" | "canonicalUrl" | "indexStatus" | "indexChecks" | "serpTaskId" | "serpPostedAt" | "serpCost">;

const hasVerdict = (s: IndexStatus) => s === "indexed" || s === "not_indexed";

/** Days until the next check, after `n` checks that reached a verdict.
    The first week decides most cases: days 1, 3 and 7, then weekly while
    the original is still missing. Once Google has the original it seldom
    lets go, and checking every such post weekly would take most of the
    budget, so those are checked monthly. A failed check is retried the
    next day. */
export function nextCheckIn(n: number, verdict: Verdict): number {
  if (verdict === "error") return 1;
  if (verdict === "indexed") return 30;
  return [1, 2, 4][n - 1] ?? 7;
}

/** What a check changes on the item. A failed recheck keeps the last
    verdict, so a page does not leave the index because an API hiccuped;
    and the page's date moves only when its robots do, so the sitemap's
    `lastmod` means something. The same moment flags it for IndexNow. */
export function afterCheck(item: Pick<ItemDoc, "indexStatus" | "indexChecks">, verdict: Verdict, at: Date) {
  const indexStatus: IndexStatus = verdict === "error" && hasVerdict(item.indexStatus) ? item.indexStatus : verdict;
  const checks = item.indexChecks + (verdict === "error" ? 0 : 1);
  const opens = (s: IndexStatus) => s === "not_indexed";
  return {
    indexStatus,
    indexChecks: checks,
    indexCheckedAt: at,
    indexNextCheckAt: new Date(at.getTime() + nextCheckIn(checks, verdict) * DAY),
    ...(opens(indexStatus) !== opens(item.indexStatus) ? { updatedAt: at, announce: true as const } : {}),
  };
}

/* ---------------------------------------------------------------- store */

export interface Store {
  /** Visible items whose check is due, the longest-waiting first. */
  due(now: Date, limit: number): Promise<Queued[]>;
  /** Items with a task filed before `before`, the oldest first. */
  inFlight(before: Date, limit: number): Promise<Queued[]>;
  posted(item: Queued, taskId: string, cost: number, at: Date): Promise<void>;
  checked(item: Queued, verdict: Verdict, at: Date, note?: string): Promise<void>;
  /** Back to the front of the queue: the task was lost. */
  requeue(item: Queued, at: Date, note: string): Promise<void>;
  /** Items whose page opened or closed since IndexNow last heard. */
  unannounced(limit: number): Promise<{ _id: ObjectId }[]>;
  announced(ids: ObjectId[]): Promise<void>;
}

const FIELDS = { url: 1, canonicalUrl: 1, indexStatus: 1, indexChecks: 1, serpTaskId: 1, serpPostedAt: 1, serpCost: 1 } as const;
const NO_TASK = { serpTaskId: "", serpPostedAt: "", serpCost: "" } as const;

async function log(itemId: ObjectId, at: Date, verdict: Verdict | "lost", usd: number, note?: string) {
  await (await indexChecks()).insertOne({ itemId, at, method: "dataforseo", verdict, usd, ...(note ? { note: note.slice(0, 200) } : {}) });
}

export function mongoStore(): Store {
  return {
    async due(now, limit) {
      return (await items()).find({ visible: true, indexNextCheckAt: { $lte: now } }, { projection: FIELDS }).sort({ indexNextCheckAt: 1 }).limit(limit).toArray();
    },
    async inFlight(before, limit) {
      return (await items()).find({ serpTaskId: { $exists: true }, serpPostedAt: { $lte: before } }, { projection: FIELDS }).sort({ serpPostedAt: 1 }).limit(limit).toArray();
    },
    async posted(item, taskId, cost, at) {
      // Out of the due list while the task is in flight; a first check
      // shows as pending, a recheck keeps its verdict meanwhile.
      await (await items()).updateOne(
        { _id: item._id },
        { $set: { serpTaskId: taskId, serpPostedAt: at, serpCost: cost, indexNextCheckAt: null, ...(hasVerdict(item.indexStatus) ? {} : { indexStatus: "pending" as const }) } },
      );
    },
    async checked(item, verdict, at, note) {
      await (await items()).updateOne({ _id: item._id }, { $set: afterCheck(item, verdict, at), $unset: NO_TASK });
      await log(item._id, at, verdict, item.serpCost ?? 0, note);
    },
    async requeue(item, at, note) {
      await (await items()).updateOne(
        { _id: item._id },
        { $set: { indexNextCheckAt: at, ...(hasVerdict(item.indexStatus) ? {} : { indexStatus: "queued" as const }) }, $unset: NO_TASK },
      );
      await log(item._id, at, "lost", item.serpCost ?? 0, note);
    },
    async unannounced(limit) {
      return (await items()).find({ announce: true }, { projection: { _id: 1 } }).limit(limit).toArray();
    },
    async announced(ids) {
      await (await items()).updateMany({ _id: { $in: ids } }, { $unset: { announce: "" } });
    },
  };
}

/* ------------------------------------------------------------------ run */

export interface Report {
  collected: number;
  indexed: number;
  notIndexed: number;
  failed: number;
  requeued: number;
  posted: number;
  usd: number;
  /** Pages IndexNow accepted news of in this run. */
  announced: number;
  balance?: number;
  stopped?: string;
}

export interface Deps {
  api: SerpApi | null;
  store: Store;
  ledger: Ledger;
  alert: (text: string) => Promise<void>;
  /** Returns the HTTP status, or null when nothing was sent. */
  indexNow: (paths: string[]) => Promise<number | null>;
  now: () => Date;
}

const pausedKey = (day: string) => `serp:paused:${day}`;

/** Stops posting until 00:00 UTC, and says so once. */
export async function pause(alert: Deps["alert"], day: string, why: string): Promise<void> {
  if ((await count(pausedKey(day))) === 1) await alert(`index checks paused until 00:00 UTC: ${why}`);
}

export const isPaused = async (day: string) => (await counter(pausedKey(day))) > 0;

/** One run: collect, then post, until `deadline` (ms since epoch). */
export async function runIndexCheck(deadline: number, deps: Partial<Deps> = {}): Promise<Report> {
  const d: Deps = {
    api: "api" in deps ? (deps.api ?? null) : dataForSeo(),
    store: deps.store ?? mongoStore(),
    ledger: deps.ledger ?? (await spend()),
    alert: deps.alert ?? telegram,
    indexNow: deps.indexNow ?? indexNow,
    now: deps.now ?? (() => new Date()),
  };
  const report: Report = { collected: 0, indexed: 0, notIndexed: 0, failed: 0, requeued: 0, posted: 0, usd: 0, announced: 0 };
  if (!d.api) return { ...report, stopped: "DataForSEO credentials are not set" };
  if (!(await lock("index-check", 90))) return { ...report, stopped: "another run is in progress" };
  const day = utcDay(d.now());
  try {
    try {
      await collect(d, deadline, report);
      if (Date.now() < deadline) await post(d, day, report);
    } catch (e) {
      if (!(e instanceof SerpStop)) throw e;
      report.stopped = e.message;
      await pause(d.alert, day, e.message);
    }
    await announce(d, report);
  } finally {
    await unlock("index-check");
  }
  return report;
}

/** Tells IndexNow about every page that opened or closed. The flag is
    cleared only once a search engine accepted the list, so a missing key
    or a failed ping leaves it for the next run. */
async function announce(d: Deps, report: Report): Promise<void> {
  const rows = await d.store.unannounced(1_000);
  if (!rows.length) return;
  const status = await d.indexNow(rows.map((r) => itemPath(String(r._id))));
  if (status !== 200 && status !== 202) return;
  await d.store.announced(rows.map((r) => r._id));
  report.announced = rows.length;
}

async function collect(d: Deps, deadline: number, report: Report): Promise<void> {
  const flying = await d.store.inFlight(new Date(d.now().getTime() - SETTLE_MS), MAX_TASKS);
  // Five at a time: a hundred fit well inside the deadline, and the API's
  // limit is 2,000 calls a minute.
  for (let i = 0; i < flying.length && Date.now() < deadline; i += 5) {
    await Promise.all(flying.slice(i, i + 5).map((item) => collectOne(d, item, report)));
  }
}

async function collectOne(d: Deps, item: Queued, report: Report): Promise<void> {
  const at = d.now();
  let r: Collected;
  try {
    r = await d.api!.collect(item.serpTaskId!);
  } catch (e) {
    if (e instanceof SerpStop) throw e;
    console.error("index check: collect failed, next run tries again", (e as Error).message);
    return;
  }
  if (r.state === "ready") {
    const verdict = listed(r.urls, item.canonicalUrl) ? "indexed" : "not_indexed";
    await d.store.checked(item, verdict, at);
    report.collected++;
    if (verdict === "indexed") report.indexed++;
    else report.notIndexed++;
  } else if (r.state === "waiting") {
    if (at.getTime() - (item.serpPostedAt?.getTime() ?? 0) < LOST_MS) return;
    await d.store.requeue(item, at, "no answer in a day");
    report.requeued++;
  } else if (r.state === "gone") {
    await d.store.requeue(item, at, `task gone (${r.code})`);
    report.requeued++;
  } else {
    await d.store.checked(item, "error", at, `${r.code} ${r.message}`);
    report.failed++;
  }
}

async function post(d: Deps, day: string, report: Report): Promise<void> {
  if (await isPaused(day)) {
    report.stopped = "paused until 00:00 UTC";
    return;
  }
  await watchBalance(d, day, report);

  const due = await d.store.due(d.now(), MAX_TASKS);
  if (!due.length) return;
  const n = Math.min(due.length, Math.floor((await headroom(d.ledger, "serp", day)) / CHECK_USD + 1e-9));
  if (!n) {
    report.stopped = "today's serp budget is spent";
    if ((await count(`serp:spent:${day}`)) === 1) await d.alert(`index checks: the $${LIMITS.serp} daily budget is spent; posts wait in the queue until 00:00 UTC`);
    return;
  }

  const at = d.now();
  const tasks: { keyword: string; tag: string; item: Queued }[] = [];
  for (const item of due.slice(0, n)) {
    const keyword = keywordFor(item.url);
    if (keyword) tasks.push({ keyword, tag: String(item._id), item });
    else {
      await d.store.checked(item, "error", at, "no site: query fits this URL");
      report.failed++;
    }
  }
  if (!tasks.length) return;

  const reserved = tasks.length * CHECK_USD;
  try {
    await reserve(d.ledger, "serp", reserved, `${tasks.length} index checks`, day);
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
    report.stopped = e.message;
    return;
  }
  let res: Posted;
  try {
    res = await d.api!.post(tasks.map(({ keyword, tag }) => ({ keyword, tag })));
  } catch (e) {
    // A refusal is answered before anything runs, so nothing was charged.
    // A POST lost on the network may have been, and its reservation stands.
    if (e instanceof SerpStop) await settle(d.ledger, "serp", -reserved, day);
    throw e;
  }
  await settle(d.ledger, "serp", res.cost - reserved, day);
  report.usd += res.cost;

  const byTag = new Map(tasks.map((t) => [t.tag, t.item]));
  for (const t of res.tasks) {
    const item = byTag.get(t.tag);
    if (!item) continue;
    if (t.id) {
      await d.store.posted(item, t.id, t.cost, at);
      report.posted++;
    } else {
      await d.store.checked(item, "error", at, `${t.code} ${t.message}`);
      report.failed++;
    }
  }
}

/** Once a day: the account's balance, and a message when it runs low. */
async function watchBalance(d: Deps, day: string, report: Report): Promise<void> {
  if ((await count(`serp:balance:${day}`)) !== 1) return;
  try {
    report.balance = await d.api!.balance();
  } catch (e) {
    if (e instanceof SerpStop) throw e;
    console.error("index check: balance unread", (e as Error).message);
    return;
  }
  if (report.balance < LOW_BALANCE_DAYS * LIMITS.serp) {
    await d.alert(`DataForSEO balance is $${report.balance.toFixed(2)}, under ${LOW_BALANCE_DAYS} days of the $${LIMITS.serp} daily budget. Top up at https://app.dataforseo.com/`);
  }
}
