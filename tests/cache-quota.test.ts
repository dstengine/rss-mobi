// Upstash with the monthly quota spent, as probed on 24 Oct 2026: reads
// (GET, PING) still answer, writes (SET, INCRBY, DEL) are refused. A probe
// that reads would call the store up while every counter fails.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

process.env.KV_REST_API_URL = "https://redis.test.invalid";
process.env.KV_REST_API_TOKEN = "test-token";

const { redisUp, lock, count, redis } = await import("../src/lib/cache.ts");

const realFetch = globalThis.fetch;
const realError = console.error;
const commands: string[] = [];
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  const parsed = JSON.parse(String(init?.body ?? "[]"));
  const cmd = String(Array.isArray(parsed[0]) ? parsed[0][0] : parsed[0]).toLowerCase();
  commands.push(cmd);
  if (cmd === "get" || cmd === "ping") return json({ result: cmd === "ping" ? "PONG" : null }, 200);
  return json({ error: "ERR max requests limit exceeded. Limit: 500000, Usage: 500000" }, 429);
}) as typeof fetch;
console.error = () => {};

after(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

describe("Redis with the quota spent: reads pass, writes fail", () => {
  test("redisUp() probes with a write and says down", async () => {
    assert.ok(redis(), "a client exists for the configured URL");
    assert.equal(await redisUp(), false);
    assert.ok(commands.includes("set"), `the probe wrote; commands seen: ${commands.join(",")}`);
    assert.ok(!commands.includes("get") && !commands.includes("ping"), "a read would have passed and lied");
  });

  test("locks and counters still fall back to memory", async () => {
    assert.equal(await lock("job", 60), true);
    assert.equal(await count("c"), 1);
    assert.equal(await count("c"), 2);
  });
});
