// public/sw.js, run in a sandbox with a Cache API that behaves like the
// real one (every match is a fresh copy whose body can be read once) and a
// network the test controls. Timers run a thousand times faster.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://rss.mobi";
const DATE = "Thu, 24 Sep 2026 20:47:00 GMT";

type Net = (url: string) => Promise<Response>;
type Req = { method: string; url: string; mode: string };

function worker(net: Net) {
  const stores = new Map<string, Map<string, { body: string; init: ResponseInit }>>();
  const calls: string[] = [];
  const fetchFn = (r: string | Req) => {
    const url = new URL(typeof r === "string" ? r : r.url, ORIGIN).href;
    calls.push(url);
    return net(url);
  };
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    const key = (r: string | Req) => new URL(typeof r === "string" ? r : r.url, ORIGIN).href;
    const put = async (r: string | Req, res: Response) => {
      m.set(key(r), { body: await res.text(), init: { status: res.status, headers: res.headers } });
    };
    return {
      match: async (r: string | Req) => {
        const hit = m.get(key(r));
        return hit && new Response(hit.body, hit.init);
      },
      put,
      add: async (r: string) => put(r, await fetchFn(r)),
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (r: { url: string }) => m.delete(r.url),
    };
  };
  const on: Record<string, (e: unknown) => void> = {};
  const context = {
    self: {
      addEventListener: (t: string, f: (e: unknown) => void) => (on[t] = f),
      location: new URL(`${ORIGIN}/sw.js`),
      registration: {},
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
    },
    caches: { open, keys: async () => [...stores.keys()], delete: async (n: string) => stores.delete(n) },
    fetch: fetchFn,
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms / 1000),
    clearTimeout,
    URL,
    Headers,
    Response,
    console,
  };
  vm.runInNewContext(SOURCE, context);

  /** Dispatches a fetch event: the response, or null if the worker left
      the request alone, once everything it asked to wait for is done. */
  async function get(path: string, init: { mode?: string; method?: string; origin?: string } = {}) {
    let answer: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    on.fetch({
      request: { method: init.method ?? "GET", url: `${init.origin ?? ORIGIN}${path}`, mode: init.mode ?? "cors" },
      preloadResponse: Promise.resolve(undefined),
      respondWith: (p: Promise<Response>) => (answer = p),
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    if (!answer) return null;
    let res: Response;
    try {
      res = await answer;
    } finally {
      await Promise.allSettled(waits);
    }
    return res;
  }
  async function install() {
    const waits: Promise<unknown>[] = [];
    on.install({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }
  const kept = async (name: string) => [...(stores.get(name)?.keys() ?? [])].map((u) => u.replace(ORIGIN, ""));
  return { get, install, kept, calls };
}

const ok = (body: string) => new Response(body, { headers: { date: DATE, "content-type": "application/json" } });
const offline = () => Promise.reject(new TypeError("Failed to fetch"));
const ITEMS = "/api/v1/items?feed=a,b&limit=30";

describe("service worker", () => {
  test("online, the network answers and a copy is kept", async () => {
    const w = worker(async () => ok('{"items":[1]}'));
    const res = await w.get(ITEMS);
    assert.equal(await res!.text(), '{"items":[1]}');
    assert.equal(res!.headers.get("x-saved-copy"), null);
    assert.deepEqual(await w.kept("data"), [ITEMS]);
  });

  test("offline, a server error, or a slow network: the kept copy, marked with its date", async () => {
    let net: Net = async () => ok('{"items":[1]}');
    const w = worker((u) => net(u));
    await w.get(ITEMS);
    for (const failing of [offline, async () => new Response("down", { status: 503 }), () => new Promise<Response>((r) => setTimeout(() => r(ok("late")), 50))]) {
      net = failing;
      const res = await w.get(ITEMS);
      assert.equal(await res!.text(), '{"items":[1]}');
      assert.equal(res!.headers.get("x-saved-copy"), DATE);
    }
  });

  test("a slow answer still replaces the kept copy for next time", async () => {
    let net: Net = async () => ok("old");
    const w = worker((u) => net(u));
    await w.get(ITEMS);
    net = () => new Promise((r) => setTimeout(() => r(ok("new")), 50));
    assert.equal(await (await w.get(ITEMS))!.text(), "old");
    net = offline;
    assert.equal(await (await w.get(ITEMS))!.text(), "new");
  });

  test("offline with nothing kept fails as the network would", async () => {
    const w = worker(offline);
    await assert.rejects(w.get(ITEMS));
  });

  test("hashed assets are fetched once", async () => {
    const w = worker(async () => ok("js"));
    await w.get("/_astro/reader.abc123.js");
    await w.get("/_astro/reader.abc123.js");
    assert.equal(w.calls.length, 1);
  });

  test("install keeps the reader, the files it names and the chunks they import", async () => {
    const html = `<link rel="stylesheet" href="/_astro/base.x1.css"><script type="module" src="/_astro/reader.y2.js"></script>`;
    const files: Record<string, string> = {
      "/reader/": html,
      "/_astro/reader.y2.js": `import{s as a}from"./subs.z3.js";import"./track.w4.js";`,
      "/_astro/subs.z3.js": `import{t}from"./track.w4.js";`,
    };
    const w = worker(async (u) => new Response(files[new URL(u).pathname] ?? "asset"));
    await w.install();
    assert.deepEqual(await w.kept("shell"), ["/reader/"]);
    assert.deepEqual((await w.kept("assets")).sort(), ["/_astro/base.x1.css", "/_astro/reader.y2.js", "/_astro/subs.z3.js", "/_astro/track.w4.js"]);
    assert.equal(w.calls.filter((u) => u.endsWith("track.w4.js")).length, 1);
  });

  test("the reader page opens offline from its kept copy", async () => {
    let net: Net = async () => new Response("<h1>Reader</h1>", { headers: { date: DATE } });
    const w = worker((u) => net(u));
    await w.get("/reader/", { mode: "navigate" });
    net = offline;
    const res = await w.get("/reader/?utm_source=x", { mode: "navigate" });
    assert.equal(await res!.text(), "<h1>Reader</h1>");
  });

  test("leaves alone what is not the reader's", async () => {
    const w = worker(async () => ok("x"));
    assert.equal(await w.get("/feed/xkcd-com/", { mode: "navigate" }), null);
    assert.equal(await w.get("/api/v1/items", { method: "POST" }), null);
    assert.equal(await w.get("/api/v1/lookup"), null);
    assert.equal(await w.get("/x.png", { origin: "https://imgs.xkcd.com" }), null);
  });

  test("each cache keeps its newest entries up to its limit", async () => {
    const w = worker(async () => ok("{}"));
    for (let i = 0; i < 65; i++) await w.get(`/api/v1/items?feed=f${i}`);
    const data = await w.kept("data");
    assert.equal(data.length, 60);
    assert.equal(data[0], "/api/v1/items?feed=f5");
  });
});
