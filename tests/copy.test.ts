import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parseFeed, itemKey, type ParsedItem } from "../src/lib/feeds/parse.ts";
import { clean } from "../src/lib/feeds/clean.ts";
import { copyItems, readerCount, subscriberTotal, type StoredPost } from "../src/lib/copy.ts";
import { toRss } from "../src/lib/rss.ts";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>Pod</title><link>https://pod.example/</link>
<item><title>Episode 1</title><link>https://pod.example/1</link><guid isPermaLink="false">ep-1</guid>
<description>Short.</description>
<content:encoded><![CDATA[<p>Whole <b>post</b> <img src="/a.png"></p><script>alert(1)</script>]]></content:encoded>
<enclosure url="https://cdn.pod.example/1.mp3" length="1234" type="audio/mpeg"/>
<enclosure url="https://cdn.pod.example/1.jpg" length="99" type="image/jpeg"/>
</item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><link href="https://a.example/"/>
<entry><id>tag:a,1</id><title>One</title><link href="https://a.example/1"/>
<link rel="enclosure" type="audio/ogg" href="https://a.example/1.ogg" length="5"/>
<content type="html">&lt;p&gt;Full &lt;em&gt;one&lt;/em&gt;&lt;/p&gt;</content><updated>2026-09-20T10:00:00Z</updated></entry>
</feed>`;

describe("parsing whole posts", () => {
  test("RSS keeps content:encoded raw and audio enclosures, not images", () => {
    const [it] = parseFeed(RSS, "https://pod.example/feed").items;
    assert.match(it.content!, /Whole <b>post<\/b>/);
    assert.deepEqual(it.media, [{ url: "https://cdn.pod.example/1.mp3", type: "audio/mpeg", length: 1234 }]);
    assert.equal(it.excerpt, "Short.");
  });
  test("Atom content and rel=enclosure links", () => {
    const [it] = parseFeed(ATOM, "https://a.example/feed").items;
    assert.equal(it.content, "<p>Full <em>one</em></p>");
    assert.deepEqual(it.media, [{ url: "https://a.example/1.ogg", type: "audio/ogg", length: 5 }]);
  });
});

describe("clean", () => {
  const base = "https://blog.example/2026/post/";
  test("drops scripts, styles, handlers and forms", () => {
    const out = clean(`<p style="color:red" onclick="x()">Hi<script>alert(1)</script></p><form><input></form><style>p{}</style>`, base);
    assert.equal(out, "<p>Hi</p>");
  });
  test("makes links and pictures absolute and marks links", () => {
    const out = clean(`<a href="../other/">x</a><img src="pic.jpg" srcset="pic.jpg 1x, https://cdn.example/w_2,h_3/pic.jpg 2x" alt="p">`, base);
    assert.match(out, /href="https:\/\/blog\.example\/2026\/other\/"/);
    assert.match(out, /rel="nofollow ugc noopener"/);
    assert.match(out, /src="https:\/\/blog\.example\/2026\/post\/pic\.jpg"/);
    // A CDN address with commas in it stays whole.
    assert.match(out, /https:\/\/cdn\.example\/w_2,h_3\/pic\.jpg 2x/);
  });
  test("takes a lazy loader's real picture", () => {
    assert.match(clean(`<img src="data:image/gif;base64,R0" data-src="/real.jpg">`, base), /src="https:\/\/blog\.example\/real\.jpg"/);
  });
  test("drops counting pixels and the paragraph they leave empty", () => {
    assert.equal(clean(`<p><img src="https://pixel.wp.com/g.gif?x=1" width="1" height="1"></p><p>Text</p>`, base), "<p>Text</p>");
    assert.equal(clean(`<img src="https://feeds.feedburner.com/~r/x/~4/abc">`, base), "");
  });
  test("iframes from YouTube and Vimeo only", () => {
    assert.match(clean(`<iframe src="https://www.youtube.com/embed/abc"></iframe>`, base), /youtube\.com\/embed\/abc/);
    assert.doesNotMatch(clean(`<iframe src="https://evil.example/x"></iframe>`, base), /evil/);
  });
  test("no javascript: links", () => {
    assert.doesNotMatch(clean(`<a href="javascript:alert(1)">x</a>`, base), /javascript/);
  });
});

describe("copyItems", () => {
  const feed = { slug: "f", url: "https://f.example/feed", title: "F", host: "f.example", tags: ["web"] };
  const live = (over: Partial<ParsedItem>): ParsedItem => ({ guid: "", url: "", title: "t", excerpt: "e", tags: [], ...over });
  const stored = (url: string, day: number, guid = url): StoredPost => ({
    guid,
    feedSlug: "f",
    url,
    title: `s ${day}`,
    excerpt: "kept",
    tags: ["web"],
    publishedAt: new Date(Date.UTC(2026, 8, day)),
  });

  test("the original's posts come whole; dropped ones fill up from storage", () => {
    const out = copyItems(
      feed,
      [stored("https://f.example/3", 3), stored("https://f.example/1", 1)],
      [live({ url: "https://f.example/3", publishedAt: new Date(Date.UTC(2026, 8, 3)), content: "<p>three</p>" })],
    );
    assert.deepEqual(out.map((i) => i.url), ["https://f.example/3", "https://f.example/1"]);
    assert.equal(out[0].content, "<p>three</p>");
    assert.equal(out[0].title, "t");
    assert.equal(out[1].content, undefined);
  });

  test("two posts linking one page, parted by a #fragment, are both kept", () => {
    const a = live({ url: "https://f.example/p", guid: "g1", content: "<p>long</p>", publishedAt: new Date(Date.UTC(2026, 8, 5)) });
    const b = live({ url: "https://f.example/p#:~:text=x", guid: "g2", content: "<p>link</p>", publishedAt: new Date(Date.UTC(2026, 8, 6)) });
    assert.equal(copyItems(feed, [], [a, b]).length, 2);
  });

  test("a live post matches its stored twin by the stored key, not by address", () => {
    const it = live({ url: "https://f.example/x?utm_source=rss", guid: "https://f.example/x?utm_source=rss", content: "<p>x</p>" });
    const out = copyItems(feed, [stored("https://f.example/x", 4, itemKey(it))], [it]);
    assert.equal(out.length, 1);
    // An undated live post takes the date it was first stored with.
    assert.equal(out[0].publishedAt?.toISOString(), "2026-09-04T00:00:00.000Z");
  });

  test("every post of the original is kept even past the copy's length", () => {
    const many = Array.from({ length: 60 }, (_, i) => live({ url: `https://f.example/${i}`, publishedAt: new Date(Date.UTC(2026, 7, 1 + (i % 28))) }));
    const out = copyItems(feed, [stored("https://f.example/old", 1)], many);
    assert.equal(out.length, 60);
  });

  test("the original unreachable: stored excerpts", () => {
    const out = copyItems(feed, [stored("https://f.example/1", 1)], null);
    assert.equal(out.length, 1);
    assert.equal(out[0].excerpt, "kept");
  });

  test("the owner chose excerpts: no whole posts, no enclosures", () => {
    const it = live({ url: "https://f.example/1", content: "<p>all</p>", media: [{ url: "https://f.example/1.mp3", type: "audio/mpeg" }] });
    const [out] = copyItems({ ...feed, copy: "excerpt" }, [], [it]);
    assert.equal(out.content, undefined);
    assert.equal(out.media, undefined);
  });
});

describe("toRss with whole posts", () => {
  test("content:encoded in CDATA that survives ]]>, one enclosure, thumbnail, channel image", () => {
    const xml = toRss({
      title: "F",
      link: "https://f.example/",
      self: "https://rss.mobi/feed/f/rss.xml",
      description: "d",
      image: "https://f.example/logo.png",
      items: [
        {
          feedSlug: "f",
          url: "https://f.example/1",
          title: "One",
          excerpt: "e",
          tags: [],
          image: "https://f.example/1.jpg",
          content: "<p>a ]]> b</p>",
          media: [
            { url: "https://f.example/1.mp3", type: "audio/mpeg", length: 10 },
            { url: "https://f.example/1.mp4", type: "video/mp4" },
          ],
        },
      ],
    });
    assert.match(xml, /<content:encoded><!\[CDATA\[<p>a ]]]]><!\[CDATA\[> b<\/p>\]\]><\/content:encoded>/);
    assert.equal(xml.match(/<enclosure /g)?.length, 1);
    assert.match(xml, /<media:content url="https:\/\/f\.example\/1\.mp4" type="video\/mp4"\/>/);
    assert.match(xml, /<media:thumbnail url="https:\/\/f\.example\/1\.jpg"\/>/);
    assert.match(xml, /<image>\s*<url>https:\/\/f\.example\/logo\.png<\/url>/);
    // An undated post carries no pubDate rather than a made-up one.
    assert.doesNotMatch(xml, /<pubDate>/);
  });
});

describe("subscribers", () => {
  test("reader counts from known readers only", () => {
    assert.deepEqual(readerCount("Feedly/1.0 (+http://www.feedly.com/fetcher.html; 16 subscribers; )"), { reader: "feedly", n: 16 });
    assert.deepEqual(readerCount("Mozilla/5.0 (compatible; inoreader.com; 9 subscribers)"), { reader: "inoreader", n: 9 });
    assert.deepEqual(readerCount("Feedbin feed-id:1524967 - 5 subscribers"), { reader: "feedbin", n: 5 });
    assert.equal(readerCount("Mozilla/5.0 (Macintosh)"), null);
    assert.equal(readerCount("MadeUp/1.0 (100000 subscribers)"), null);
  });
  test("a total of the last week's reports", () => {
    const now = Date.UTC(2026, 8, 25);
    const map = {
      feedly: { n: 16, at: new Date(now - 3600_000) },
      inoreader: { n: 9, at: new Date(now - 6 * 86400_000) },
      feedbin: { n: 5, at: new Date(now - 8 * 86400_000) },
    };
    assert.equal(subscriberTotal(map, now), 25);
    assert.equal(subscriberTotal(undefined, now), 0);
  });
});

// Vercel's runtime refuses require() of an ES module, which Node here
// allows: sanitize-html 2.17.2+ requires an ESM-only htmlparser2 and took
// every route that imports it down in production, with the tests green.
test("sanitize-html loads without require(esm), as on Vercel", () => {
  const r = spawnSync(process.execPath, ["--no-experimental-require-module", "-e", "require('sanitize-html')"], { cwd: new URL("..", import.meta.url) });
  assert.equal(r.status, 0, String(r.stderr));
});
