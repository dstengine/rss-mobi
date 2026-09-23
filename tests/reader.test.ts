// Slice 2: the reader, collections and the documents they publish.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseOpml, toOpml } from "../src/lib/opml.ts";
import { toRss } from "../src/lib/rss.ts";
import { esc, unesc, attributes } from "../src/lib/xml.ts";
import { cursorOf, parseCursor, parseFilters, toQuery } from "../src/lib/filters.ts";
import { normalise, collectionFilters, MAX_FEEDS } from "../src/lib/collections.ts";
import type { PublicItem } from "../src/lib/views.ts";

describe("xml", () => {
  test("escapes markup and drops characters XML forbids", () => {
    assert.equal(esc(`a & <b> "c"`), "a &amp; &lt;b&gt; &quot;c&quot;");
    assert.equal(esc("ok\u0000\u0008\u000Bstill￾"), "okstill");
    assert.equal(esc("tab\tand\nnewline"), "tab\tand\nnewline");
    assert.equal(esc(undefined), "");
  });

  test("unescapes entities and numeric references, and leaves nonsense alone", () => {
    assert.equal(unesc("&amp;&lt;&gt;&quot;&apos;&#233;&#x1F600;"), `&<>"'é😀`);
    assert.equal(unesc("&#0; &bogus;"), "&#0; &bogus;");
  });

  test("reads attributes in either quote style", () => {
    assert.deepEqual(attributes(`<outline text='A &amp; B' xmlUrl="https://x.test/f?a=1&amp;b=2"/>`), { text: "A & B", xmlUrl: "https://x.test/f?a=1&b=2" });
  });
});

describe("opml", () => {
  test("round trip keeps titles, addresses and special characters", () => {
    const feeds = [
      { title: `Tom & Jerry's "blog" <3`, url: "https://example.com/feed?x=1&y=2", siteUrl: "https://example.com/" },
      { title: "Plain", url: "https://plain.test/rss.xml" },
    ];
    const xml = toOpml("Mine & yours", feeds, new Date("2026-09-23T00:00:00Z"));
    assert.match(xml, /<title>Mine &amp; yours<\/title>/);
    assert.match(xml, /<dateModified>Wed, 23 Sep 2026 00:00:00 GMT<\/dateModified>/);
    assert.deepEqual(parseOpml(xml), [feeds[0], { ...feeds[1], siteUrl: undefined }]);
  });

  test("finds feeds in folders, skips folders, duplicates and non-web addresses", () => {
    const xml = `<?xml version="1.0"?><opml version="1.0"><body>
      <outline text="Tech">
        <outline text="One" type="rss" xmlUrl="https://one.test/feed" htmlUrl="https://one.test/"/>
        <outline title="Two" text="ignored" xmlUrl="https://two.test/atom.xml"></outline>
      </outline>
      <outline text="Dup" xmlUrl="https://one.test/feed"/>
      <outline text="Local" xmlUrl="file:///etc/passwd"/>
      <OUTLINE TEXT="Upper" xmlurl="http://three.test/rss"/>
    </body></opml>`;
    assert.deepEqual(
      parseOpml(xml).map((f) => [f.title, f.url]),
      [
        ["One", "https://one.test/feed"],
        ["Two", "https://two.test/atom.xml"],
        ["http://three.test/rss", "http://three.test/rss"],
      ],
    );
  });

  test("stops at the cap", () => {
    const xml = Array.from({ length: 30 }, (_, i) => `<outline xmlUrl="https://f${i}.test/"/>`).join("");
    assert.equal(parseOpml(xml, 10).length, 10);
  });
});

describe("rss", () => {
  const item = (over: Partial<PublicItem> = {}): PublicItem =>
    ({
      id: "650000000000000000000001",
      feedSlug: "one",
      url: "https://one.test/post?a=1&b=2",
      host: "one.test",
      title: "Cats & <dogs>",
      excerpt: "An excerpt \u0001with a control character.",
      author: "Ann",
      tags: ["pets", "c&c"],
      lang: "en",
      publishedAt: new Date("2026-09-22T10:00:00Z"),
      indexStatus: "queued",
      linkMode: null,
      updatedAt: new Date("2026-09-22T10:00:00Z"),
      ...over,
    }) as PublicItem;

  test("writes a valid RSS 2.0 channel with escaped items and their sources", () => {
    const xml = toRss({
      title: "Mix & match",
      link: "https://rss.mobi/c/abcdefgh/",
      self: "https://rss.mobi/c/abcdefgh/rss.xml",
      description: "Two feeds",
      items: [item(), item({ id: "650000000000000000000002", feedSlug: "two", publishedAt: new Date("2026-09-23T08:00:00Z"), author: undefined, excerpt: "" })],
      sources: new Map([["one", { title: "One & Only", url: "https://one.test/feed" }]]),
    });
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0" xmlns:atom=/);
    assert.match(xml, /<title>Mix &amp; match<\/title>/);
    assert.match(xml, /<atom:link href="https:\/\/rss.mobi\/c\/abcdefgh\/rss.xml" rel="self" type="application\/rss\+xml"\/>/);
    assert.match(xml, /<lastBuildDate>Wed, 23 Sep 2026 08:00:00 GMT<\/lastBuildDate>/);
    assert.match(xml, /<title>Cats &amp; &lt;dogs&gt;<\/title>/);
    assert.match(xml, /<link>https:\/\/one.test\/post\?a=1&amp;b=2<\/link>/);
    assert.match(xml, /<guid isPermaLink="true">/);
    assert.match(xml, /<category>c&amp;c<\/category>/);
    assert.match(xml, /<source url="https:\/\/one.test\/feed">One &amp; Only<\/source>/);
    assert.match(xml, /<dc:creator>Ann<\/dc:creator>/);
    assert.ok(!xml.includes("\u0001"));
    // The second item has no excerpt, author or known source: no empty elements.
    const second = xml.split("<item>")[2];
    assert.ok(!second.includes("<description>") && !second.includes("<dc:creator>") && !second.includes("<source"));
  });

  test("an empty channel has no lastBuildDate", () => {
    const xml = toRss({ title: "t", link: "https://rss.mobi/", self: "https://rss.mobi/x", description: "d", items: [] });
    assert.ok(!xml.includes("lastBuildDate"));
    assert.ok(!xml.includes("<item>"));
  });
});

describe("cursor", () => {
  test("round trip", () => {
    const it = { publishedAt: new Date("2026-09-23T08:00:00.123Z"), id: "650000000000000000000abc" };
    const c = parseCursor(cursorOf(it));
    assert.deepEqual(c, { at: it.publishedAt, id: it.id });
  });

  test("anything else is no cursor at all", () => {
    for (const s of [null, "", "2026-09-23", "2026-09-23T08:00:00Z_xyz", "2026-13-45T99:00:00Z_650000000000000000000abc", "x_650000000000000000000abc"]) {
      assert.equal(parseCursor(s), undefined, String(s));
    }
  });
});

describe("collections", () => {
  test("a title and a feed or a narrowing filter are required", () => {
    assert.equal(typeof normalise({ feeds: ["one"] }), "string");
    assert.equal(typeof normalise({ title: "   ", feeds: ["one"] }), "string");
    assert.equal(typeof normalise({ title: "x".repeat(101), feeds: ["one"] }), "string");
    assert.equal(typeof normalise({ title: "Everything" }), "string");
    // Leaving words out narrows nothing on its own.
    assert.equal(typeof normalise({ title: "Everything", filters: { exclude: ["ad"] } }), "string");
    assert.equal(typeof normalise({ title: "Best casino bonuses", feeds: ["one"] }), "string");
    assert.equal(typeof normalise({ title: "t", feeds: "one" }), "string");
  });

  test("feeds are deduplicated slugs, filters go through parseFilters", () => {
    const n = normalise({
      title: "  My\n reading  ",
      feeds: ["one", "one", "Bad Slug", 7, "two"],
      filters: { tags: ["Web Development", "CSS"], hosts: "WWW.Example.com", q: " grid ", exclude: ["Sponsored", "a"], lang: "EN", since: "2020-01-01", limit: 5 },
    });
    assert.deepEqual(n, {
      title: "My reading",
      feeds: ["one", "two"],
      filters: { tags: ["web-development", "css"], hosts: ["example.com"], exclude: ["sponsored"], lang: "en", q: "grid" },
    });
  });

  test("a topic alone is a collection", () => {
    const n = normalise({ title: "CSS", filters: { tags: "css" } });
    assert.ok(typeof n === "object");
    assert.deepEqual(n.feeds, []);
  });

  test("too many feeds is refused, not truncated", () => {
    const feeds = Array.from({ length: MAX_FEEDS + 1 }, (_, i) => `f${i}`);
    assert.equal(typeof normalise({ title: "Big", feeds }), "string");
  });

  test("a collection's query is its feeds AND its filters", () => {
    const q = toQuery(collectionFilters({ feeds: ["one", "two"], filters: { tags: ["css"], hosts: [], exclude: ["ad"] } }, 30)) as any;
    assert.deepEqual(q.feedSlug, { $in: ["one", "two"] });
    assert.deepEqual(q.tags, { $in: ["css"] });
    assert.equal(q.visible, true);
    assert.ok(q.title.$not instanceof RegExp);
  });

  test("the same filters in a URL mean the same thing", () => {
    const n = normalise({ title: "t", filters: { tags: "css,html", lang: "en" } });
    assert.ok(typeof n === "object");
    const viaUrl = parseFilters(new URLSearchParams("tag=css,html&lang=en"));
    assert.deepEqual(n.filters.tags, viaUrl.tags);
    assert.equal(n.filters.lang, viaUrl.lang);
  });
});
