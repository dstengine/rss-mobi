import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { perWeek, rankOf } from "../src/lib/activity.ts";
import { interval } from "../src/lib/catalog.ts";
import { iconCandidates, monogram, sniff } from "../src/lib/icon.ts";
import { pace, topicName } from "../src/lib/words.ts";

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 25);
const ago = (d: number) => new Date(now - d * DAY);

describe("pace", () => {
  test("posts in the last four weeks, per week", () => {
    assert.equal(perWeek({ first: ago(300), last: ago(1), recent: 8 }, now), 2);
  });
  test("a feed that carries two days of posts is measured over a week, not a month", () => {
    assert.equal(perWeek({ first: ago(2), last: ago(0), recent: 30 }, now), 30);
    assert.equal(perWeek({ first: ago(14), last: ago(0), recent: 30 }, now), 15);
  });
  test("one post from a new blog is one a week, not seven", () => {
    assert.equal(perWeek({ first: ago(0.04), last: ago(0.04), recent: 1 }, now), 1);
  });
  test("nothing lately is zero", () => {
    assert.equal(perWeek({ first: ago(80), last: ago(40), recent: 0 }, now), 0);
    assert.equal(perWeek(undefined, now), 0);
  });
  test("in words", () => {
    assert.equal(pace(12.6), "about 13 posts a week");
    assert.equal(pace(1), "about 1 post a week");
    assert.equal(pace(0.5), "about 2 posts a month");
    assert.equal(pace(0), "");
  });
});

test("a feed that posts several times a day is polled every quarter hour, a quiet one hourly", () => {
  assert.equal(interval(90), 15 * 60_000);
  assert.equal(interval(21), 15 * 60_000);
  assert.equal(interval(7), 30 * 60_000);
  assert.equal(interval(3), 60 * 60_000);
  assert.equal(interval(undefined), 60 * 60_000);
});

describe("rank", () => {
  test("followers and pace lift a feed; a firehose does not run away", () => {
    const quiet = rankOf({ followers: 0, perWeek: 1, lastPostAt: ago(2) }, now);
    const busy = rankOf({ followers: 0, perWeek: 14, lastPostAt: ago(0) }, now);
    const hose = rankOf({ followers: 0, perWeek: 500, lastPostAt: ago(0) }, now);
    const loved = rankOf({ followers: 200, perWeek: 1, lastPostAt: ago(2) }, now);
    assert.ok(busy > quiet);
    assert.equal(hose, busy);
    assert.ok(loved > busy);
  });
  test("a feed silent for months sinks below a live one", () => {
    const live = rankOf({ followers: 0, perWeek: 1, lastPostAt: ago(3) }, now);
    const dead = rankOf({ followers: 3, perWeek: 0, lastPostAt: ago(200) }, now);
    assert.ok(dead < live);
    assert.ok(rankOf({ followers: 0, perWeek: 0 }, now) < dead);
  });
});

describe("icons", () => {
  const page = "https://blog.example/";
  test("touch icon first, then the feed's image, the largest icon, favicon.ico", () => {
    const html = `<head>
      <link rel="icon" href="/fav-16.png" sizes="16x16">
      <link rel="icon" href="/fav-32.png" sizes="32x32">
      <link rel="mask-icon" href="/mask.svg">
      <link href="/touch.png" rel="apple-touch-icon">
      <link rel="stylesheet" href="/x.css">
    </head><body><link rel="icon" href="/late.png"></body>`;
    assert.deepEqual(iconCandidates(html, page, "https://cdn.example/logo.png"), [
      "https://blog.example/touch.png",
      "https://cdn.example/logo.png",
      "https://blog.example/fav-32.png",
      "https://blog.example/fav-16.png",
      "https://blog.example/favicon.ico",
    ]);
  });
  test("a page with nothing still tries favicon.ico", () => {
    assert.deepEqual(iconCandidates("", "https://blog.example/posts/"), ["https://blog.example/favicon.ico"]);
  });
  test("images are told by their bytes, not their label", () => {
    const pad = (head: number[]) => new Uint8Array([...head, ...new Array(80).fill(0)]);
    assert.equal(sniff(pad([0x89, 0x50, 0x4e, 0x47])), "image/png");
    assert.equal(sniff(pad([0, 0, 1, 0])), "image/x-icon");
    assert.equal(sniff(new TextEncoder().encode(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${" ".repeat(80)}</svg>`)), "image/svg+xml");
    assert.equal(sniff(new TextEncoder().encode(`<!doctype html><html><head><title>Not found</title></head>${" ".repeat(80)}`)), null);
    assert.equal(sniff(pad([0x47, 0x49]).subarray(0, 10)), null);
  });
  test("a stand-in is the initial, escaped, in a fixed colour", () => {
    assert.match(monogram("<b>", "x"), />B<\/text>/);
    assert.match(monogram("<>", "x"), />#<\/text>/);
    assert.match(monogram("daring fireball", "df"), />D<\/text>/);
    assert.equal(monogram("A", "same"), monogram("A", "same"));
  });
});

describe("topic names", () => {
  test("headings and sentences", () => {
    assert.equal(topicName("web-development"), "Web Development");
    assert.equal(topicName("web-development", false), "web development");
    assert.equal(topicName("llms"), "LLMs");
    assert.equal(topicName("generative-ai", false), "generative AI");
    assert.equal(topicName("ios"), "iOS");
    assert.equal(topicName("apple", false), "Apple");
    assert.equal(topicName("state-of-the-art"), "State of the Art");
  });
});
