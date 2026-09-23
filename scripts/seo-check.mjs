#!/usr/bin/env node
// Walks the live sitemap and reports where the SEO rules in AGENTS.md do
// not hold:
//   - every sitemap entry, and every child in the index, carries loc,
//     lastmod, changefreq and priority (the index: loc and lastmod);
//   - every listed page answers 200, says index,follow, and its canonical
//     is its own address;
//   - its title and description contain the keyword;
//   - the pages we name ourselves carry it in the h1 as well.
//
//   node scripts/seo-check.mjs [base]      # default https://rss.mobi
import { readFileSync } from "node:fs";

const base = (process.argv[2] ?? "https://rss.mobi").replace(/\/$/, "");
const config = readFileSync(new URL("../src/site.config.ts", import.meta.url), "utf8");
const keyword = config.match(/keyword:\s*"([^"]+)"/)[1];
const NAMED = new Set(["/", "/tags/", "/submit/", "/about/", "/terms/"]);
const problems = [];
const say = (where, what) => problems.push(`${where}: ${what}`);
const has = (s) => s.toLowerCase().includes(keyword.toLowerCase());
const text = async (url) => {
  const res = await fetch(url, { redirect: "manual" });
  return { status: res.status, body: await res.text() };
};
const tags = (xml, t) => [...xml.matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, "g"))].map((m) => m[1]);
const field = (block, f) => block.match(new RegExp(`<${f}>([^<]*)</${f}>`))?.[1];
const onBase = (loc) => loc.replace(/^https:\/\/rss\.mobi/, base);

const index = await text(`${base}/sitemap-index.xml`);
if (index.status !== 200) {
  console.error(`sitemap-index.xml: HTTP ${index.status}`);
  process.exit(1);
}
const urls = [];
for (const child of tags(index.body, "sitemap")) {
  const loc = field(child, "loc");
  if (!field(child, "lastmod")) say(loc, "index entry has no lastmod");
  const xml = await text(onBase(loc));
  if (xml.status !== 200) say(loc, `HTTP ${xml.status}`);
  for (const u of tags(xml.body, "url")) {
    for (const f of ["loc", "lastmod", "changefreq", "priority"]) if (!field(u, f)) say(field(u, "loc") ?? loc, `no ${f}`);
    urls.push(field(u, "loc"));
  }
}

for (const loc of urls) {
  const path = new URL(loc).pathname;
  const page = await text(onBase(loc));
  if (page.status !== 200) {
    say(path, `HTTP ${page.status}`);
    continue;
  }
  const h = page.body;
  const title = h.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  const description = h.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
  const robots = h.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? "";
  const canonical = h.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? "";
  const h1 = (h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "").replace(/<[^>]+>/g, "");
  if (robots !== "index,follow") say(path, `in the sitemap but robots is "${robots}"`);
  if (canonical !== loc) say(path, `canonical is ${canonical}`);
  if (!has(title)) say(path, `title lacks "${keyword}": ${title}`);
  if (!has(description)) say(path, `description lacks "${keyword}"`);
  if (description.length > 160) say(path, `description is ${description.length} characters`);
  if (NAMED.has(path) && !has(h1)) say(path, `h1 lacks "${keyword}": ${h1}`);
}

console.log(`${urls.length} pages checked on ${base}`);
if (problems.length) {
  console.log(problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log("clean");
