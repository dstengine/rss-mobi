// What each operation in src/lib/cache.ts costs in Upstash commands,
// counted at the REST client against a stand-in that answers like Redis
// (tests/fixtures/fake-redis.ts). Upstash bills by command, 500 000 a
// month on the free plan, and these are the figures behind the 2026-10-25
// entry in docs/learnings.md: the poller's per-feed lock was two of them a
// poll, some 24 000 a day; the limiter is one a request.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { installFakeRedis } from "./fixtures/fake-redis.ts";

const fake = installFakeRedis();
const { cached, count, counter, lock, rateLimit, redis, redisUp, unlock } = await import("../src/lib/cache.ts");
after(() => fake.restore());

describe("Upstash commands per operation", () => {
  test("Redis is configured, and the probe is one write: a spent quota still answers reads", async () => {
    assert.ok(redis(), "a client exists for the configured URL");
    assert.equal(await redisUp(), true);
    assert.deepEqual(fake.take(), ["set"]);
  });

  test("a lock is two: SET NX to take it, DEL to release it — a poll's whole Redis bill before 25 Oct 2026", async () => {
    assert.equal(await lock("feed:1", 120), true);
    assert.equal(await lock("feed:1", 120), false, "held: a second taker is refused");
    await unlock("feed:1");
    assert.deepEqual(fake.take(), ["set", "set", "del"]);
    assert.equal(await lock("feed:1", 120), true, "free again");
    fake.take();
  });

  test("a counter is INCRBY, plus one EXPIRE when it is new; reading it is a GET", async () => {
    assert.equal(await count("c"), 1);
    assert.equal(await count("c"), 2);
    assert.equal(await counter("c"), 2);
    assert.deepEqual(fake.take(), ["incrby", "expire", "incrby", "get"]);
  });

  test("the limiter is one script call a request; a refused id is then remembered in process until its window turns", async () => {
    const verdicts: boolean[] = [];
    for (let i = 0; i < 4; i++) verdicts.push((await rateLimit("t", "a", 2, "1 m")).ok);
    assert.deepEqual(verdicts, [true, true, false, false]);
    assert.deepEqual(fake.take(), ["evalsha", "evalsha", "evalsha"], "the fourth request cost nothing");
  });

  test("the short cache is a GET, and a SET on a miss", async () => {
    let built = 0;
    const fn = async () => ({ n: ++built });
    assert.deepEqual(await cached("k", 60, fn), { n: 1 });
    assert.deepEqual(await cached("k", 60, fn), { n: 1 });
    assert.equal(built, 1, "the second read was a hit");
    assert.deepEqual(fake.take(), ["get", "set", "get"]);
  });
});
