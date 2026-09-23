import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFeed, NotAFeed, itemKey, tag, withoutTitle } from "../src/lib/feeds/parse.ts";
import { alternates, normalizeInput } from "../src/lib/feeds/discover.ts";
import { canonical, key, unescape, clip, slugify } from "../src/lib/feeds/url.ts";
import { assertPublic, isPrivate, decode } from "../src/lib/feeds/get.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parseFeed", () => {
  test("RSS 2.0", () => {
    const f = parseFeed(fixture("rss2.xml"), "https://example.com/feed/");
    assert.equal(f.format, "rss");
    assert.equal(f.title, "Example & Co Blog");
    assert.equal(f.description, "Notes on building things");
    assert.equal(f.lang, "en");
    // The item with neither link nor permalink guid is dropped.
    assert.equal(f.items.length, 3);

    const [first, untitled, byGuid] = f.items;
    assert.equal(first.guid, "post-1");
    assert.equal(first.title, "First post");
    assert.equal(first.excerpt, "Hello & welcome 👋 to the first post.");
    assert.equal(first.author, "Ann");
    assert.deepEqual(first.tags, ["web-dev", "rss"]);
    assert.equal(first.image, "https://example.com/img/first.jpg");
    assert.equal(first.publishedAt?.toISOString(), "2026-09-21T10:00:00.000Z");

    assert.match(untitled.title, /^A microblog post/);
    assert.equal(byGuid.url, "https://example.com/by-guid");
    assert.equal(byGuid.image, "https://cdn.example.com/a.png");
  });

  test("RSS 1.0 / RDF", () => {
    const f = parseFeed(fixture("rdf.xml"), "https://old.example.org/index.rdf");
    assert.equal(f.format, "rdf");
    assert.equal(f.lang, "de");
    assert.equal(f.items.length, 1);
    assert.equal(f.items[0].url, "https://old.example.org/a");
    assert.deepEqual(f.items[0].tags, ["archiv"]);
  });

  test("Atom", () => {
    const f = parseFeed(fixture("atom.xml"), "https://atom.example.net/feed.xml");
    assert.equal(f.format, "atom");
    // type="html": the decoded title is markup, and <Feed> is a tag in it.
    assert.equal(f.title, "Atom");
    assert.equal(f.siteUrl, "https://atom.example.net/");
    assert.equal(f.lang, "fr");
    assert.equal(f.items[0].url, "https://atom.example.net/posts/entree");
    assert.equal(f.items[0].excerpt, "Résumé");
    assert.equal(f.items[0].author, "Zoé");
    assert.deepEqual(f.items[0].tags, ["cuisine"]);
  });

  test("JSON Feed", () => {
    const f = parseFeed(fixture("feed.json"), "https://json.example.com/feed.json");
    assert.equal(f.format, "json");
    assert.equal(f.lang, "es");
    assert.equal(f.items.length, 1);
    assert.deepEqual(f.items[0].tags, ["noticias"]);
  });

  test("broken XML yields nothing usable; non-feeds are NotAFeed", () => {
    // The parser is lenient on purpose — real feeds are often slightly
    // invalid — so a broken one either throws or comes back empty, and an
    // empty feed fails submission on its own.
    try {
      assert.equal(parseFeed(fixture("broken.xml"), "https://x.test/").items.length, 0);
    } catch (e) {
      assert.ok(e instanceof NotAFeed);
    }
    assert.throws(() => parseFeed(fixture("page.html"), "https://x.test/"), NotAFeed);
    assert.throws(() => parseFeed('{"a":1}', "https://x.test/"), NotAFeed);
    assert.throws(() => parseFeed("plain text", "https://x.test/"), NotAFeed);
  });

  test("hundreds of ordinary entities do not trip the expansion limit", () => {
    const f = parseFeed(fixture("many-entities.xml"), "https://big.example.com/");
    assert.equal(f.items.length, 100); // capped at ITEMS_MAX
    assert.equal(f.items[0].title, "Tom & Jerry 0");
    assert.equal(f.items[0].url, "https://big.example.com/0?a=1&b=2");
  });

  test("a feed declared as windows-1251 decodes", () => {
    const bytes = readFileSync(new URL("./fixtures/cp1251.xml", import.meta.url));
    const f = parseFeed(decode(bytes), "https://ru.example.com/");
    assert.equal(f.title, "Новости");
    assert.equal(f.items[0].title, "Привет");
  });

  test("itemKey prefers a real guid, else the canonical link", () => {
    const f = parseFeed(fixture("rss2.xml"), "https://example.com/feed/");
    assert.equal(itemKey(f.items[0]), "post-1");
    assert.equal(itemKey(f.items[2]), "https://example.com/by-guid");
  });
});

describe("discovery", () => {
  test("alternates: feeds only, resolved, comment feeds last", () => {
    const found = alternates(fixture("page.html"), "https://example.com/blog/");
    assert.deepEqual(found.map((f) => f.url), [
      "https://example.com/feed/",
      "https://example.com/atom.xml",
      "https://example.com/comments/feed/",
    ]);
  });

  test("normalizeInput adds https to a bare domain", () => {
    assert.equal(normalizeInput(" example.com/blog "), "https://example.com/blog");
    assert.equal(normalizeInput("http://example.com"), "http://example.com");
  });
});

describe("url helpers", () => {
  test("canonical drops what does not tell two pages apart", () => {
    assert.equal(canonical("http://www.example.com/a/?utm_source=x&id=2#top"), "https://example.com/a?id=2");
  });
  test("key", () => assert.equal(key("Café — Déjà Vu!"), "cafe deja vu"));
  test("unescape keeps astral characters whole", () => assert.equal(unescape("&#x1F600; ok"), "😀 ok"));
  test("clip cuts at a word", () => assert.equal(clip("one two three four", 14), "one two three…"));
  test("slugify falls back when nothing latin is left", () => {
    assert.equal(slugify("Hello, World"), "hello-world");
    assert.equal(slugify("Новости", "feed-1"), "feed-1");
  });

  test("slugify keeps the name, drops the tagline, and cuts between words", () => {
    assert.equal(slugify("Simon Willison's Weblog"), "simon-willisons-weblog");
    assert.equal(slugify("Articles on Smashing Magazine — For Web Designers And Developers"), "articles-on-smashing-magazine");
    assert.equal(slugify("Hacker News: Front Page"), "hacker-news");
    assert.equal(slugify("Tech - A very long name for a blog about many different small things"), "tech");
    assert.equal(slugify("A very long name for a blog about many different small things indeed"), "a-very-long-name-for-a-blog-about-many-different");
    assert.equal(slugify("x-ray"), "x-ray");
  });
  test("tag", () => {
    assert.equal(tag("Web Dev"), "web-dev");
    assert.equal(tag("x"), "");
    assert.equal(tag("Новости"), "новости");
  });
});

describe("fetch safety", () => {
  const resolveTo = (ip: string) => async () => [ip];
  test("private and metadata addresses are refused", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      assert.ok(isPrivate(ip), ip);
      await assert.rejects(assertPublic("https://evil.test/", resolveTo(ip)), /private/);
    }
  });
  test("public addresses pass", async () => {
    assert.equal(isPrivate("93.184.216.34"), false);
    await assertPublic("https://example.com/feed", resolveTo("93.184.216.34"));
  });
  test("schemes, ports, credentials and local names are refused", async () => {
    await assert.rejects(assertPublic("file:///etc/passwd"), /http/);
    await assert.rejects(assertPublic("https://example.com:8080/", resolveTo("93.184.216.34")), /port/);
    await assert.rejects(assertPublic("https://u:p@example.com/", resolveTo("93.184.216.34")), /credentials/);
    await assert.rejects(assertPublic("http://localhost/"), /private/);
  });
});

test("an excerpt that opens with the title does not repeat it", () => {
  assert.equal(withoutTitle("SF October 14th: A Session I'm hosting an evening event", "SF October 14th: A Session"), "I'm hosting an evening event");
  assert.equal(withoutTitle("Hello world. More text", "Hello world"), "More text");
  assert.equal(withoutTitle("Different start", "Hello"), "Different start");
  assert.equal(withoutTitle("Only the title", "Only the title"), "");
});
