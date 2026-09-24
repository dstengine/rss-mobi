import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { LIMITS } from "../src/lib/budget.ts";
import { afterCheck, isPaused, nextCheckIn, runIndexCheck, type Queued, type Store } from "../src/lib/indexcheck.ts";
import { CHECK_USD, SerpStop, dataForSeo, isStop, keywordFor, listed, type SerpApi } from "../src/lib/serp.ts";
import type { IndexStatus } from "../src/lib/types.ts";

type Row = Queued & { visible: boolean; indexNextCheckAt: Date | null; updatedAt?: Date };

function row(url: string, dueAt: Date, extra: Partial<Row> = {}): Row {
  return { _id: new ObjectId(), url, canonicalUrl: url.replace(/\/$/, ""), indexStatus: "queued", indexChecks: 0, visible: true, indexNextCheckAt: dueAt, ...extra };
}

/** The Mongo store's behaviour, over an array. */
function memStore(rows: Row[]) {
  const log: { url: string; verdict: string; usd: number }[] = [];
  const find = (q: Queued) => rows.find((r) => r._id.equals(q._id))!;
  const clear = (r: Row) => {
    delete r.serpTaskId;
    delete r.serpPostedAt;
    delete r.serpCost;
  };
  const verdictOf = (s: IndexStatus) => s === "indexed" || s === "not_indexed";
  const store: Store = {
    async due(now, limit) {
      return rows.filter((r) => r.visible && r.indexNextCheckAt && r.indexNextCheckAt <= now).sort((a, b) => +a.indexNextCheckAt! - +b.indexNextCheckAt!).slice(0, limit);
    },
    async inFlight(before, limit) {
      return rows.filter((r) => r.serpTaskId && r.serpPostedAt! <= before).slice(0, limit);
    },
    async posted(item, id, cost, at) {
      Object.assign(find(item), { serpTaskId: id, serpPostedAt: at, serpCost: cost, indexNextCheckAt: null }, verdictOf(item.indexStatus) ? {} : { indexStatus: "pending" });
    },
    async checked(item, verdict, at) {
      const r = find(item);
      log.push({ url: r.url, verdict, usd: r.serpCost ?? 0 });
      Object.assign(r, afterCheck(r, verdict, at));
      clear(r);
    },
    async requeue(item, at) {
      const r = find(item);
      log.push({ url: r.url, verdict: "lost", usd: r.serpCost ?? 0 });
      Object.assign(r, { indexNextCheckAt: at }, verdictOf(r.indexStatus) ? {} : { indexStatus: "queued" });
      clear(r);
    },
  };
  return { store, log };
}

/** DataForSEO, answering from a set of indexed URLs. */
function fakeApi(opts: { indexed?: string[]; refuse?: number; balance?: number } = {}) {
  const posts: { keyword: string; tag: string }[][] = [];
  const keywords = new Map<string, string>();
  const api: SerpApi = {
    async post(tasks) {
      if (opts.refuse) throw new SerpStop(`DataForSEO refused: ${opts.refuse}`, opts.refuse);
      posts.push(tasks);
      return {
        cost: +(tasks.length * 0.0028).toFixed(6),
        tasks: tasks.map((t, i) => {
          const id = `t${posts.length}-${i}`;
          keywords.set(id, t.keyword);
          return { tag: t.tag, id, code: 20100, message: "Task Created.", cost: 0.0028 };
        }),
      };
    },
    async collect(id) {
      const url = `https://${keywords.get(id)!.slice("site:".length)}`;
      return { state: "ready", urls: (opts.indexed ?? []).includes(url) ? [`${url}/?utm_source=x`] : ["https://elsewhere.example/"], total: 1 };
    },
    async balance() {
      return opts.balance ?? 100;
    },
  };
  return { api, posts };
}

function fakeLedger(spent = 0, day = "") {
  const docs = new Map<string, { _id: string; usd: number; updatedAt: Date }>();
  if (day) docs.set(`serp:${day}`, { _id: `serp:${day}`, usd: spent, updatedAt: new Date() });
  return {
    docs,
    async updateOne(filter: any, update: any, opts: any) {
      let d = docs.get(filter._id);
      if (!d && opts?.upsert) docs.set(filter._id, (d = { _id: filter._id, ...update.$setOnInsert }));
      if (d && update.$inc) d.usd = Math.round((d.usd + update.$inc.usd) * 1e6) / 1e6;
      return {} as any;
    },
    async findOneAndUpdate(filter: any, update: any) {
      const d = docs.get(filter._id);
      if (!d || !(d.usd <= filter.usd.$lte)) return null;
      d.usd = Math.round((d.usd + update.$inc.usd) * 1e6) / 1e6;
      return d as any;
    },
    async findOne(filter: any) {
      return (docs.get(filter._id) ?? null) as any;
    },
  };
}

const later = (d: Date, ms: number) => new Date(d.getTime() + ms);

describe("serp", () => {
  test("the query is site: with the host and path, never the scheme", () => {
    assert.equal(keywordFor("https://www.example.com/news/a-post/?p=2"), "site:example.com/news/a-post/?p=2");
    assert.equal(keywordFor("http://example.com/"), "site:example.com");
    assert.equal(keywordFor("javascript:alert(1)"), null);
    assert.equal(keywordFor(`https://example.com/${"a".repeat(800)}`), null);
  });

  test("a result is the original when their canonical forms match", () => {
    const original = "https://example.com/news/a-post";
    assert.ok(listed(["https://www.example.com/news/a-post/?utm_source=feed"], original));
    assert.ok(!listed(["https://example.com/news/a-post-2", "https://example.com/news"], original));
  });

  test("payment, limit and credential refusals stop the day; a queued task does not", () => {
    for (const code of [401, 402, 429, 40100, 40202, 40203, 40210]) assert.ok(isStop(code), String(code));
    for (const code of [20000, 40401, 40501, 40602, 50301]) assert.ok(!isStop(code), String(code));
  });

  test("the client reads tasks, verdicts and refusals from DataForSEO's envelope", async () => {
    process.env.DATAFORSEO_LOGIN = "someone@example.com";
    process.env.DATAFORSEO_PASSWORD = "not-a-real-one";
    const replies: unknown[] = [
      { status_code: 20000, cost: 0.006, tasks: [{ id: "a1", status_code: 20100, status_message: "Task Created.", cost: 0.003, data: { tag: "i1" } }, { status_code: 40501, status_message: "Invalid Field", data: { tag: "i2" } }] },
      { status_code: 20000, tasks: [{ status_code: 40602, status_message: "Task In Queue." }] },
      { status_code: 20000, tasks: [{ status_code: 20000, status_message: "Ok.", result: [{ se_results_count: 1, items: [{ type: "organic", url: "https://example.com/p" }, { type: "images" }] }] }] },
      { status_code: 40210, status_message: "Insufficient funds." },
    ];
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push(`${init.method} ${url}`);
      assert.match(String((init.headers as Record<string, string>).Authorization), /^Basic /);
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }) as unknown as typeof fetch;
    const api = dataForSeo(fetchImpl)!;
    const posted = await api.post([{ keyword: "site:example.com/p", tag: "i1" }, { keyword: "site:example.com/q", tag: "i2" }]);
    assert.deepEqual(posted.tasks.map((t) => [t.tag, t.id]), [["i1", "a1"], ["i2", undefined]]);
    assert.equal(posted.cost, 0.006);
    assert.deepEqual(await api.collect("a1"), { state: "waiting" });
    assert.deepEqual(await api.collect("a1"), { state: "ready", urls: ["https://example.com/p"], total: 1 });
    await assert.rejects(api.balance(), SerpStop);
    assert.match(seen[0], /^POST https:\/\/api\.dataforseo\.com\/v3\/serp\/google\/organic\/task_post$/);
  });
});

describe("index check", () => {
  test("rechecks on days 1, 3 and 7, then weekly while missing; monthly once indexed", () => {
    assert.deepEqual([1, 2, 3, 4, 5].map((n) => nextCheckIn(n, "not_indexed")), [1, 2, 4, 7, 7]);
    assert.equal(nextCheckIn(1, "indexed"), 30);
    assert.equal(nextCheckIn(4, "error"), 1);
  });

  test("a failed recheck keeps the verdict; the page's date moves only with its robots", () => {
    const at = new Date("2026-10-01T00:00:00Z");
    const kept = afterCheck({ indexStatus: "not_indexed", indexChecks: 2 }, "error", at);
    assert.equal(kept.indexStatus, "not_indexed");
    assert.equal(kept.indexChecks, 2);
    assert.equal("updatedAt" in kept, false);
    assert.equal(afterCheck({ indexStatus: "pending", indexChecks: 0 }, "indexed", at).updatedAt, undefined);
    assert.equal(afterCheck({ indexStatus: "pending", indexChecks: 0 }, "not_indexed", at).updatedAt, at);
    assert.equal(afterCheck({ indexStatus: "not_indexed", indexChecks: 1 }, "indexed", at).updatedAt, at);
  });

  test("posts go out oldest first, as many as the budget covers, and are settled to the real cost", async () => {
    const now = new Date("2026-10-01T10:00:00Z");
    const day = "2026-10-01";
    const rows = [row("https://c.example/3", later(now, -1000)), row("https://a.example/1", later(now, -3000)), row("https://b.example/2", later(now, -2000))];
    const { store, log } = memStore(rows);
    const { api, posts } = fakeApi({ indexed: ["https://a.example/1"] });
    const before = LIMITS.serp - 2 * CHECK_USD;
    const ledger = fakeLedger(before, day);
    const alerts: string[] = [];
    const deps = { api, store, ledger, alert: async (t: string) => void alerts.push(t), now: () => now };

    const first = await runIndexCheck(Date.now() + 10_000, deps);
    assert.equal(first.posted, 2);
    assert.deepEqual(posts[0].map((t) => t.keyword), ["site:a.example/1", "site:b.example/2"]);
    assert.equal(ledger.docs.get(`serp:${day}`)!.usd, +(before + 2 * 0.0028).toFixed(6));
    assert.deepEqual(rows.map((r) => r.indexStatus), ["queued", "pending", "pending"]);

    // Two minutes later the answers are in.
    const second = await runIndexCheck(Date.now() + 10_000, { ...deps, now: () => later(now, 120_000) });
    assert.equal(second.collected, 2);
    assert.equal(rows[1].indexStatus, "indexed");
    assert.equal(rows[2].indexStatus, "not_indexed");
    assert.equal(rows[2].indexNextCheckAt!.getTime(), later(now, 120_000 + 86_400_000).getTime());
    assert.deepEqual(log.map((l) => l.usd), [0.0028, 0.0028]);
    // The third waits for tomorrow's budget, and that is said once.
    assert.equal(rows[0].indexStatus, "queued");
    assert.equal(second.stopped, "today's serp budget is spent");
    assert.equal(alerts.length, 1);
  });

  test("at the ceiling nothing is posted, and the day's alert is sent once", async () => {
    const now = new Date("2026-10-02T10:00:00Z");
    const { store } = memStore([row("https://a.example/1", later(now, -1000))]);
    const { api, posts } = fakeApi();
    const alerts: string[] = [];
    const deps = { api, store, ledger: fakeLedger(LIMITS.serp, "2026-10-02"), alert: async (t: string) => void alerts.push(t), now: () => now };
    const report = await runIndexCheck(Date.now() + 10_000, deps);
    await runIndexCheck(Date.now() + 10_000, deps);
    assert.equal(posts.length, 0);
    assert.match(report.stopped!, /budget is spent/);
    assert.equal(alerts.length, 1);
  });

  test("a refusal refunds the reservation and pauses the day: later runs post nothing", async () => {
    const now = new Date("2026-10-03T10:00:00Z");
    const day = "2026-10-03";
    const { store } = memStore([row("https://a.example/1", later(now, -1000))]);
    const ledger = fakeLedger(0, day);
    const alerts: string[] = [];
    const refusing = fakeApi({ refuse: 40210 });
    const report = await runIndexCheck(Date.now() + 10_000, { api: refusing.api, store, ledger, alert: async (t) => void alerts.push(t), now: () => now });
    assert.match(report.stopped!, /40210/);
    assert.equal(ledger.docs.get(`serp:${day}`)!.usd, 0);
    assert.ok(await isPaused(day));

    const willing = fakeApi();
    const again = await runIndexCheck(Date.now() + 10_000, { api: willing.api, store, ledger, alert: async (t) => void alerts.push(t), now: () => later(now, 900_000) });
    assert.equal(willing.posts.length, 0);
    assert.match(again.stopped!, /paused/);
    assert.equal(alerts.filter((a) => /paused/.test(a)).length, 1);
  });

  test("a low balance is reported once a day", async () => {
    const now = new Date("2026-10-04T10:00:00Z");
    const { store } = memStore([]);
    const { api } = fakeApi({ balance: 3.5 });
    const alerts: string[] = [];
    const deps = { api, store, ledger: fakeLedger(), alert: async (t: string) => void alerts.push(t), now: () => now };
    assert.equal((await runIndexCheck(Date.now() + 10_000, deps)).balance, 3.5);
    await runIndexCheck(Date.now() + 10_000, deps);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /\$3\.50/);
  });

  test("without credentials the job does nothing", async () => {
    const { store } = memStore([row("https://a.example/1", new Date(0))]);
    const report = await runIndexCheck(Date.now() + 10_000, { api: null, store, ledger: fakeLedger(), alert: async () => {} });
    assert.equal(report.posted, 0);
    assert.match(report.stopped!, /credentials/);
  });
});
