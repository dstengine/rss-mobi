// The limiter, the locks and the counters with a Redis that answers
// errors. On 14 Oct 2026 the Upstash plan's monthly command quota ran out:
// every API read answered 500 because the limiter's error went uncaught,
// and every cron answered 500 because the lock's did, while the cache's
// did not. All of them must fall back to the in-process stand-in instead,
// and the index check, which spends money, must stop rather than count
// its budget per instance.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

process.env.KV_REST_API_URL = "https://redis.test.invalid";
process.env.KV_REST_API_TOKEN = "test-token";

const { rateLimit, redis, lock, unlock, count, counter, redisUp } = await import("../src/lib/cache.ts");

const realFetch = globalThis.fetch;
const realError = console.error;
let fetches = 0;
const errors: string[] = [];
globalThis.fetch = (async () => {
  fetches++;
  return new Response(JSON.stringify({ error: "ERR max requests limit exceeded. Limit: 500000, Usage: 500000" }), {
    status: 429,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;
console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "));

after(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

describe("rate limit when Redis answers errors", () => {
  test("Redis is configured and is asked", async () => {
    assert.ok(redis(), "a client exists for the configured URL");
    await rateLimit("t", "a", 5, "1 m");
    assert.ok(fetches >= 1, "the limiter went to Redis first");
  });

  test("the request is answered from the in-process stand-in, with its own counting", async () => {
    const first = await rateLimit("t", "b", 2, "1 m");
    const second = await rateLimit("t", "b", 2, "1 m");
    const third = await rateLimit("t", "b", 2, "1 m");
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(third.ok, false, "the stand-in still limits");
    assert.equal(third.remaining, 0);
    assert.ok(third.reset > Date.now(), "reset is in the future");
  });

  test("the failure is logged once a minute, not once a request", async () => {
    await rateLimit("t", "c", 5, "1 m");
    await rateLimit("t", "c", 5, "1 m");
    const lines = errors.filter((l) => l.includes("rate limit failed"));
    assert.equal(lines.length, 1, errors.join("\n"));
    assert.match(lines[0], /max requests limit exceeded/);
  });
});

describe("locks and counters when Redis answers errors", () => {
  test("the lock is taken in memory, held, and released", async () => {
    assert.equal(await lock("job", 60), true, "taken from the stand-in");
    assert.equal(await lock("job", 60), false, "held until released");
    await unlock("job");
    assert.equal(await lock("job", 60), true, "free again");
    await unlock("job");
  });

  test("the counter counts in memory", async () => {
    assert.equal(await count("c"), 1);
    assert.equal(await count("c", 2), 3);
    assert.equal(await counter("c"), 3);
  });

  test("each kind of failure is logged once", async () => {
    for (const what of ["lock", "unlock", "count"]) {
      const lines = errors.filter((l) => l.includes(`cache: ${what} failed`));
      assert.equal(lines.length, 1, `${what}: ${lines.join(" | ")}`);
    }
  });

  test("redisUp() says the store is down", async () => {
    assert.equal(await redisUp(), false);
  });
});

describe("index check when Redis is down", () => {
  test("stops before taking a lock or spending", async () => {
    const { runIndexCheck } = await import("../src/lib/indexcheck.ts");
    const report = await runIndexCheck(Date.now() + 1000, {
      api: {} as never,
      store: {} as never,
      ledger: {} as never,
      alert: async () => {},
      indexNow: async () => null,
    });
    assert.match(report.stopped ?? "", /Redis is unavailable/);
    assert.equal(report.collected, 0);
    assert.equal(report.usd, 0);
  });
});
