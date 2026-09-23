// The anti-cloaking promise, checked against a running server: every page
// type answers a crawler and a phone with the same bytes.
//
//   RSS_MOBI_BASE=http://localhost:4340 npm run test:live
//   RSS_MOBI_BASE=https://rss.mobi npm run test:live
//
// Skipped when RSS_MOBI_BASE is not set, so `npm test` needs no server.
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.RSS_MOBI_BASE;
const GOOGLEBOT = "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function pages(): Promise<string[]> {
  const list = ["/", "/tags/", "/reader/", "/c/new/", "/submit/", "/about/", "/terms/", "/search/?q=news"];
  const api = await (await fetch(`${BASE}/api/v1/feeds?limit=3`)).json();
  for (const f of api.feeds ?? []) {
    list.push(`/feed/${f.slug}/`);
    if (f.tags[0]) list.push(`/tag/${f.tags[0]}/`);
  }
  return [...new Set(list)];
}

test("the same HTML for Googlebot and for a phone", { skip: !BASE && "RSS_MOBI_BASE not set" }, async () => {
  for (const path of await pages()) {
    const [bot, phone] = await Promise.all(
      [GOOGLEBOT, IPHONE].map(async (ua) => {
        const res = await fetch(`${BASE}${path}`, { headers: { "User-Agent": ua } });
        return `${res.status}\n${await res.text()}`;
      }),
    );
    assert.equal(bot, phone, `${path} differs by user agent`);
  }
});
