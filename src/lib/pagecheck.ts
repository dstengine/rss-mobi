// Does Google take the post pages we open? The index check decides that a
// page may be indexed; this asks Search Console whether it was. Each
// index-check run spends what time it has left on URL Inspection, up to
// SAMPLE_PER_DAY pages a day (a tenth of the property's quota), the pages
// never asked about first, then those asked longest ago, each at most once
// a week. The answer is kept on the item, so the retro can say how many
// open pages Google has.
import type { ObjectId } from "mongodb";
import { items } from "./db.ts";
import { count, counter } from "./cache.ts";
import { QuotaExceeded, inspect as gscInspect, serviceAccount, type Inspection } from "./gsc.ts";
import { policy } from "./policy.ts";
import { OPEN_ITEMS } from "./sitemaps.ts";
import { itemPath } from "./views.ts";
import { utcDay } from "./budget.ts";
import { site } from "../site.config.ts";
import type { ItemDoc } from "./types.ts";

export const SAMPLE_PER_DAY = 200;
const RECHECK_MS = 7 * 86_400_000;

type Open = Pick<ItemDoc, "_id" | "visible" | "indexStatus" | "robots">;

export interface PageStore {
  /** Open post pages not inspected since `before`, never-inspected first. */
  due(before: Date, limit: number): Promise<Open[]>;
  record(id: ObjectId, result: Inspection, at: Date): Promise<void>;
}

export function mongoPageStore(): PageStore {
  return {
    async due(before, limit) {
      return (await items())
        .find(
          { $and: [OPEN_ITEMS, { $or: [{ pageCheckedAt: { $exists: false } }, { pageCheckedAt: { $lt: before } }] }] },
          { projection: { _id: 1, visible: 1, indexStatus: 1, robots: 1 } },
        )
        .sort({ pageCheckedAt: 1, _id: 1 })
        .limit(limit)
        .toArray();
    },
    async record(id, result, at) {
      await (await items()).updateOne({ _id: id }, { $set: { pageVerdict: result.verdict ?? "UNKNOWN", pageCoverage: result.coverageState ?? "", pageCheckedAt: at } });
    },
  };
}

export interface PageReport {
  inspected: number;
  /** Of those, how many Google has in its index (verdict PASS). */
  indexed: number;
  failed: number;
  stopped?: string;
}

export interface PageDeps {
  inspect: (url: string) => Promise<Inspection>;
  store: PageStore;
  now: () => Date;
  configured: boolean;
}

const sampleKey = (day: string) => `gsc:sample:${day}`;

export async function inspectOpenPages(deadline: number, deps: Partial<PageDeps> = {}): Promise<PageReport> {
  const d: PageDeps = {
    inspect: deps.inspect ?? gscInspect,
    store: deps.store ?? mongoPageStore(),
    now: deps.now ?? (() => new Date()),
    configured: deps.configured ?? !!serviceAccount(),
  };
  const report: PageReport = { inspected: 0, indexed: 0, failed: 0 };
  if (!d.configured) return { ...report, stopped: "GSC_SERVICE_ACCOUNT is not set" };
  const now = d.now();
  const day = utcDay(now);
  const left = SAMPLE_PER_DAY - (await counter(sampleKey(day)));
  if (left <= 0) return { ...report, stopped: "today's sample is done" };

  const due = await d.store.due(new Date(now.getTime() - RECHECK_MS), left);
  for (const item of due) {
    if (Date.now() >= deadline) break;
    // The query already asks for open pages; policy() has the last word.
    if (!policy({ type: "item", item, feed: { status: "active" } }).sitemap) continue;
    // Counted before the call, like every other quota here.
    if ((await count(sampleKey(day))) > SAMPLE_PER_DAY) break;
    try {
      const result = await d.inspect(`${site.url}${itemPath(String(item._id))}`);
      await d.store.record(item._id, result, d.now());
      report.inspected++;
      if (result.verdict === "PASS") report.indexed++;
    } catch (e) {
      // Whatever broke — the quota, the key, the network — the next run
      // tries again; this one does not spend the day's sample on it.
      if (!(e instanceof QuotaExceeded)) report.failed++;
      return { ...report, stopped: (e as Error).message };
    }
  }
  return report;
}
