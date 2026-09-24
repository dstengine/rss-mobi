import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { SAMPLE_PER_DAY, inspectOpenPages, type PageStore } from "../src/lib/pagecheck.ts";
import { QuotaExceeded, type Inspection } from "../src/lib/gsc.ts";
import type { IndexStatus } from "../src/lib/types.ts";

type Row = { _id: ObjectId; visible: boolean; indexStatus: IndexStatus; robots: null; pageCheckedAt?: Date; pageVerdict?: string };

const open = (checkedAt?: Date): Row => ({ _id: new ObjectId(), visible: true, indexStatus: "not_indexed", robots: null, ...(checkedAt ? { pageCheckedAt: checkedAt } : {}) });

function memStore(rows: Row[]): PageStore {
  return {
    async due(before, limit) {
      return rows
        .filter((r) => !r.pageCheckedAt || r.pageCheckedAt < before)
        .sort((a, b) => (a.pageCheckedAt?.getTime() ?? 0) - (b.pageCheckedAt?.getTime() ?? 0))
        .slice(0, limit);
    },
    async record(id, result, at) {
      Object.assign(rows.find((r) => r._id.equals(id))!, { pageVerdict: result.verdict, pageCheckedAt: at });
    },
  };
}

describe("page check", () => {
  test("never-inspected pages first, then the oldest; a page inspected this week waits", async () => {
    const now = new Date("2026-10-10T10:00:00Z");
    const fresh = open(new Date("2026-10-08T00:00:00Z"));
    const old = open(new Date("2026-09-20T00:00:00Z"));
    const never = open();
    const rows = [fresh, old, never];
    const asked: string[] = [];
    const inspect = async (url: string): Promise<Inspection> => (asked.push(url), { verdict: url.includes(String(never._id)) ? "PASS" : "NEUTRAL" });
    const report = await inspectOpenPages(Date.now() + 10_000, { inspect, store: memStore(rows), now: () => now, configured: true });
    assert.deepEqual(asked, [`https://rss.mobi/item/${never._id}/`, `https://rss.mobi/item/${old._id}/`]);
    assert.equal(report.inspected, 2);
    assert.equal(report.indexed, 1);
    assert.equal(never.pageVerdict, "PASS");
    assert.equal(fresh.pageVerdict, undefined);
  });

  test("no more than the day's sample, across runs", async () => {
    const now = new Date("2026-10-11T10:00:00Z");
    const rows = Array.from({ length: SAMPLE_PER_DAY + 5 }, () => open());
    const deps = { inspect: async () => ({ verdict: "NEUTRAL" }), store: memStore(rows), now: () => now, configured: true };
    assert.equal((await inspectOpenPages(Date.now() + 10_000, deps)).inspected, SAMPLE_PER_DAY);
    const again = await inspectOpenPages(Date.now() + 10_000, deps);
    assert.equal(again.inspected, 0);
    assert.match(again.stopped!, /sample is done/);
  });

  test("a failure ends the run without recording anything", async () => {
    const now = new Date("2026-10-12T10:00:00Z");
    const rows = [open(), open()];
    const quota = await inspectOpenPages(Date.now() + 10_000, {
      inspect: async () => {
        throw new QuotaExceeded("gsc: 2000 inspections already used today");
      },
      store: memStore(rows),
      now: () => now,
      configured: true,
    });
    assert.equal(quota.inspected + quota.failed, 0);
    assert.match(quota.stopped!, /already used/);
    let calls = 0;
    const broken = await inspectOpenPages(Date.now() + 10_000, {
      inspect: async () => {
        calls++;
        throw new Error("gsc: HTTP 403");
      },
      store: memStore(rows),
      now: () => now,
      configured: true,
    });
    assert.equal(calls, 1);
    assert.equal(broken.failed, 1);
    assert.ok(rows.every((r) => !r.pageCheckedAt));
  });

  test("without the service account the step does nothing", async () => {
    const report = await inspectOpenPages(Date.now() + 10_000, { store: memStore([open()]), configured: false });
    assert.equal(report.inspected, 0);
    assert.match(report.stopped!, /GSC_SERVICE_ACCOUNT/);
  });
});
