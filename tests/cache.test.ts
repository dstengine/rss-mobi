// The rate limiter with a Redis that answers errors. On 24 Oct 2026 the
// Upstash plan's monthly command quota ran out and every API read answered
// 500, because the limiter's error went uncaught while the cache's did not.
// The limiter must fall back to the in-process stand-in instead.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

process.env.KV_REST_API_URL = "https://redis.test.invalid";
process.env.KV_REST_API_TOKEN = "test-token";

const { rateLimit, redis } = await import("../src/lib/cache.ts");

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
