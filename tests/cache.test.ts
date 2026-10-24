// The limiter, the locks and the counters when the shared store fails. On
// 14 Oct 2026 the store of the day, Upstash Redis, ran out of its monthly
// quota: every API read answered 500 because the limiter's error went
// uncaught, and every cron answered 500 because the lock's did. Since
// 25 Oct 2026 the store is MongoDB, which fails in its own ways: an Atlas
// free cluster at its storage cap refuses every write and still answers
// reads. Either way each function must fall back to the in-process
// stand-in, try the store once a call, say so once a minute, and the index
// check, which spends money, must stop rather than count its budget per
// instance.
//
// A stand-in client takes the place of MongoDB (src/lib/db.ts keeps it on
// globalThis): it records what it is asked and answers with the error the
// test chooses. tests/db.test.ts checks the same functions against a real
// server.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

let mode: "down" | "full" = "down";
const asked: string[] = [];
const atlasFull = () => Object.assign(new Error("you are over your space quota, using 513 MB of 512 MB"), { code: 8000 });
const unreachable = () => Object.assign(new Error("Server selection timed out after 8000 ms"), { name: "MongoServerSelectionError" });
const write = (op: string) => async () => {
  asked.push(op);
  throw mode === "full" ? atlasFull() : unreachable();
};
const fakeCollection = {
  findOneAndUpdate: write("findOneAndUpdate"),
  updateOne: write("updateOne"),
  deleteOne: write("deleteOne"),
  async findOne() {
    asked.push("findOne");
    if (mode === "down") throw unreachable();
    return null;
  },
};
(globalThis as { __rssMongo?: unknown }).__rssMongo = Promise.resolve({ db: () => ({ collection: () => fakeCollection }) });
const take = () => asked.splice(0);

const { rateLimit, lock, unlock, count, counter, storeUp, cached } = await import("../src/lib/cache.ts");

const realError = console.error;
const errors: string[] = [];
console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "));
after(() => {
  console.error = realError;
});

describe("rate limit when the store answers errors", () => {
  test("the store is asked once a request, and the stand-in answers with its own counting", async () => {
    take();
    const verdicts = [];
    for (let i = 0; i < 3; i++) verdicts.push(await rateLimit("t", "b", 2, "1 m"));
    assert.deepEqual(verdicts.map((v) => v.ok), [true, true, false], "the stand-in still limits");
    assert.equal(verdicts[2].remaining, 0);
    assert.ok(verdicts[2].reset > Date.now(), "reset is in the future");
    assert.deepEqual(take(), ["findOneAndUpdate", "findOneAndUpdate", "findOneAndUpdate"]);
  });

  test("a refused id is then held in process until its window ends, at no cost", async () => {
    const again = await rateLimit("t", "b", 2, "1 m");
    assert.equal(again.ok, false);
    assert.deepEqual(take(), []);
    assert.equal((await rateLimit("t", "other", 2, "1 m")).ok, true, "another id has its own allowance");
    take();
  });

  test("the failure is logged once a minute, not once a request", async () => {
    await rateLimit("t", "c", 5, "1 m");
    await rateLimit("t", "c", 5, "1 m");
    const lines = errors.filter((l) => l.includes("rate limit failed"));
    assert.equal(lines.length, 1, errors.join("\n"));
    assert.match(lines[0], /Server selection timed out/);
  });
});

describe("locks and counters when the store answers errors", () => {
  test("the lock is taken in memory, held, and released", async () => {
    take();
    assert.equal(await lock("job", 60), true, "taken from the stand-in");
    assert.equal(await lock("job", 60), false, "held until released");
    await unlock("job");
    assert.equal(await lock("job", 60), true, "free again");
    await unlock("job");
    assert.deepEqual(take(), ["updateOne", "updateOne", "deleteOne", "updateOne", "deleteOne"], "one store call each");
  });

  test("the counter counts in memory", async () => {
    assert.equal(await count("c"), 1);
    assert.equal(await count("c", 2), 3);
    assert.equal(await counter("c"), 3);
    assert.deepEqual(take(), ["findOneAndUpdate", "findOneAndUpdate", "findOne"]);
  });

  test("each kind of failure is logged once", async () => {
    for (const what of ["lock", "unlock", "count"]) {
      const lines = errors.filter((l) => l.includes(`cache: ${what} failed`));
      assert.equal(lines.length, 1, `${what}: ${lines.join(" | ")}`);
    }
  });

  test("storeUp() says the store is down", async () => {
    assert.equal(await storeUp(), false);
  });
});

describe("a store that answers reads and refuses writes", () => {
  test("storeUp() probes with a write and says down: a read would have passed and lied", async () => {
    mode = "full";
    take();
    assert.equal(await counter("never-written"), 0, "reads still answer");
    assert.equal(await storeUp(), false);
    assert.deepEqual(take(), ["findOne", "updateOne"]);
  });

  test("locks and counters still fall back to memory", async () => {
    assert.equal(await lock("job-full", 60), true);
    assert.equal(await lock("job-full", 60), false);
    assert.equal(await count("c-full"), 1);
    assert.equal(await count("c-full"), 2);
    mode = "down";
  });
});

describe("index check when the store refuses writes", () => {
  test("stops before taking a lock or spending", async () => {
    const { runIndexCheck } = await import("../src/lib/indexcheck.ts");
    take();
    const report = await runIndexCheck(Date.now() + 1000, {
      api: {} as never,
      store: {} as never,
      ledger: {} as never,
      alert: async () => {},
      indexNow: async () => null,
    });
    assert.match(report.stopped ?? "", /shared store refuses writes/);
    assert.equal(report.collected, 0);
    assert.equal(report.usd, 0);
    assert.deepEqual(take(), ["updateOne"], "the probe, and nothing after it");
  });
});

describe("the short cache", () => {
  test("is kept in memory, asks no store, and requests that miss at once share one build", async () => {
    take();
    let built = 0;
    const fn = async () => {
      built++;
      await new Promise((r) => setTimeout(r, 10));
      return { n: built };
    };
    const [a, b] = await Promise.all([cached("k", 60, fn), cached("k", 60, fn)]);
    assert.deepEqual([a, b], [{ n: 1 }, { n: 1 }]);
    assert.deepEqual(await cached("k", 60, fn), { n: 1 }, "a hit");
    assert.equal(built, 1);
    assert.deepEqual(take(), []);
  });

  test("a build that fails is not kept", async () => {
    await assert.rejects(cached("bad", 60, async () => Promise.reject(new Error("no"))), /no/);
    assert.deepEqual(await cached("bad", 60, async () => "ok"), "ok");
  });
});
