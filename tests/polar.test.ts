import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { isPolarKey, polarLookup } from "../src/lib/polar.ts";
import { lookup } from "../src/lib/keys.ts";

// Keys Polar would grant us: prefix, a separator, the body it generates.
const key = (n: number) => `RSSMOBI-${String(n).padStart(8, "0")}-4F1B-4C6B-9E3A-1B2C3D4E5F60`;
const granted = (expires_at: string | null = null) => ({ status: "granted", expires_at, benefit_id: "ben-1", customer: { id: "cus-1" } });

type Answer = { status: number; body?: unknown } | Error;
let answers: Answer[] = [];
let asked: { url: string; body: any }[] = [];
const realFetch = globalThis.fetch;

describe("Polar keys", () => {
  before(() => {
    process.env.POLAR_ORGANIZATION_ID = "org-test";
    globalThis.fetch = (async (url: any, init: any) => {
      asked.push({ url: String(url), body: JSON.parse(init.body) });
      const a = answers.shift();
      if (!a) throw new Error("test: no answer queued");
      if (a instanceof Error) throw a;
      return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status });
    }) as typeof fetch;
  });
  after(() => {
    globalThis.fetch = realFetch;
    delete process.env.POLAR_ORGANIZATION_ID;
  });

  test("the shape: our prefix, then the body Polar generated", () => {
    assert.ok(isPolarKey(key(1)));
    assert.ok(isPolarKey("RSSMOBI_7c1d0a9e4f1b4c6b9e3a1b2c3d4e5f60"));
    assert.ok(!isPolarKey("rmk_abcdefghijklmnopqrstuvwxyz"));
    assert.ok(!isPolarKey("RSSMOBI"));
    assert.ok(!isPolarKey("OTHER-7C1D0A9E-4F1B-4C6B-9E3A-1B2C3D4E5F60"));
    assert.ok(!isPolarKey("RSSMOBI-<script>"));
  });

  test("a granted key reads with read:full at the default rate, and is asked about once", async () => {
    answers = [{ status: 200, body: granted("2099-01-01T00:00:00Z") }];
    asked = [];
    const a = await polarLookup(key(2));
    assert.ok(typeof a === "object");
    assert.deepEqual(a.scopes, ["read:full"]);
    assert.equal(a.rate, 600);
    assert.equal(a.via, "polar");
    assert.equal(a._id, undefined);
    assert.ok(a.prefix.startsWith("pl_"));
    assert.equal(a.expiresAt?.getUTCFullYear(), 2099);
    assert.equal(asked[0].url, "https://api.polar.sh/v1/customer-portal/license-keys/validate");
    assert.deepEqual(asked[0].body, { key: key(2), organization_id: "org-test" });
    // Cached: the second use costs Polar nothing.
    const b = await polarLookup(key(2));
    assert.ok(typeof b === "object" && b.prefix === a.prefix);
    assert.equal(asked.length, 1);
  });

  test("a key Polar does not know, or an expired one, is invalid", async () => {
    answers = [{ status: 404, body: { error: "ResourceNotFound" } }];
    assert.equal(await polarLookup(key(3)), "invalid");
    answers = [{ status: 200, body: granted("2020-01-01T00:00:00Z") }];
    assert.equal(await polarLookup(key(4)), "invalid");
    answers = [{ status: 422, body: {} }];
    assert.equal(await polarLookup(key(5)), "invalid");
  });

  test("Polar unreachable and nothing cached: unavailable, and not cached either", async () => {
    answers = [new Error("ECONNRESET")];
    assert.equal(await polarLookup(key(6)), "unavailable");
    answers = [{ status: 500 }];
    assert.equal(await polarLookup(key(6)), "unavailable");
    answers = [{ status: 200, body: granted() }];
    const a = await polarLookup(key(6));
    assert.ok(typeof a === "object" && a.via === "polar");
  });

  test("lookup() sends a Polar-shaped token to Polar, with the sandbox when told", async () => {
    process.env.POLAR_ENV = "sandbox";
    answers = [{ status: 200, body: granted() }];
    asked = [];
    const a = await lookup(key(7));
    assert.ok(typeof a === "object" && a?.via === "polar");
    assert.equal(asked[0].url, "https://sandbox-api.polar.sh/v1/customer-portal/license-keys/validate");
    delete process.env.POLAR_ENV;
  });

  test("where no keys are sold, a Polar-shaped token is just invalid", async () => {
    const org = process.env.POLAR_ORGANIZATION_ID;
    delete process.env.POLAR_ORGANIZATION_ID;
    asked = [];
    assert.equal(await polarLookup(key(8)), "invalid");
    assert.equal(asked.length, 0);
    process.env.POLAR_ORGANIZATION_ID = org;
  });
});
