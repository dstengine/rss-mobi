import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { policy, linkTo } from "../src/lib/policy.ts";
import { urlset, sitemapIndex, changefreqFor, priorityFor, newest } from "../src/lib/sitemap.ts";
import { describe as said, narrowed, parseFilters, spelling, terms, toQuery, toSearch, wordPattern } from "../src/lib/filters.ts";
import { feedsOpml, rssPath } from "../src/lib/exports.ts";
import { assign, zTest, hash32, EXPERIMENTS, type Experiment } from "../src/lib/experiments.ts";
import { existsSync } from "node:fs";
import { reserve, headroom, BudgetExceeded, LIMITS } from "../src/lib/budget.ts";
import { spamReason } from "../src/lib/spam.ts";
import { feedTags, postTags } from "../src/lib/catalog.ts";
import { tag, topic, ownName } from "../src/lib/feeds/parse.ts";
import { itemJson, itemPageOpen } from "../src/lib/views.ts";
import { hasScope, mint } from "../src/lib/keys.ts";
import { hostKey } from "../src/lib/admin.ts";
import { decodeParam } from "../src/lib/feeds/url.ts";
import { lastDays, metricsOf, pageType } from "../src/lib/metrics.ts";
import { cluster, sensitive, type Post } from "../src/lib/clusters.ts";
import { check, pinFirst, storyPicture, storySlug, WORDS } from "../src/lib/stories.ts";
import { ObjectId } from "mongodb";
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

  test("lists link a post's page only while it is open", () => {
    assert.equal(itemPageOpen({ indexStatus: "not_indexed", robots: null }), true);
    for (const s of ["queued", "pending", "indexed", "error"] as const) assert.equal(itemPageOpen({ indexStatus: s, robots: null }), false, s);
    assert.equal(itemPageOpen({ indexStatus: "not_indexed", robots: "noindex,follow" }), false);
    assert.equal(itemPageOpen({ indexStatus: "indexed", robots: "index,follow" }), true);
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
    assert.deepEqual(f.tags, ["web-development", "rss"]);
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
    assert.ok(new RegExp(q.title.$not.$regex, "iu").test("SPAM here"));
  });

  test("a search needs every word; an excluded word is a word, not letters inside one", () => {
    assert.deepEqual(terms('open source, "machine learning" AI!'), ["open", "source", "machine learning", "AI"]);
    const q: any = toQuery(parseFilters(new URLSearchParams("q=open source&exclude=deal")));
    const needs = q.$and.map((c: any) => new RegExp(c.$or[0].title.$regex, "iu"));
    const passes = (title: string) => needs.every((r: RegExp) => r.test(title));
    assert.equal(passes("Open-Source AI reading list"), true);
    assert.equal(passes("Source: Leafs get Marchenko"), false);
    assert.equal(passes("Open data and a resource"), false);
    const out = new RegExp(q.title.$not.$regex, "iu");
    assert.equal(out.test("Best deals of the week"), true);
    assert.equal(out.test("The Ideal Handheld Camera Rig"), false);
    assert.ok(new RegExp(wordPattern("новост"), "iu").test("Главные Новости дня"));
    assert.ok(new RegExp(wordPattern("machine learning"), "iu").test("machine\n learning"));
  });

  test("two spellings of one filter share a cache key", () => {
    const a = toSearch(parseFilters(new URLSearchParams("tag=b,a&lang=en")));
    const b = toSearch(parseFilters(new URLSearchParams("lang=en&tags=a,b")));
    assert.equal(a, b);
  });

  // /rss.xml redirects any other spelling to this one, so it must read back
  // as itself — or the redirect would never end.
  test("the canonical spelling reads back as itself", () => {
    const long = `${"word ".repeat(19)}abcd 😀😀`;
    for (const raw of [
      "",
      "tag=b,a,a&lang=EN&junk=1",
      "q=open%20source&exclude=Deal, sponsored,x",
      "tag=Новости&host=WWW.Example.com&since=2026-09-01&limit=50",
      `q=${encodeURIComponent(long)}`,
      "feed=hacker-news,Bad Slug&tags=web dev",
    ]) {
      const once = toSearch(parseFilters(new URLSearchParams(raw)));
      assert.equal(toSearch(parseFilters(new URLSearchParams(once))), once, raw);
      assert.equal(spelling(`?${once}`), once, raw);
    }
    assert.equal(rssPath(parseFilters(new URLSearchParams("tag=robotics,ai"))), "/rss.xml?tag=ai,robotics");
    assert.equal(rssPath(parseFilters(new URLSearchParams("utm_source=x"))), "/rss.xml");
  });

  test("a filter says what it selects", () => {
    const f = parseFilters(new URLSearchParams("tag=ai,robotics&lang=en&q=agents&exclude=crypto&host=www.example.com"));
    assert.equal(said(f), "AI or Robotics posts from example.com in English matching “agents” without “crypto”");
    assert.equal(narrowed(f), true);
    assert.equal(narrowed(parseFilters(new URLSearchParams("limit=50"))), false);
  });
});

describe("API keys", () => {
  test("a key is rmk_ and 32 characters; its prefix names it; its hash is what is kept", () => {
    const a = mint();
    const b = mint();
    assert.match(a.token, /^rmk_[\w-]{32}$/);
    assert.equal(a.prefix, a.token.slice(4, 12));
    assert.equal(a.hash, sha256(a.token));
    assert.notEqual(a.token, b.token);
  });

  test("admin holds every scope; nothing holds one it was not given", () => {
    assert.equal(hasScope({ scopes: ["admin"] }, "write:feeds"), true);
    assert.equal(hasScope({ scopes: ["read:full"] }, "read:full"), true);
    assert.equal(hasScope({ scopes: ["read:full"] }, "write:feeds"), false);
    assert.equal(hasScope(null, "read:full"), false);
  });

  test("read:full adds where a post stands in the index check, and only then", () => {
    const it = { id: "a".repeat(24), feedSlug: "f", url: "https://x.test/a", host: "x.test", title: "T", excerpt: "", tags: [], lang: "en", publishedAt: new Date(), updatedAt: new Date(), indexStatus: "not_indexed", indexChecks: 2, indexCheckedAt: new Date("2026-09-24T00:00:00Z"), robots: null, linkMode: null } as any;
    assert.equal("index" in itemJson(it), false);
    assert.deepEqual(itemJson(it, true).index, { status: "not_indexed", checkedAt: it.indexCheckedAt, checks: 2, page: "index,follow" });
    assert.equal(itemJson({ ...it, indexStatus: "indexed" }, true).index?.page, "noindex,follow");
  });
});

test("a route parameter with a stray percent sign is text, not a crash", () => {
  assert.equal(decodeParam("%"), "%");
  assert.equal(decodeParam("web%20dev"), "web dev");
  assert.equal(decodeParam(undefined), "");
});

test("a blocked host is keyed one way, from a host or an address", () => {
  assert.equal(hostKey("WWW.Spam.example"), "spam.example");
  assert.equal(hostKey("https://www.spam.example:8443/feed?x=1"), "spam.example");
  assert.equal(hostKey("news.spam.example/path"), "news.spam.example");
  assert.equal(hostKey("localhost"), "");
  assert.equal(hostKey("not a host"), "");
});

describe("metrics", () => {
  test("a view counts by its page type, from the path's first segment", () => {
    assert.deepEqual(["/", "/feed/x/", "/tag/ai/", "/c/abc/", "/f/x/edit/", "/nope", "", undefined].map(pageType), ["home", "feed", "tag", "collection", "edit", "other", "other", "other"]);
    assert.deepEqual(metricsOf({ name: "view", path: "/reader/" }), ["view", "view:reader"]);
    assert.deepEqual(metricsOf({ name: "follow", path: "/reader/", label: "set:news" }), ["follow", "follow:reader"]);
  });

  test("only labels the site sends make metrics of their own", () => {
    assert.deepEqual(metricsOf({ name: "subscribe_copy", label: "topic" }), ["subscribe_copy", "subscribe_copy:topic"]);
    assert.deepEqual(metricsOf({ name: "subscribe_open", label: "Feedly" }), ["subscribe_open", "subscribe_open:Feedly"]);
    assert.deepEqual(metricsOf({ name: "submit_error", label: "429" }), ["submit_error", "submit_error:429"]);
    assert.deepEqual(metricsOf({ name: "subscribe_copy", label: "anything-a-stranger-sends" }), ["subscribe_copy"]);
    assert.deepEqual(metricsOf({ name: "outbound", label: "example.com" }), ["outbound"]);
    assert.deepEqual(metricsOf({ name: "reader_start", label: "empty" }), ["reader_start", "reader_start:empty"]);
    assert.deepEqual(metricsOf({ name: "reader_follow", label: "first" }), ["reader_follow", "reader_follow:first"]);
  });

  test("the last whole days, oldest first", () => {
    assert.deepEqual(lastDays(3, new Date("2026-09-28T10:00:00Z")), ["2026-09-25", "2026-09-26", "2026-09-27"]);
  });
});

describe("story clusters", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 8, 28, h));
  let n = 0;
  const post = (host: string, title: string, excerpt = "", h = 1): Post => ({ id: String(++n).padStart(24, "0"), title, excerpt, url: `https://${host}/${n}`, host, feedSlug: host, publishedAt: at(h) });
  // Filler, so the story words below are rare in the day's posts, as they are.
  const filler = Array.from({ length: 60 }, (_, i) => post(`f${i}.example`, `Unrelated notes number ${i} about gardening tomatoes weather`, "", 2));

  test("a story on several sites is one cluster, a name shared by two stories is not", () => {
    const posts = [
      post("a.example", "SpaceX Starship reaches orbit for the first time", "Starship orbit Starlink satellites deployed", 1),
      post("b.example", "Starship finally reaches orbit, SpaceX says", "SpaceX Starship orbit deployed Starlink", 2),
      post("c.example", "SpaceX's Starship makes it to orbit", "Starship orbit Starlink SpaceX mission", 3),
      post("d.example", "Musk hosts dinner for investors", "Musk investors dinner", 3),
      post("e.example", "Musk Starship comment draws criticism", "Musk comment criticism", 4),
      ...filler,
    ];
    const cs = cluster(posts, { now: at(5).getTime() });
    assert.equal(cs.length, 1);
    assert.equal(cs[0].hosts, 3);
    assert.deepEqual(cs[0].posts.map((p) => p.host).sort(), ["a.example", "b.example", "c.example"]);
  });

  test("stories about harm to people are left out", () => {
    assert.equal(sensitive({ posts: [post("a.example", "Man charged after stabbing in city centre")] }), true);
    assert.equal(sensitive({ posts: [post("a.example", "Bose brings back wired earbuds")] }), false);
  });
});

describe("story checks", () => {
  const job = {
    sources: [
      { url: "https://a.example/1", host: "a.example", title: "Bose brings back wired earbuds after a decade", excerpt: "The company said the new wired earbuds cost 99 dollars and add noise cancelling for the first time" },
      { url: "https://b.example/2", host: "b.example", title: "Bose returns to wired audio", excerpt: "A USB-C cable powers the noise cancelling" },
    ],
  } as any;
  const para = (i: number) => `Paragraph ${i} explains in plain words what the two reports said about the new earbuds, how they differ from wireless ones, and why a cable still matters to many people who listen for hours every day.`;
  const good = {
    headline: "Bose brings wired earbuds back, with noise cancelling",
    dek: "The company's first wired earbuds in over a decade draw power from a USB-C cable to cancel noise.",
    sections: [0, 1, 2].map((s) => ({ heading: `Section ${s}`, paragraphs: [0, 1, 2, 3].map((p) => para(s * 4 + p)) })),
    keyPoints: ["The earbuds plug into USB-C and need no charging.", "Noise cancelling runs on power from the cable.", "Both reports put the price at 99 dollars."],
    cited: ["https://a.example/1", "https://b.example/2"],
  };

  test("a headline's address keeps what follows a colon", () => {
    assert.equal(storySlug("Spider-Man: Brand New Day is headed back to cinemas"), "spider-man-brand-new-day-is-headed-back-to-cinemas");
    assert.equal(storySlug("SpaceX puts Starship into orbit — then cuts the flight short"), "spacex-puts-starship-into-orbit-then-cuts-the");
  });

  test("a story in shape passes, with its word count", () => {
    const r = check(job, good);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
    assert.ok(r.ok && r.story.words >= WORDS.min && r.story.words <= WORDS.max);
  });

  test("a title in quotation marks may repeat a source, a long quotation may not", () => {
    // The apostrophe must not end the quotation: after it come eight words
    // of the source.
    const titled = { ...good, keyPoints: [...good.keyPoints.slice(0, 2), "One review called it “the company’s said the new wired earbuds cost 99 dollars” moment."] };
    const r = check(job, titled);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
    const long = check(job, { ...good, keyPoints: [...good.keyPoints.slice(0, 2), "One site wrote “the company said the new wired earbuds cost 99 dollars and add noise cancelling”."] });
    assert.ok(!long.ok && long.problems.some((p) => p.startsWith("Quotes: each")));
  });

  test("copied wording, one source, markup and a short text are each refused", () => {
    const copied = check(job, { ...good, keyPoints: [...good.keyPoints.slice(0, 2), "The company said the new wired earbuds cost 99 dollars and more."] });
    assert.ok(!copied.ok && copied.problems.some((p) => p.startsWith("Copied wording")));
    const oneSite = check(job, { ...good, cited: ["https://a.example/1"] });
    assert.ok(!oneSite.ok && oneSite.problems.some((p) => p.includes("two sources")));
    const stranger = check(job, { ...good, cited: [...good.cited, "https://elsewhere.example/x"] });
    assert.ok(!stranger.ok && stranger.problems.some((p) => p.includes("not sources of this job")));
    const markup = check(job, { ...good, dek: `${good.dek} See **this** at https://a.example/1 now.` });
    assert.ok(!markup.ok && markup.problems.some((p) => p.startsWith("Plain text only")));
    const short = check(job, { ...good, sections: good.sections.map((s) => ({ ...s, paragraphs: s.paragraphs.slice(0, 1) })) });
    assert.ok(!short.ok && short.problems.some((p) => p.startsWith("Length")));
  });
});

describe("pinned stories", () => {
  const [a, b, c, d] = [0, 1, 2, 3].map((n) => ({ _id: new ObjectId(), n }));

  test("a pin leads the list and is listed once", () => {
    assert.deepEqual(pinFirst([a, b, c], [c], 3).map((s) => s.n), [2, 0, 1]);
  });

  test("a pin older than the cut still makes the list, at the cost of the oldest", () => {
    assert.deepEqual(pinFirst([a, b, c], [d], 3).map((s) => s.n), [3, 0, 1]);
  });

  test("with nothing pinned the list is the newest, as it was", () => {
    assert.deepEqual(pinFirst([a, b, c], [], 2).map((s) => s.n), [0, 1]);
  });
});

describe("a story's picture", () => {
  const [p1, p2, p3] = [new ObjectId(), new ObjectId(), new ObjectId()];
  const source = (itemId: ObjectId | undefined, host: string) => ({ itemId, url: `https://${host}/post`, title: host, host, feedSlug: host, publishedAt: new Date(), excerpt: "" });
  const story = {
    day: "2026-10-06",
    slug: "a-story",
    sources: [source(p1, "uncited.example"), source(p2, "small.example"), source(p3, "big.example"), source(undefined, "by-hand.example")],
    cited: ["https://small.example/post", "https://big.example/post", "https://by-hand.example/post"],
  };
  const posts = new Map([
    [String(p1), { url: "https://uncited.example/a.jpg", w: 1600, h: 900 }],
    [String(p2), { url: "https://small.example/b.jpg", w: 300, h: 200 }],
    [String(p3), { url: "https://big.example/c.jpg", w: 1600, h: 900 }],
  ]);

  test("comes from the first cited post with one big enough, at the post's address", () => {
    assert.deepEqual(storyPicture(story, posts, "card.webp"), { src: `/item/${p3}/image/card.webp`, credit: { name: "big.example", url: "https://big.example/post" } });
    assert.equal(storyPicture(story, posts, "thumb.webp")?.src, `/item/${p2}/image/thumb.webp`, "a thumbnail needs no width");
  });

  test("one set by hand wins, from the story's own address", () => {
    const credit = { name: "Maker", url: "https://maker.example/" };
    const own = { ...story, picture: { url: "https://maker.example/p.png", w: 1672, h: 941, credit } };
    assert.deepEqual(storyPicture(own, posts, "og.jpg"), { src: "/news/2026-10-06/a-story/image/og.jpg", credit });
  });

  test("none when no cited post has one", () => {
    assert.equal(storyPicture(story, new Map(), "card.webp"), null);
  });
});

describe("topics of a post", () => {
  const firehose = { title: "DEV Community", host: "dev.to", tags: ["web-development", "ai", "security", "python"], chosenTags: ["web-development"] };

  test("a post keeps its own categories and its feed's chosen topics, not the ones read off other posts", () => {
    assert.deepEqual(postTags(["email", "smtp"], firehose), ["email", "smtp", "web-development"]);
    assert.deepEqual(postTags(["ai", "llm"], firehose), ["ai", "llm", "web-development"]);
  });

  test("a post with no categories of its own takes all its feed's tags", () => {
    assert.deepEqual(postTags([], firehose), firehose.tags);
    assert.deepEqual(postTags(["dev-community"], firehose), firehose.tags, "the site's own name is not a category");
  });

  test("a feed saved before topics were told apart keeps the old rule", () => {
    assert.deepEqual(postTags(["email"], { ...firehose, chosenTags: undefined }), ["email", ...firehose.tags]);
  });

});

describe("exports", () => {
  test("OPML lists each feed by its publisher's address, dated by the newest", () => {
    const feed = (slug: string, url: string, updatedAt: string, siteUrl = "") => ({ slug, title: `${slug} & co`, url, siteUrl, updatedAt: new Date(updatedAt) }) as any;
    const xml = feedsOpml("Topic RSS feeds", [
      feed("a", "https://a.example/feed", "2026-09-20T00:00:00Z", "https://a.example/"),
      feed("b", "https://b.example/rss?x=1&y=2", "2026-09-24T12:00:00Z"),
    ]);
    assert.match(xml, /<title>Topic RSS feeds<\/title>/);
    assert.match(xml, /xmlUrl="https:\/\/a\.example\/feed"/);
    assert.match(xml, /htmlUrl="https:\/\/a\.example\/"/);
    assert.match(xml, /xmlUrl="https:\/\/b\.example\/rss\?x=1&amp;y=2"/);
    assert.match(xml, /text="a &amp; co"/);
    assert.match(xml, /<dateModified>Thu, 24 Sep 2026 12:00:00 GMT<\/dateModified>/);
    assert.doesNotMatch(xml, /rss\.mobi\/feed\//);
  });
});

describe("experiments", () => {
  const exp: Experiment = { id: "t", kind: "visitor", active: true, variants: [{ id: "a", weight: 1 }, { id: "b", weight: 1 }] };

  test("assignment is deterministic", () => {
    assert.equal(assign(exp, "visitor-1"), assign(exp, "visitor-1"));
  });

  test("an experiment is switched on only with its doc written, and splits its visitors evenly", () => {
    for (const exp of Object.values(EXPERIMENTS).filter((e) => e.active)) {
      assert.ok(existsSync(new URL(`../docs/experiments/${exp.id}.md`, import.meta.url)), `docs/experiments/${exp.id}.md`);
      const n = 10_000;
      const seen = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        const v = assign(exp, crypto.randomUUID());
        seen.set(v, (seen.get(v) ?? 0) + 1);
      }
      for (const v of exp.variants) assert.ok(Math.abs((seen.get(v.id) ?? 0) / n - 1 / exp.variants.length) < 0.03, `${exp.id}=${v.id}`);
    }
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
    // Filters keep every word: a dropped one would widen ?tag= to everything.
    assert.equal(tag("Sponsored"), "sponsored");
    assert.deepEqual(parseFilters(new URLSearchParams("tag=links")).tags, ["links"]);
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
    // Chosen by the submitter, the name stays: it is the subject too.
    const newsroom = { items: [{ tags: ["apple", "press"] }, { tags: ["apple", "press"] }] } as any;
    assert.deepEqual(feedTags(["apple"], newsroom, { title: "Apple Newsroom", host: "apple.com" }), ["apple", "press"]);
  });

  test("tokens are stored as hashes and compared in constant time", () => {
    const t = newToken();
    assert.ok(matches(t, sha256(t)));
    assert.ok(!matches(t + "x", sha256(t)));
    assert.ok(!matches(null, sha256(t)));
  });
});
