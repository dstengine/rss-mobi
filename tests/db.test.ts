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
  const { itemJson, itemsFor, feedsByTag, recentFeeds, tagPlace } = await import("../src/lib/views.ts");
  const { noteActivity } = await import("../src/lib/activity.ts");
  const { apiKeys } = await import("../src/lib/db.ts");
  const { createKey, revokeKey } = await import("../src/lib/keys.ts");
  const { access, requireScope } = await import("../src/lib/http.ts");
  const { block, hideFeed, unblock } = await import("../src/lib/admin.ts");
  const { blocklist, events, metricsDaily } = await import("../src/lib/db.ts");
  const { readout, rollUp, totals } = await import("../src/lib/metrics.ts");
  const { claim, decide, release, storyAt, submit } = await import("../src/lib/stories.ts");
  const { stories } = await import("../src/lib/db.ts");
  const storiesMade: ObjectId[] = [];
  const METRIC_DAY = "2001-02-03";
  const { parseFilters } = await import("../src/lib/filters.ts");
  const { linkTo } = await import("../src/lib/policy.ts");
  const created: ObjectId[] = [];

  const keysMade: ObjectId[] = [];
  const hostsBlocked: string[] = [];

  after(async () => {
    if (keysMade.length) await (await apiKeys()).deleteMany({ _id: { $in: keysMade } });
    if (hostsBlocked.length) await (await blocklist()).deleteMany({ _id: { $in: hostsBlocked } });
    await (await events()).deleteMany({ at: { $gte: new Date(`${METRIC_DAY}T00:00:00Z`), $lt: new Date("2001-02-05T00:00:00Z") } });
    await (await metricsDaily()).deleteMany({ day: { $in: [METRIC_DAY, "2001-02-04"] } });
    if (storiesMade.length) await (await stories()).deleteMany({ _id: { $in: storiesMade } });
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

  test("the newest feeds list one per site", async () => {
    const a = await feed();
    const b = await feed();
    await (await feeds()).updateMany({ _id: { $in: [a._id, b._id] } }, { $set: { host: "same-site.example", itemCount: 3 } });
    await (await feeds()).updateOne({ _id: b._id }, { $set: { createdAt: new Date(Date.now() + 1_000) } });
    const list = await recentFeeds(500);
    const hosts = list.map((f) => f.host);
    assert.equal(new Set(hosts).size, hosts.length);
    assert.equal(list.find((f) => f.host === "same-site.example")?.slug, b.slug);
  });

  describe("API keys", () => {
    const call = (token?: string, ip = "203.0.113.9") =>
      ({
        request: new Request("https://rss.mobi/api/v1/items", { headers: token ? { authorization: `Bearer ${token}` } : {} }),
        url: new URL("https://rss.mobi/api/v1/items"),
        clientAddress: ip,
      }) as any;
    const make = async (scopes: string[], rate?: number) => {
      const made = await createKey("test-site", scopes, rate);
      keysMade.push(made.key._id);
      return made;
    };

    test("a key reads at its own rate, and nothing but its hash is stored", async () => {
      const { token, key } = await make(["read:full"], 2);
      assert.match(token, /^rmk_[\w-]{32}$/);
      const stored = await (await apiKeys()).findOne({ _id: key._id });
      assert.equal(stored?.prefix, token.slice(4, 12));
      assert.ok(!JSON.stringify(stored).includes(token));

      const a = await access(call(token));
      assert.ok(!(a instanceof Response) && a.key?.name === "test-site");
      await access(call(token));
      const over = await access(call(token));
      assert.ok(over instanceof Response && over.status === 429);
      assert.ok(Number(over.headers.get("retry-after")) >= 1);
      // Nobody's key: the anonymous allowance, untouched by the key's.
      const anon = await access(call(undefined, "198.51.100.7"));
      assert.ok(!(anon instanceof Response) && anon.key === null);
    });

    test("a revoked or unknown key is refused, not read as anonymous", async () => {
      const { token, key } = await make([]);
      assert.ok(!((await access(call(token))) instanceof Response));
      assert.equal((await revokeKey(key.prefix))?.name, "test-site");
      const gone = await access(call(token));
      assert.ok(gone instanceof Response && gone.status === 401);
      const made_up = await access(call("rmk_notakeynotakeynotakeynotakey00"));
      assert.ok(made_up instanceof Response && made_up.status === 401);
      assert.equal(await revokeKey(key.prefix), null);
    });

    test("scopes: admin holds them all, a reading key none", async () => {
      const reader = await make([]);
      const admin = await make(["admin"]);
      const r = await requireScope(call(reader.token), "write:feeds");
      assert.ok(r instanceof Response && r.status === 403);
      assert.ok(!((await requireScope(call(admin.token), "write:feeds")) instanceof Response));
      const none = await requireScope(call(), "admin");
      assert.ok(none instanceof Response && none.status === 401);
      await assert.rejects(createKey("x", ["root"]), /unknown scope/);
    });
  });

  describe("admin", () => {
    const visible = async (id: ObjectId) => (await (await items()).find({ feedId: id }).toArray()).map((it) => it.visible);

    test("a block takes down a host's feeds, its subdomains' too, and lifting it brings back only those", async () => {
      const a = await feed();
      const sub = await feed();
      const byHand = await feed();
      const host = `${a._id}.example`;
      hostsBlocked.push(host);
      await (await feeds()).updateOne({ _id: sub._id }, { $set: { host: `news.${host}` } });
      await (await feeds()).updateOne({ _id: byHand._id }, { $set: { host: `blog.${host}` } });
      await store(a as any, parsed(a.host, [1, 2]));
      assert.deepEqual(await visible(a._id), [true, true]);

      const r = await hideFeed(byHand.slug, true, "test-admin", "spam");
      assert.ok(r !== "missing" && r !== "blocked" && r.feed.hiddenBy === "admin");

      const down = await block(host, "spam", "test-admin");
      assert.deepEqual(down.sort(), [a.slug, sub.slug].sort());
      assert.deepEqual(await visible(a._id), [false, false]);
      assert.equal((await (await feeds()).findOne({ _id: a._id }))?.hiddenBy, "blocklist");
      assert.equal(await hideFeed(a.slug, false, "test-admin"), "blocked");

      const back = await unblock(host, "test-admin");
      assert.deepEqual(back?.sort(), [a.slug, sub.slug].sort());
      assert.deepEqual(await visible(a._id), [true, true]);
      const still = await (await feeds()).findOne({ _id: byHand._id });
      assert.equal(still?.status, "hidden");
      assert.equal(await unblock(host, "test-admin"), null);
    });

    test("a block takes an owner-hidden feed too, and lifting it puts each feed back as it was", async () => {
      const own = await feed();
      const dead = await feed();
      const host = `${own._id}.example`;
      hostsBlocked.push(host);
      await (await feeds()).updateOne({ _id: dead._id }, { $set: { host: `old.${host}`, status: "disabled" } });
      const hidden = (await applyEdit(own as any, { hidden: true })) as any;
      assert.equal(hidden.hiddenBy, "owner");

      assert.deepEqual((await block(host, "spam", "test-admin")).sort(), [own.slug, dead.slug].sort());
      const blocked = (await (await feeds()).findOne({ _id: own._id }))!;
      assert.equal(blocked.hiddenBy, "blocklist");
      const refused = await applyEdit(blocked, { hidden: false });
      assert.ok(refused instanceof Response && refused.status === 403);

      await unblock(host, "test-admin");
      const [o, d] = await Promise.all([(await feeds()).findOne({ _id: own._id }), (await feeds()).findOne({ _id: dead._id })]);
      assert.deepEqual([o?.status, o?.hiddenBy, o?.prior], ["hidden", "owner", undefined]);
      assert.deepEqual([d?.status, d?.hiddenBy], ["disabled", undefined]);
    });

    test("an owner cannot undo a takedown with the edit link, but can their own", async () => {
      const f = await feed();
      await hideFeed(f.slug, true, "test-admin");
      const taken = (await (await feeds()).findOne({ _id: f._id }))!;
      assert.equal(editable(taken).takenDown, true);
      const refused = await applyEdit(taken, { hidden: false });
      assert.ok(refused instanceof Response && refused.status === 403);
      // Other changes still go through, and it stays down.
      const tagged = (await applyEdit(taken, { hidden: true, tags: ["science"] })) as any;
      assert.equal(tagged.status, "hidden");
      assert.deepEqual(tagged.tags, ["science"]);

      await hideFeed(f.slug, false, "test-admin");
      const own = (await applyEdit((await (await feeds()).findOne({ _id: f._id }))!, { hidden: true })) as any;
      assert.equal(own.hiddenBy, "owner");
      assert.equal(((await applyEdit(own, { hidden: false })) as any).status, "active");
    });
  });

  describe("metrics", () => {
    const at = (h: number) => new Date(`${METRIC_DAY}T${String(h).padStart(2, "0")}:00:00Z`);
    const exp = { id: "test-exp", variants: [{ id: "a" }, { id: "b" }] };

    test("a day rolls up by metric and variant, and rolling it up again changes nothing", async () => {
      const e = await events();
      await e.insertMany([
        ...Array.from({ length: 40 }, (_, i) => ({ name: "view", path: "/reader/", at: at(1), exp: { "test-exp": i < 20 ? "a" : "b" } })),
        ...Array.from({ length: 2 }, () => ({ name: "follow", path: "/reader/", at: at(2), exp: { "test-exp": "a" } })),
        ...Array.from({ length: 8 }, () => ({ name: "follow", path: "/reader/", at: at(2), exp: { "test-exp": "b" } })),
        { name: "view", path: "/feed/x/", at: at(3) },
        { name: "subscribe_copy", label: "topic", path: "/tag/ai/", at: at(4) },
        { name: "subscribe_copy", label: "junk", path: "/tag/ai/", at: at(4) },
        // The next day's, which this day must not count.
        { name: "view", path: "/", at: new Date("2001-02-04T00:00:00Z") },
      ]);
      assert.ok((await rollUp(METRIC_DAY)) > 0);
      const read = async () => (await (await metricsDaily()).find({ day: METRIC_DAY }, { projection: { _id: 0, updatedAt: 0 } }).sort({ metric: 1, variant: 1 }).toArray());
      const first = await read();
      await rollUp(METRIC_DAY);
      assert.deepEqual(await read(), first);

      const t = await totals(METRIC_DAY, METRIC_DAY);
      assert.equal(t.view, 41);
      assert.equal(t["view:reader"], 40);
      assert.equal(t["view:feed"], 1);
      assert.equal(t.follow, 10);
      assert.equal(t.subscribe_copy, 2);
      assert.equal(t["subscribe_copy:topic"], 1);
      assert.equal(t["view:home"], undefined);
      assert.equal((await totals(METRIC_DAY, METRIC_DAY, "test-exp=b")).follow, 8);

      const r = await readout(exp, "follow", "view:reader", METRIC_DAY, METRIC_DAY);
      assert.deepEqual(r.arms.map((a) => [a.variant, a.exposures, a.conversions]), [["a", 20, 2], ["b", 20, 8]]);
      assert.ok(r.tests[0].z > 0 && r.tests[0].p < 0.05);
    });

    test("a row the events no longer support goes on the next roll-up", async () => {
      await (await events()).deleteMany({ name: "subscribe_copy", at: at(4) });
      await rollUp(METRIC_DAY);
      const t = await totals(METRIC_DAY, METRIC_DAY);
      assert.equal(t.subscribe_copy, undefined);
      assert.equal(t["subscribe_copy:topic"], undefined);
      assert.equal(t.view, 41);
    });
  });

  describe("story jobs", () => {
    const para = (i: number) => `Paragraph ${i} explains in plain words what the two reports said about the launch, how it differs from the tests before it, and why reaching orbit matters for the satellites the company plans to fly.`;
    const story = (cited: string[]) => ({
      headline: "Test rocket reaches orbit on its first full flight",
      dek: "The company's big rocket reached orbit for the first time and deployed its first satellites, two sites report.",
      sections: [0, 1, 2].map((s) => ({ heading: `Section ${s}`, paragraphs: [0, 1, 2, 3].map((p) => para(s * 4 + p)) })),
      keyPoints: ["The rocket reached orbit on its first full flight.", "It deployed its first satellites on the way.", "Both reports call it the programme's biggest step."],
      cited,
    });

    test("a job is claimed by one worker, written, filed for review and published", async () => {
      const _id = new ObjectId();
      storiesMade.push(_id);
      const now = new Date();
      const sources = [
        { itemId: new ObjectId(), url: `https://a.example/${_id}`, title: "Rocket reaches orbit", host: "a.example", feedSlug: "a", publishedAt: now, excerpt: "It flew." },
        { itemId: new ObjectId(), url: `https://b.example/${_id}`, title: "Big rocket in orbit", host: "b.example", feedSlug: "b", publishedAt: now, excerpt: "It flew too." },
      ];
      await (await stories()).insertOne({ _id, status: "queued", score: 1e6, hosts: 2, sources, createdAt: now, updatedAt: now });

      const got = await claim("worker01", String(_id));
      assert.equal(got?.status, "claimed");
      assert.equal(await claim("worker02", String(_id)), null);
      assert.equal((await submit(String(_id), { prefix: "worker02", name: "other" }, story(sources.map((x) => x.url)))).status, 409);

      const bad = await submit(String(_id), { prefix: "worker01", name: "test worker" }, story([sources[0].url]));
      assert.equal(bad.status, 422);
      const ok = await submit(String(_id), { prefix: "worker01", name: "test worker" }, story(sources.map((x) => x.url)));
      assert.equal(ok.status, 200);
      const filed = ok.story!;
      assert.equal(filed.status, "review");
      assert.equal(filed.slug, "test-rocket-reaches-orbit-on-its-first-full-flight");
      assert.equal(filed.claimedBy, undefined);
      assert.equal((await storyAt(filed.day!, filed.slug!))?.headline, filed.headline);

      assert.equal((await decide(String(_id), "published"))?.status, "published");
      assert.ok((await (await stories()).findOne({ _id }))?.publishedAt);
    });

    test("a lapsed lease frees the job; a worker can hand it back or reject it", async () => {
      const _id = new ObjectId();
      storiesMade.push(_id);
      const now = new Date();
      await (await stories()).insertOne({ _id, status: "queued", score: 0, hosts: 2, sources: [], createdAt: now, updatedAt: now });
      await claim("worker01", String(_id), new Date(now.getTime() - 60 * 60_000));
      assert.equal((await claim("worker02", String(_id)))?.claimedBy, "worker02");
      assert.equal(await release(String(_id), "worker01"), null);
      assert.equal((await release(String(_id), "worker02"))?.status, "queued");
      await claim("worker02", String(_id));
      const rejected = await release(String(_id), "worker02", { reject: true, reason: "two stories in one" });
      assert.deepEqual([rejected?.status, rejected?.reason], ["rejected", "two stories in one"]);
      assert.equal(await storyAt("2001-01-01", "nothing"), null);
    });
  });
});
