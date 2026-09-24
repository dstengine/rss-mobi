// Against a real MongoDB: what only the database can show. Runs when
// RSS_MOBI_TEST_MONGO points at a disposable server (CI starts one; locally,
// the mongo:7 container from the README) and is skipped otherwise. It uses
// the rssmobi_test database and removes only the documents it created.
//
//   RSS_MOBI_TEST_MONGO="mongodb://127.0.0.1:27018/?directConnection=true" npm test
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

const URI = process.env.RSS_MOBI_TEST_MONGO;
if (URI) {
  process.env.MONGODB_CONNECTION_STRING = URI;
  process.env.MONGODB_DB = "rssmobi_test";
}
const skip = !URI && "RSS_MOBI_TEST_MONGO not set";

describe("with MongoDB", { skip }, async () => {
  const { client, feeds, items } = await import("../src/lib/db.ts");
  const { store } = await import("../src/lib/catalog.ts");
  const { applyEdit } = await import("../src/lib/edit.ts");
  const { itemJson, itemsFor } = await import("../src/lib/views.ts");
  const { parseFilters } = await import("../src/lib/filters.ts");
  const { linkTo } = await import("../src/lib/policy.ts");
  const created: ObjectId[] = [];

  after(async () => {
    if (!created.length) return;
    await (await items()).deleteMany({ feedId: { $in: created } });
    await (await feeds()).deleteMany({ _id: { $in: created } });
    await (await client()).close();
  });

  async function feed() {
    const _id = new ObjectId();
    created.push(_id);
    const now = new Date();
    const doc = {
      _id,
      slug: `test-${_id}`,
      url: `https://${_id}.example/feed`,
      canonicalUrl: `https://${_id}.example/feed`,
      siteUrl: `https://${_id}.example/`,
      host: `${_id}.example`,
      title: "Test feed",
      description: "",
      lang: "en",
      tags: [`t${_id}`],
      format: "rss",
      status: "active" as const,
      editHash: "x",
      nextFetchAt: now,
      failCount: 0,
      okCount: 1,
      itemCount: 0,
      robots: null,
      linkMode: null,
      createdAt: now,
      updatedAt: now,
    };
    await (await feeds()).insertOne(doc);
    return doc;
  }

  const post = (host: string, n: number) => ({ guid: `g${n}`, url: `https://${host}/p/${n}`, title: `Post ${n}`, excerpt: "", tags: [], publishedAt: new Date() });
  const parsed = (host: string, ns: number[]) => ({ format: "rss" as const, title: "Test feed", description: "", siteUrl: "", lang: "en", items: ns.map((n) => post(host, n)) });

  test("an owner's nofollow reaches every link to the feed's posts, old and new, and can be taken back", async () => {
    const f = await feed();
    await store(f as any, parsed(f.host, [1, 2]));

    const edited = (await applyEdit(f as any, { nofollow: true })) as any;
    assert.equal(edited.linkMode, "nofollow");
    await store(edited, parsed(f.host, [3]));

    // Read the way a topic page, the reader and the API read: items alone.
    const listed = await itemsFor(parseFilters(new URLSearchParams({ tag: f.tags[0], limit: "10" })));
    assert.equal(listed.length, 3);
    for (const it of listed) {
      assert.equal(linkTo(it).rel, "ugc nofollow", it.url);
      assert.equal(itemJson(it).link.rel, "ugc nofollow");
    }

    await applyEdit(edited, { nofollow: false });
    const after = await (await items()).find({ feedId: f._id }).toArray();
    assert.ok(after.every((it) => it.linkMode === null));
  });
});
