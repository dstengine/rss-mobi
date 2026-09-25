// The reader's service worker. Opened on a phone with no signal, the
// reader shows what it showed last time, as an app would, instead of the
// browser's error page. /reader/ registers it with scope /reader/, so it
// sees the reader and what the reader loads and nothing else: the
// directory's pages never wait for it to start.
//
// - The reader page, the list of posts and a post's whole text come from
//   the network first. With no answer in 4 seconds, or none at all, the
//   last answer for the same address is used, marked X-Saved-Copy with
//   when it was fetched so the reader can say so.
// - /_astro/ files carry a hash in their names: once fetched, kept.
// - Feed icons: the kept one at once, refreshed behind it.
// - Posts' thumbnails never change: once fetched, kept.

const SHELL = "shell";
const ASSETS = "assets";
const DATA = "data";
const ICONS = "icons";
const PICTURES = "pictures";
const LIMITS = { [SHELL]: 1, [ASSETS]: 80, [DATA]: 60, [ICONS]: 300, [PICTURES]: 300 };
const PATIENCE = 4_000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // The reader and everything it needs, so the first offline visit
      // already works.
      const res = await fetch("/reader/", { cache: "no-cache" });
      if (res.ok) {
        const html = await res.clone().text();
        await (await caches.open(SHELL)).put("/reader/", res);
        // The page names its scripts; the scripts import shared chunks the
        // page never names, and the reader is dead offline without them.
        const assets = await caches.open(ASSETS);
        const queue = html.match(/\/_astro\/[^"'\s)?#]+/g) ?? [];
        const seen = new Set();
        while (queue.length) {
          const path = queue.shift();
          if (seen.has(path)) continue;
          seen.add(path);
          const file = await fetch(path).catch(() => null);
          if (!file?.ok) continue;
          if (path.endsWith(".js")) for (const m of (await file.clone().text()).matchAll(/["']\.\/([\w.-]+\.js)["']/g)) queue.push(`/_astro/${m[1]}`);
          await assets.put(path, file);
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set(Object.keys(LIMITS));
      for (const name of await caches.keys()) if (!keep.has(name)) await caches.delete(name);
      await self.registration.navigationPreload?.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (req.mode === "navigate" && (path === "/reader/" || path === "/reader")) {
    event.respondWith(networkFirst(event, SHELL, "/reader/"));
  } else if (path.startsWith("/_astro/")) {
    event.respondWith(kept(req, ASSETS));
  } else if (/^\/item\/[0-9a-f]{24}\/image\/thumb\.webp$/.test(path)) {
    event.respondWith(kept(req, PICTURES));
  } else if (path === "/api/v1/items" || /^\/api\/v1\/items\/[^/]+\/content$/.test(path)) {
    event.respondWith(networkFirst(event, DATA, req.url));
  } else if (/^\/feed\/[a-z0-9-]+\/icon$/.test(path)) {
    event.respondWith(refreshed(event, ICONS));
  }
});

/** The network's answer, or the kept one when the network fails, errs or
    is slower than PATIENCE and something is kept. */
async function networkFirst(event, name, key) {
  const cache = await caches.open(name);
  const network = (async () => {
    const res = (await event.preloadResponse) || (await fetch(event.request));
    if (res.ok) {
      await cache.put(key, res.clone());
      await trim(name);
    }
    return res;
  })();
  event.waitUntil(network.catch(() => {}));
  const hit = await cache.match(key);
  if (!hit) return network;
  return new Promise((resolve) => {
    // Whichever comes first answers, once: a body can be read only once.
    let done = false;
    const answer = (make) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(make());
    };
    const timer = setTimeout(() => answer(() => marked(hit)), PATIENCE);
    network.then(
      (res) => answer(() => (res.ok ? res : marked(hit))),
      () => answer(() => marked(hit)),
    );
  });
}

async function kept(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    await trim(name);
  }
  return res;
}

async function refreshed(event, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(event.request);
  const network = fetch(event.request).then(async (res) => {
    if (res.ok) {
      await cache.put(event.request, res.clone());
      await trim(name);
    }
    return res;
  });
  event.waitUntil(network.catch(() => {}));
  return hit || network;
}

/** A kept answer, labelled with when it was fetched. */
function marked(res) {
  const headers = new Headers(res.headers);
  headers.set("X-Saved-Copy", res.headers.get("date") || "");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Drops the oldest entries past a cache's limit. */
async function trim(name) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  const over = keys.length - LIMITS[name];
  for (const k of keys.slice(0, Math.max(0, over))) await cache.delete(k);
}
