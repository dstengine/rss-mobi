import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { policy, linkTo } from "../src/lib/policy.ts";
import { urlset, sitemapIndex, changefreqFor, priorityFor, newest } from "../src/lib/sitemap.ts";
import { parseFilters, toQuery, toSearch } from "../src/lib/filters.ts";
import { assign, zTest, hash32, type Experiment } from "../src/lib/experiments.ts";
import { reserve, headroom, BudgetExceeded, LIMITS } from "../src/lib/budget.ts";
import { spamReason } from "../src/lib/spam.ts";
import { feedTags } from "../src/lib/catalog.ts";
import { tag, topic, ownName } from "../src/lib/feeds/parse.ts";
import { matches, sha256, newToken } from "../src/lib/tokens.ts";

const DAY = 86_400_000;

describe("policy", () => {
  const ready = { status: "active" as const, itemCount: 3, okCount: 3, robots: null };

  test("a feed page is indexed only once it has items and a fetch history", () => {
    assert.equal(policy({ type: "feed", feed: ready }).robots, "index,follow");
    assert.equal(policy({ type: "feed", feed: { ...ready, itemCount: 2 } }).robots, "noindex,follow");
    assert.equal(policy({ type: "feed", feed: { ...ready, okCount: 1 } }).robots, "noindex,follow");
    assert.equal(policy({ type: "feed", feed: { ...ready, status: "hidden" } }).robots, "noindex,follow");
    assert.equal(policy({ type: "feed", feed: { ...ready, itemCount: 0, robots: "index,follow" } }).robots, "index,follow");
  });

  test("an item page opens exactly when its original is not indexed", () => {
    const item = (indexStatus: any, visible = true) => ({ indexStatus, visible, robots: null });
    const active = { status: "active" as const };
    assert.equal(policy({ type: "item", item: item("not_indexed"), feed: active }).robots, "index,follow");
    for (const s of ["queued", "pending", "indexed", "error"]) {
      assert.equal(policy({ type: "item", item: item(s), feed: active }).robots, "noindex,follow", s);
    }
    assert.equal(policy({ type: "item", item: item("not_indexed", false), feed: active }).robots, "noindex,follow");
    assert.equal(policy({ type: "item", item: item("not_indexed"), feed: { status: "hidden" } }).robots, "noindex,follow");
  });

  test("sitemap membership follows robots", () => {
    assert.equal(policy({ type: "feed", feed: ready }).sitemap, true);
    assert.equal(policy({ type: "collection" }).sitemap, false);
  });

  test("tags need breadth before they are indexed", () => {
    assert.equal(policy({ type: "tag", feeds: 5, hosts: 3 }).robots, "index,follow");
    assert.equal(policy({ type: "tag", feeds: 9, hosts: 2 }).robots, "noindex,follow");
  });

  test("links: followed when we stand in for the original, ugc otherwise", () => {
    assert.deepEqual(linkTo({ indexStatus: "not_indexed", linkMode: null }), { mode: "direct", rel: null });
    assert.deepEqual(linkTo({ indexStatus: "indexed", linkMode: null }), { mode: "ugc", rel: "ugc" });
    assert.deepEqual(linkTo({ indexStatus: "queued", linkMode: null }, { linkMode: "nofollow" }), { mode: "nofollow", rel: "ugc nofollow" });
  });

  test("policy takes no user agent", () => {
    // The whole anti-cloaking guarantee in one line: the function cannot
    // tell a crawler from a reader because nobody can tell it.
    assert.equal(policy.length, 1);
  });
});

describe("sitemap", () => {
  test("every entry carries loc, lastmod, changefreq and priority", () => {
    const xml = urlset([
      { loc: "https://rss.mobi/", lastmod: new Date(Date.now() - DAY) },
      { loc: "https://rss.mobi/feed/a/", lastmod: new Date(Date.now() - 40 * DAY) },
    ]);
    const entries = xml.match(/<url>.*?<\/url>/g)!;
    assert.equal(entries.length, 2);
    for (const e of entries) for (const f of ["loc", "lastmod", "changefreq", "priority"]) assert.match(e, new RegExp(`<${f}>`), f);
    assert.match(entries[0], /<changefreq>daily<\/changefreq><priority>1\.0<\/priority>/);
    assert.match(entries[1], /<changefreq>monthly<\/changefreq><priority>0\.6<\/priority>/);
  });

  test("the index dates each child", () => {
    const xml = sitemapIndex([{ loc: "https://rss.mobi/sitemap-feeds-1.xml", lastmod: new Date("2026-09-20T00:00:00Z") }]);
    assert.match(xml, /<sitemap><loc>https:\/\/rss\.mobi\/sitemap-feeds-1\.xml<\/loc><lastmod>2026-09-20T00:00:00\.000Z<\/lastmod><\/sitemap>/);
  });

  test("thresholds match tools/sitemap.mjs in dstengine/dst", () => {
    assert.equal(changefreqFor(2, new Date(Date.now() - 3 * DAY)), "daily");
    assert.equal(changefreqFor(2, new Date(Date.now() - 20 * DAY)), "weekly");
    assert.equal(changefreqFor(2, new Date(Date.now() - 400 * DAY)), "yearly");
    assert.deepEqual([0, 1, 2, 3, 7].map(priorityFor), [1, 0.8, 0.6, 0.4, 0.4]);
    assert.equal(newest([null, new Date(1), new Date(5), undefined])?.getTime(), 5);
  });
});

describe("filters", () => {
  test("parse, clamp and normalise", () => {
    const f = parseFilters(new URLSearchParams("tag=Web Dev,rss&lang=EN&feed=a-b,Bad Slug&host=www.Example.com&limit=500&exclude=ad,x&since=2026-09-01"));
    assert.deepEqual(f.tags, ["web-dev", "rss"]);
    assert.equal(f.lang, "en");
    assert.deepEqual(f.feeds, ["a-b"]);
    assert.deepEqual(f.hosts, ["example.com"]);
    assert.equal(f.limit, 100);
    assert.deepEqual(f.exclude, ["ad"]);
    assert.equal(f.since?.toISOString(), "2026-09-01T00:00:00.000Z");
  });

  test("bad values fall away instead of failing", () => {
    const f = parseFilters(new URLSearchParams("limit=abc&since=never&lang=english"));
    assert.equal(f.limit, 30);
    assert.equal(f.since, undefined);
    assert.equal(f.lang, undefined);
  });

  test("query always restricts to visible items", () => {
    assert.deepEqual(toQuery(parseFilters(new URLSearchParams(""))), { visible: true });
    const q: any = toQuery(parseFilters(new URLSearchParams("tag=ai&exclude=spam&q=hello")));
    assert.deepEqual(q.tags, { $in: ["ai"] });
    assert.deepEqual(q.$text, { $search: "hello" });
    assert.ok(q.title.$not.test("SPAM here"));
  });

  test("two spellings of one filter share a cache key", () => {
    const a = toSearch(parseFilters(new URLSearchParams("tag=b,a&lang=en")));
    const b = toSearch(parseFilters(new URLSearchParams("lang=en&tags=a,b")));
    assert.equal(a, b);
  });
});

describe("experiments", () => {
  const exp: Experiment = { id: "t", kind: "visitor", active: true, variants: [{ id: "a", weight: 1 }, { id: "b", weight: 1 }] };

  test("assignment is deterministic", () => {
    assert.equal(assign(exp, "visitor-1"), assign(exp, "visitor-1"));
  });

  test("10,000 ids split 50/50 within 2%", () => {
    let b = 0;
    for (let i = 0; i < 10_000; i++) if (assign(exp, `id-${i}`) === "b") b++;
    assert.ok(Math.abs(b / 10_000 - 0.5) < 0.02, `b share ${b / 10_000}`);
  });

  test("weights are honoured", () => {
    const skew = { ...exp, variants: [{ id: "a", weight: 9 }, { id: "b", weight: 1 }] };
    let b = 0;
    for (let i = 0; i < 10_000; i++) if (assign(skew, `id-${i}`) === "b") b++;
    assert.ok(Math.abs(b / 10_000 - 0.1) < 0.02, `b share ${b / 10_000}`);
  });

  test("inactive means control for everyone", () => {
    assert.equal(assign({ ...exp, active: false }, "anyone"), "a");
  });

  test("different experiments split differently", () => {
    let same = 0;
    for (let i = 0; i < 1000; i++) if (assign(exp, `id-${i}`) === assign({ ...exp, id: "other" }, `id-${i}`)) same++;
    assert.ok(same > 400 && same < 600, `overlap ${same}`);
  });

  test("z-test", () => {
    assert.ok(zTest(100, 1000, 150, 1000).p < 0.01);
    assert.ok(zTest(100, 1000, 104, 1000).p > 0.5);
    assert.equal(hash32("x"), hash32("x"));
  });
});

describe("budget", () => {
  function fakeLedger() {
    const docs = new Map<string, { _id: string; usd: number; updatedAt: Date }>();
    return {
      docs,
      async updateOne(filter: any, update: any, opts: any) {
        if (!docs.has(filter._id) && opts?.upsert) docs.set(filter._id, { _id: filter._id, ...update.$setOnInsert });
        return {} as any;
      },
      async findOneAndUpdate(filter: any, update: any) {
        const d = docs.get(filter._id);
        if (!d || !(d.usd <= filter.usd.$lte)) return null;
        d.usd += update.$inc.usd;
        return d as any;
      },
      async findOne(filter: any) {
        return (docs.get(filter._id) ?? null) as any;
      },
    };
  }

  test("reservations stop at the ceiling, before the call", async () => {
    const l = fakeLedger();
    const each = LIMITS.serp / 4;
    for (let i = 0; i < 4; i++) await reserve(l as any, "serp", each);
    await assert.rejects(reserve(l as any, "serp", 0.0006, "one more check"), BudgetExceeded);
    assert.equal(await headroom(l as any, "serp"), 0);
  });
});

describe("spam", () => {
  const items = (titles: string[]) => titles.map((title) => ({ title }) as any);
  test("obvious spam is refused, a news story about a casino is not", () => {
    assert.ok(spamReason({ title: "Best Online Casino Bonuses", description: "", items: items(["a"]) }, "x.com"));
    assert.equal(spamReason({ title: "City News", description: "", items: items(["Casino plan approved", "Weather", "Traffic", "Schools"]) }, "news.com"), null);
    assert.ok(spamReason({ title: "Deals", description: "", items: items(["viagra cheap", "cialis cheap", "Hello"]) }, "x.com"));
  });
});

describe("catalog helpers", () => {
  test("feed tags: submitter's first, then the feed's recurring categories", () => {
    const parsed = { items: [{ tags: ["a", "b"] }, { tags: ["b", "c"] }, { tags: ["b"] }] } as any;
    assert.deepEqual(feedTags(["mine"], parsed), ["mine", "b"]);
  });

  test("tags: bookkeeping categories are not topics", () => {
    for (const t of ["Uncategorized", "Articles", "links", "Resource", "Featured Posts", "blog_posts"]) assert.equal(topic(t), "", t);
    for (const t of ["news", "video", "podcast", "RSS", "CSS", "web development"]) assert.notEqual(topic(t), "", t);
    // Filters keep every word: excluding sponsored posts must still work.
    assert.equal(tag("Sponsored"), "sponsored");
  });

  test("tags: a site's own name is not a topic", () => {
    const site = { title: "Daring Fireball", host: "daringfireball.net" };
    assert.ok(ownName("daring-fireball", site));
    assert.ok(ownName("daringfireball", site));
    assert.ok(!ownName("apple", site));
    assert.ok(ownName("css-tricks", { title: "CSS-Tricks", host: "css-tricks.com" }));
    assert.ok(!ownName("css", { title: "CSS-Tricks", host: "css-tricks.com" }));
    // A subdomain is not the site's name: "news" stays a topic here.
    const hn = { title: "Hacker News: Front Page", host: "news.ycombinator.com" };
    assert.ok(!ownName("news", hn));
    assert.ok(ownName("ycombinator", hn));
    assert.ok(ownName("example", { title: "A blog", host: "blog.example.co.uk" }));
    const parsed = { items: [{ tags: ["daring-fireball", "apple"] }, { tags: ["daring-fireball", "apple"] }] } as any;
    assert.deepEqual(feedTags(["tech"], parsed, site), ["tech", "apple"]);
  });

  test("tokens are stored as hashes and compared in constant time", () => {
    const t = newToken();
    assert.ok(matches(t, sha256(t)));
    assert.ok(!matches(t + "x", sha256(t)));
    assert.ok(!matches(null, sha256(t)));
  });
});
