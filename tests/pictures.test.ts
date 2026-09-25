// What makes a post's picture: where an article names one, what size is
// worth showing, and which sizes a picture is wide enough for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSize, pageCandidates, pictureUrl, render, usable } from "../src/lib/pictures.ts";
import sharp from "sharp";

test("an article's share picture is found in its head, best first, made absolute", () => {
  const html = `<html><head>
    <link rel="image_src" href="//cdn.example/c.jpg">
    <meta name="twitter:image" content="https://cdn.example/b.png">
    <meta content="/a.jpg?w=1200&amp;h=630" property="og:image">
    <meta property="og:image:width" content="1200">
    </head><body><meta property="og:image" content="/in-body.jpg"></body></html>`;
  assert.deepEqual(pageCandidates(html, "https://site.example/post/1"), [
    "https://site.example/a.jpg?w=1200&h=630",
    "https://cdn.example/b.png",
    "https://cdn.example/c.jpg",
  ]);
  assert.deepEqual(pageCandidates(`<meta property="og:image" content="data:image/png;base64,xx">`, "https://site.example/"), []);
  assert.deepEqual(pageCandidates("", "https://site.example/"), []);
});

test("icons, pixels and banners are not pictures", () => {
  assert.ok(usable(1200, 630));
  assert.ok(usable(160, 90));
  assert.ok(!usable(64, 64));
  assert.ok(!usable(1, 1));
  assert.ok(!usable(1600, 200));
  assert.ok(!usable(200, 1000));
});

test("a picture is offered only at the sizes it is wide enough for", () => {
  const it = (w: number) => ({ id: "0123456789abcdef01234567", picture: { url: "https://x.example/p.jpg", w, h: Math.round(w / 2) } });
  assert.equal(pictureUrl(it(200), "thumb.webp"), "/item/0123456789abcdef01234567/image/thumb.webp");
  assert.equal(pictureUrl(it(200), "card.webp"), null);
  assert.equal(pictureUrl(it(500), "og.jpg"), null);
  assert.equal(pictureUrl(it(1200), "og.jpg"), "/item/0123456789abcdef01234567/image/og.jpg");
  assert.equal(pictureUrl({ id: "x", picture: null }, "thumb.webp"), null);
  assert.equal(pictureUrl({ id: "x" }, "thumb.webp"), null);
  assert.ok(isSize("card.webp"));
  assert.ok(!isSize("constructor"));
  assert.ok(!isSize("big.png"));
});

test("each size comes out at its own dimensions and format", async () => {
  const png = await sharp({ create: { width: 800, height: 600, channels: 4, background: "#c2410c" } }).png().toBuffer();
  for (const [name, w, h, format] of [["thumb.webp", 168, 168, "webp"], ["card.webp", 720, 378, "webp"], ["og.jpg", 1200, 630, "jpeg"]] as const) {
    const out = await render(new Uint8Array(png), name);
    const meta = await sharp(out.body).metadata();
    assert.deepEqual([meta.width, meta.height, meta.format], [w, h, format], name);
    assert.equal(out.type, `image/${format}`);
  }
});
