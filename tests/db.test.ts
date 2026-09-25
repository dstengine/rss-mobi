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
  const { pollDue, pollIfDue, store } = await import("../src/lib/catalog.ts");
  const { applyEdit, editable } = await import("../src/lib/edit.ts");
  const { noteSubscribers, storedPosts } = await import("../src/lib/copy.ts");
  const { itemJson, itemsFor, feedsByTag, tagPlace } = await import("../src/lib/views.ts");
  const { noteActivity } = await import("../src/lib/activity.ts");
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

  test("a seeded publisher's posts stay out of the index-check queue", async () => {
    const plain = await feed();
    const seeded = { ...(await feed()), checkIndex: false };
    await store(plain as any, parsed(plain.host, [1]));
    await store(seeded as any, parsed(seeded.host, [1]));
    const [a] = await (await items()).find({ feedId: plain._id }).toArray();
    const [b] = await (await items()).find({ feedId: seeded._id }).toArray();
    assert.equal(a.indexStatus, "queued");
    assert.ok(a.indexNextCheckAt);
    assert.equal(b.indexStatus, "skipped");
    assert.equal(b.indexNextCheckAt, null);
    const days = (d: Date | null) => Math.round((d!.getTime() - Date.now()) / 86_400_000);
    assert.equal(days(a.expiresAt), 90);
    assert.equal(days(b.expiresAt), 30);
  });

  test("a post dated in the future is dated when it was first seen", async () => {
    const f = await feed();
    const ahead = parsed(f.host, [1, 2]);
    ahead.items[0].publishedAt = new Date(Date.now() + 3_600_000);
    ahead.items[1].publishedAt = new Date("2026-09-01T00:00:00Z");
    const before = Date.now();
    await store(f as any, ahead);
    const got = Object.fromEntries((await (await items()).find({ feedId: f._id }).toArray()).map((it) => [it.guid, it.publishedAt.getTime()]));
    assert.ok(got.g1 >= before && got.g1 <= Date.now());
    assert.equal(got.g2, Date.parse("2026-09-01T00:00:00Z"));
  });

  test("the owner keeps the copy to excerpts and back; readers' counts are recorded", async () => {
    const f = await feed();
    await store(f as any, parsed(f.host, [1, 2]));
    assert.equal(editable(f as any).copy, "full");
    const short = (await applyEdit(f as any, { excerpts: true })) as any;
    assert.equal(short.copy, "excerpt");
    assert.equal(editable(short).copy, "excerpt");
    assert.equal(((await applyEdit(short, { excerpts: false })) as any).copy, "full");

    const posts = await storedPosts(f.slug);
    assert.equal(posts.length, 2);
    assert.ok(posts.every((p) => p.guid && p.excerpt !== undefined));

    await noteSubscribers(f as any, "Feedly/1.0 (+http://www.feedly.com/fetcher.html; 16 subscribers; )");
    await noteSubscribers(f as any, "Mozilla/5.0 (Macintosh)");
    const saved = await (await feeds()).findOne({ _id: f._id });
    assert.equal(saved?.subscribers?.feedly?.n, 16);
    assert.equal(Object.keys(saved?.subscribers ?? {}).length, 1);
  });

  test("a feed's pace and last post; a topic lists the lively first; an undated backlog is no pace", async () => {
    const tag = `shared-${new ObjectId()}`;
    const lively = await feed();
    const backlog = await feed();
    const third = await feed();
    await (await feeds()).updateMany({ _id: { $in: [lively._id, backlog._id, third._id] } }, { $set: { tags: [tag] } });
    const dated = parsed(lively.host, [1, 2, 3, 4, 5, 6, 7, 8]);
    dated.items.forEach((it, i) => (it.publishedAt = new Date(Date.now() - (i + 1) * 86_400_000)));
    await store({ ...lively, tags: [tag] } as any, dated);
    // Undated posts are stamped with the moment they were first read.
    const undated = parsed(backlog.host, [1, 2, 3]);
    undated.items.forEach((it) => delete (it as any).publishedAt);
    await store({ ...backlog, tags: [tag] } as any, undated);
    const one = parsed(third.host, [1]);
    one.items[0].publishedAt = new Date(Date.now() - 3_600_000);
    await store({ ...third, tags: [tag] } as any, one);

    for (const f of [lively, backlog, third]) await noteActivity(f as any);
    const col = await feeds();
    const a = await col.findOne({ _id: lively._id });
    const b = await col.findOne({ _id: backlog._id });
    assert.equal(a?.postsPerWeek, 7);
    assert.ok(a?.lastPostAt && Date.now() - a.lastPostAt.getTime() < 2 * 86_400_000);
    assert.equal(b?.postsPerWeek, 0);
    assert.equal(b?.lastPostAt, undefined);

    await col.updateMany({ _id: { $in: [lively._id, backlog._id, third._id] } }, { $set: { itemCount: 1 } });
    const listed = await feedsByTag(tag);
    assert.deepEqual(listed.map((f) => f.slug)[0], lively.slug);
    assert.equal(listed.at(-1)?.slug, backlog.slug);
    assert.deepEqual(await tagPlace({ ...listed[0], status: "active" }), { tag, place: 1, of: 3 });
  });

  test("reading polls the feeds read whose turn has come, and only those, once", async () => {
    const due = await feed();
    const other = await feed();
    const early = await feed();
    const col = await feeds();
    await col.updateOne({ _id: early._id }, { $set: { nextFetchAt: new Date(Date.now() + 3_600_000) } });
    // Two pages asking at once: the lock lets one of them poll.
    const reports = await Promise.all([pollIfDue([due.slug, early.slug]), pollIfDue([due.slug])]);
    assert.equal(reports[0].polled + reports[1].polled, 1);
    // .example never resolves, so the poll fails — and still takes its turn.
    const polled = await col.findOne({ _id: due._id });
    assert.equal(polled?.failCount, 1);
    assert.ok(polled!.nextFetchAt.getTime() > Date.now());
    assert.equal((await col.findOne({ _id: other._id }))?.failCount, 0);
    assert.equal((await col.findOne({ _id: early._id }))?.failCount, 0);
    assert.equal((await pollIfDue([due.slug])).polled, 0);
    assert.equal((await pollIfDue([])).polled, 0);
  });

  test("a read polls a feed past its own pace, however long the scheduler would let it wait", async () => {
    const idle = await feed();
    const col = await feeds();
    await col.updateMany({ _id: { $in: created } }, { $set: { nextFetchAt: new Date(Date.now() + 3_600_000) } });
    await col.updateOne({ _id: idle._id }, { $set: { nextFetchAt: new Date(Date.now() + 3 * 3_600_000), freshBy: new Date(Date.now() - 60_000) } });
    assert.equal((await pollDue(Date.now() + 20_000)).polled, 0);
    assert.equal((await pollIfDue([idle.slug])).polled, 1);
    const after = await col.findOne({ _id: idle._id });
    assert.ok(after?.readAt && Date.now() - after.readAt.getTime() < 60_000);
    // Failed (.example never resolves): a reader waits out the back-off too.
    assert.ok(after!.freshBy!.getTime() > Date.now());
    assert.equal((await pollIfDue([idle.slug])).polled, 0);
  });

  test("the scheduler takes a feed due within two minutes; a reader does not", async () => {
    const soon = await feed();
    const col = await feeds();
    // Only this feed is due: the others made here wait an hour.
    await col.updateMany({ _id: { $in: created } }, { $set: { nextFetchAt: new Date(Date.now() + 3_600_000) } });
    await col.updateOne({ _id: soon._id }, { $set: { nextFetchAt: new Date(Date.now() + 60_000) } });
    assert.equal((await pollIfDue([soon.slug])).polled, 0);
    const report = await pollDue(Date.now() + 20_000);
    assert.ok(report.polled >= 1);
    assert.equal((await col.findOne({ _id: soon._id }))?.failCount, 1);
  });
});
