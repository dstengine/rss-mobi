// robots.txt must never close a page the sitemap lists. "Disallow: /api/"
// once kept the API page itself out of Google (6 Nov 2026): the endpoints
// live under /api/v1/, the page that documents them at /api/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GET } from "../src/pages/robots.txt.ts";

// Google's matching: the longest rule that matches wins, Allow on a tie;
// "*" is any run of characters and a trailing "$" anchors the end.
function allowed(body: string, path: string): boolean {
  let best = { len: -1, allow: true };
  for (const line of body.split("\n")) {
    const m = line.match(/^(Allow|Disallow):\s*(\S*)/i);
    if (!m || !m[2]) continue;
    const rule = m[2];
    const re = new RegExp("^" + rule.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\?\$$/, "$"));
    if (!re.test(path)) continue;
    const allow = m[1].toLowerCase() === "allow";
    if (rule.length > best.len || (rule.length === best.len && allow)) best = { len: rule.length, allow };
  }
  return best.allow;
}

test("robots.txt leaves open every page the sitemap lists, and closes the data", async () => {
  const body = await (GET as any)().text();
  const source = readFileSync(new URL("../src/lib/sitemaps.ts", import.meta.url), "utf8");
  const statics = JSON.parse(source.match(/const STATIC = (\[[^\]]*\])/)![1]) as string[];
  assert.ok(statics.includes("/api/"), "the API page is no longer in the sitemap's static list");
  for (const path of ["/", "/tags/", "/reader/", ...statics, "/tag/ai/", "/feed/example/"]) assert.ok(allowed(body, path), `${path} is closed by robots.txt`);
  for (const path of ["/api/v1/feeds", "/api/v1/items?tag=ai", "/f/abc", "/go/x", "/c/abc/edit"]) assert.ok(!allowed(body, path), `${path} is open to robots`);
});
