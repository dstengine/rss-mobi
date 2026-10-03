// Written stories, and the jobs they start as. A job is a story several
// sites are covering (clusters.ts) with its sources; a worker — any holder
// of a write:stories key: a script calling a model, or a person — claims
// it for LEASE_MIN minutes, reads the sources in full at their addresses,
// and sends the story back. The server checks what it can check (shape,
// length, sources, copied wording) and files it for review; an admin
// publishes it. Nothing a worker sends goes live on its own.
import { ObjectId } from "mongodb";
import { items, stories } from "./db.ts";
import { cluster, sensitive, type Cluster } from "./clusters.ts";
import { key, slugify } from "./feeds/url.ts";
import { SITE } from "./env.ts";
import type { StoryDoc, StorySection, StorySource } from "./types.ts";

export const LEASE_MIN = 30;
/** A job nobody has finished in this long is about old news. */
export const STALE_H = 48;
/** Leases a job may lapse before it is taken off the queue: a cluster
    every worker gives up on is one no worker will finish. */
export const MAX_LAPSES = 3;
export const WORDS = { min: 400, max: 900 };
/** Sources a job carries: one per site first, then more. */
const MAX_SOURCES = 10;
/** Consecutive words a story may not share with a source. */
const COPY_RUN = 8;

/** What a worker is asked to write. Sent with every job. */
export const BRIEF = `Write one news story, in English, from the sources in this job.

- Read every source in full at its address first; the excerpts here are only a guide. Rely on what the sources report, and nothing else: no guesses, no background you cannot find in them.
- 400 to 800 words: a headline, a dek (one or two sentences that say what happened), three to six sections with short headings — what happened, the context, what it means — and three to five key points.
- Your own words throughout. Never reuse eight or more consecutive words from a source. Titles of songs, films and books, and short attributed quotes, go in double quotation marks: quoted text is exempt, but each quotation stays under twelve words, and all of them together under sixty.
- Name who reported what when the sources differ or a figure comes from one of them. Keep the tone plain and neutral.
- Cite at least two sources from different sites, by their addresses as given here.
- If the sources are really two different stories, write the main one from the sources about it, or reject the job with the reason. Reject it too if it is about crime, sexual violence or a death involving private people, a case before a court, or medical or financial advice.
- Plain text only: no HTML, no Markdown, no links in the text.`;

/* ------------------------------------------------------------- queueing */

const pick = (c: Cluster): StorySource[] => {
  // One post can reach us through several feeds of one publisher; the job
  // lists its address once.
  const urls = new Set<string>();
  const byTime = [...c.posts].sort((a, b) => +a.publishedAt - +b.publishedAt).filter((p) => !urls.has(p.url) && urls.add(p.url));
  const seen = new Set<string>();
  const first = byTime.filter((p) => !seen.has(p.host) && seen.add(p.host));
  const rest = byTime.filter((p) => !first.includes(p));
  return [...first, ...rest].slice(0, MAX_SOURCES).map((p) => ({
    itemId: new ObjectId(p.id),
    url: p.url,
    title: p.title,
    host: p.host,
    feedSlug: p.feedSlug,
    publishedAt: p.publishedAt,
    excerpt: p.excerpt,
  }));
};

/** Queues the best stories of the last two days that no job covers yet:
    up to `max` new jobs. A cluster sharing any post with an existing job,
    written or rejected, is one we have already dealt with. */
export async function enqueue(max = 5, now = new Date()): Promise<{ queued: number; clusters: number; sensitive: number; known: number }> {
  const rows = await (await items())
    .find(
      { visible: true, lang: "en", publishedAt: { $gte: new Date(now.getTime() - 48 * 3_600_000), $lte: now } },
      { projection: { title: 1, excerpt: 1, url: 1, host: 1, feedSlug: 1, publishedAt: 1 } },
    )
    .toArray();
  const found = cluster(
    rows.map((r) => ({ id: String(r._id), title: r.title, excerpt: r.excerpt ?? "", url: r.url, host: r.host, feedSlug: r.feedSlug, publishedAt: r.publishedAt })),
    { now: now.getTime() },
  );
  const col = await stories();
  let queued = 0;
  let skippedSensitive = 0;
  let known = 0;
  for (const c of found) {
    if (queued >= max) break;
    if (sensitive(c)) {
      skippedSensitive++;
      continue;
    }
    const ids = c.posts.map((p) => new ObjectId(p.id));
    if (await col.findOne({ "sources.itemId": { $in: ids } }, { projection: { _id: 1 } })) {
      known++;
      continue;
    }
    await col.insertOne({
      _id: new ObjectId(),
      status: "queued",
      score: Math.round(c.score * 100) / 100,
      hosts: c.hosts,
      sources: pick(c),
      createdAt: now,
      updatedAt: now,
    });
    queued++;
  }
  return { queued, clusters: found.length, sensitive: skippedSensitive, known };
}

/* -------------------------------------------------------------- sweeping */

/** Clears the queue of what nobody will write: jobs older than STALE_H
    hours, and jobs whose lease has lapsed MAX_LAPSES times. A lapsed
    claim with lapses to spare goes back to waiting, counted; a lapsed
    revision goes back to review, as written. Rejected jobs keep their
    posts, so their clusters are never queued again. */
export async function sweep(now = new Date()): Promise<{ stale: number; abandoned: number; requeued: number; revisions: number }> {
  const col = await stories();
  const clear = { $unset: { claimedBy: "", leaseUntil: "" } };
  const revisions = await col.updateMany({ ...written, status: "claimed", leaseUntil: { $lt: now } }, { $set: { status: "review", updatedAt: now }, ...clear });
  const open = { ...unwritten, status: { $in: ["queued", "claimed"] as StoryDoc["status"][] } };
  const stale = await col.updateMany(
    { ...open, createdAt: { $lt: new Date(now.getTime() - STALE_H * 3_600_000) } },
    { $set: { status: "rejected", reason: `stale: not written within ${STALE_H} hours`, updatedAt: now }, ...clear },
  );
  const lapsed = { ...unwritten, status: "claimed" as const, leaseUntil: { $lt: now } };
  const abandoned = await col.updateMany(
    { ...lapsed, lapses: { $gte: MAX_LAPSES - 1 } },
    { $set: { status: "rejected", reason: `abandoned: the lease lapsed ${MAX_LAPSES} times`, updatedAt: now }, $inc: { lapses: 1 }, ...clear },
  );
  const requeued = await col.updateMany({ ...lapsed }, { $set: { status: "queued", updatedAt: now }, $inc: { lapses: 1 }, ...clear });
  return { stale: stale.modifiedCount, abandoned: abandoned.modifiedCount, requeued: requeued.modifiedCount, revisions: revisions.modifiedCount };
}

/* ------------------------------------------------------------- claiming */

/** Gives the worker the best waiting job — or the one named, if it is
    waiting — for LEASE_MIN minutes. A job whose lease ran out is waiting
    again. Named, it can also be a story already written and not yet
    published: claimed again, it is revised by submitting it again, and
    goes back to review if the worker lets it go. Never handed out unnamed. */
export async function claim(worker: string, id?: string, now = new Date()): Promise<StoryDoc | null> {
  if (id !== undefined && !ObjectId.isValid(id)) return null;
  // Waiting: queued, or claimed with a lease that ran out — unless that
  // was its last lapse, which the sweep rejects. Never a stale job.
  const lapsed = { status: "claimed" as const, leaseUntil: { $lt: now } };
  const waiting = {
    ...unwritten,
    $or: [{ status: "queued" as const }, { ...lapsed, lapses: { $not: { $gte: MAX_LAPSES - 1 } } }],
    createdAt: { $gte: new Date(now.getTime() - STALE_H * 3_600_000) },
  };
  const revisable = { ...written, $or: [{ status: "review" as const }, lapsed] };
  return (await stories()).findOneAndUpdate(
    id ? { _id: new ObjectId(id), $or: [waiting, revisable] } : waiting,
    // Taking over a lapsed claim counts the lapse, so the count is right
    // whether the sweep or another worker finds it first.
    [
      {
        $set: {
          lapses: { $cond: [{ $eq: ["$status", "claimed"] }, { $add: [{ $ifNull: ["$lapses", 0] }, 1] }, { $ifNull: ["$lapses", 0] }] },
          status: "claimed",
          claimedBy: worker,
          leaseUntil: new Date(now.getTime() + LEASE_MIN * 60_000),
          updatedAt: now,
        },
      },
    ],
    { sort: { score: -1, createdAt: 1 }, returnDocument: "after" },
  );
}

/** A job becomes a story when it is first submitted; one claimed again
    after that is a revision, and ends in review, never in the queue. */
const unwritten = { submittedAt: { $exists: false } };
const written = { submittedAt: { $exists: true } };

const held = (worker: string, now: Date) => ({ status: "claimed" as const, claimedBy: worker, leaseUntil: { $gte: now } });

/** Hands a job back: waiting again — a revision back in review — or
    rejected with the reason. */
export async function release(id: string, worker: string, opts: { reject?: boolean; reason?: string } = {}, now = new Date()): Promise<StoryDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const reason = (opts.reason ?? "").trim().slice(0, 300);
  return (await stories()).findOneAndUpdate(
    { _id: new ObjectId(id), ...held(worker, now) },
    opts.reject
      ? { $set: { status: "rejected", reason: reason || "rejected by the worker", updatedAt: now }, $unset: { claimedBy: "", leaseUntil: "" } }
      : [{ $set: { status: { $cond: [{ $ifNull: ["$submittedAt", false] }, "review", "queued"] }, updatedAt: now } }, { $unset: ["claimedBy", "leaseUntil"] }],
    { returnDocument: "after" },
  );
}

/* ------------------------------------------------------------- checking */

export interface Submission {
  headline: string;
  dek: string;
  sections: StorySection[];
  keyPoints: string[];
  cited: string[];
}

const wordsOf = (s: string) => key(s).split(/\s+/).filter(Boolean);

/** Text in double quotation marks: a title or a quote, which may repeat a
    source word for word. Single quotes are not read as quotation marks:
    their closing one is the apostrophe in "It’s". */
const QUOTED = /[“"]([^”"]{1,300})[”"]/g;
const QUOTE_MAX = 12;
const QUOTES_MAX = 60;

/** Runs of COPY_RUN consecutive words, normalised. With `outsideQuotes`,
    runs never cross or include quoted text. */
function runs(text: string, outsideQuotes = false): Set<string> {
  const out = new Set<string>();
  for (const part of outsideQuotes ? text.split(QUOTED).filter((_, i) => i % 2 === 0) : [text]) {
    const w = wordsOf(part);
    for (let i = 0; i + COPY_RUN <= w.length; i++) out.add(w.slice(i, i + COPY_RUN).join(" "));
  }
  return out;
}

const str = (v: unknown, min: number, max: number) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;

/** Everything the server can check about a story before a person reads it.
    Returns the story, cleaned, or the list of what to fix. */
export function check(job: Pick<StoryDoc, "sources">, input: unknown): { ok: true; story: Submission & { words: number } } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const s = (input ?? {}) as Record<string, unknown>;
  if (!str(s.headline, 20, 120)) problems.push("headline: 20 to 120 characters.");
  if (!str(s.dek, 60, 320)) problems.push("dek: 60 to 320 characters.");
  const sections = Array.isArray(s.sections) ? (s.sections as Record<string, unknown>[]) : [];
  if (sections.length < 3 || sections.length > 6) problems.push("sections: three to six.");
  for (const [i, sec] of sections.entries()) {
    if (!str(sec?.heading, 3, 80)) problems.push(`sections[${i}].heading: 3 to 80 characters.`);
    const paras = Array.isArray(sec?.paragraphs) ? sec.paragraphs : [];
    if (!paras.length || paras.length > 6 || !paras.every((p) => str(p, 40, 1_500))) problems.push(`sections[${i}].paragraphs: one to six, each 40 to 1,500 characters.`);
  }
  const keyPoints = Array.isArray(s.keyPoints) ? s.keyPoints : [];
  if (keyPoints.length < 3 || keyPoints.length > 5 || !keyPoints.every((k) => str(k, 20, 240))) problems.push("keyPoints: three to five, each 20 to 240 characters.");
  const cited = Array.isArray(s.cited) ? [...new Set(s.cited.filter((u): u is string => typeof u === "string"))] : [];
  const byUrl = new Map(job.sources.map((src) => [src.url, src]));
  const unknown = cited.filter((u) => !byUrl.has(u));
  if (unknown.length) problems.push(`cited: not sources of this job: ${unknown.slice(0, 3).join(", ")}.`);
  if (new Set(cited.filter((u) => byUrl.has(u)).map((u) => byUrl.get(u)!.host)).size < 2) problems.push("cited: at least two sources from different sites.");
  if (problems.length) return { ok: false, problems };

  const story: Submission = {
    headline: (s.headline as string).trim(),
    dek: (s.dek as string).trim(),
    sections: sections.map((sec) => ({ heading: String(sec.heading).trim(), paragraphs: (sec.paragraphs as string[]).map((p) => p.trim()) })),
    keyPoints: (keyPoints as string[]).map((k) => k.trim()),
    cited,
  };
  const text = [story.headline, story.dek, ...story.sections.flatMap((x) => [x.heading, ...x.paragraphs]), ...story.keyPoints].join("\n");
  if (/<\/?[a-z][^>]*>|https?:\/\/|\]\(|\*\*|^#{1,6}\s/im.test(text)) problems.push("Plain text only: no HTML, Markdown or links in the text.");
  const words = wordsOf([story.dek, ...story.sections.flatMap((x) => x.paragraphs), ...story.keyPoints].join(" ")).length;
  if (words < WORDS.min || words > WORDS.max) problems.push(`Length: ${words} words; ${WORDS.min} to ${WORDS.max}.`);
  const body = story.sections.flatMap((x) => x.paragraphs).concat(story.dek, story.keyPoints);
  const quotes = body.flatMap((t) => [...t.matchAll(QUOTED)].map((m) => wordsOf(m[1]).length));
  if (quotes.some((n) => n >= QUOTE_MAX)) problems.push(`Quotes: each quotation under ${QUOTE_MAX} words.`);
  if (quotes.reduce((a, n) => a + n, 0) > QUOTES_MAX) problems.push(`Quotes: ${QUOTES_MAX} quoted words at most in all.`);
  const theirs = new Set(job.sources.flatMap((src) => [...runs(`${src.title}\n${src.excerpt}`)]));
  const copied = body.flatMap((t) => [...runs(t, true)]).filter((r) => theirs.has(r));
  if (copied.length) problems.push(`Copied wording: ${copied.length} run(s) of ${COPY_RUN} words match a source, e.g. "${copied[0]}".`);
  return problems.length ? { ok: false, problems } : { ok: true, story: { ...story, words } };
}

/* ----------------------------------------------------------- submitting */

/** A headline as an address. slugify() reads what follows a colon or a
    dash as a feed's tagline and drops it; in a headline it is the news —
    "Spider-Man: Brand New Day is headed back…" is not a story about
    Spider-Man in general — so the separators become spaces first. */
export const storySlug = (headline: string) => slugify(headline.replace(/\s*[:|·–—]\s*/g, " "), "story");

/** Files a story written for a job the worker holds. The address is the
    day it was filed and its headline. */
export async function submit(id: string, worker: { prefix: string; name: string }, input: unknown, now = new Date()) {
  if (!ObjectId.isValid(id)) return { status: 404 as const };
  const col = await stories();
  const job = await col.findOne({ _id: new ObjectId(id), ...held(worker.prefix, now) });
  if (!job) return { status: 409 as const };
  const result = check(job, input);
  if (!result.ok) return { status: 422 as const, problems: result.problems };
  // A revision keeps the day it was first filed, so its address only
  // changes with its headline.
  const day = job.day ?? now.toISOString().slice(0, 10);
  const base = storySlug(result.story.headline);
  let slug = base;
  for (let n = 2; await col.findOne({ day, slug, _id: { $ne: job._id } }, { projection: { _id: 1 } }); n++) slug = `${base}-${n}`;
  const doc = await col.findOneAndUpdate(
    { _id: job._id, ...held(worker.prefix, now) },
    {
      $set: { ...result.story, status: "review", writtenBy: worker.name, day, slug, submittedAt: now, updatedAt: now },
      $unset: { claimedBy: "", leaseUntil: "" },
    },
    { returnDocument: "after" },
  );
  return doc ? { status: 200 as const, story: doc } : { status: 409 as const };
}

/* ------------------------------------------------------------ publishing */

/** An admin's decision on a written story. */
export async function decide(id: string, status: "published" | "review" | "rejected", now = new Date()): Promise<StoryDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  return (await stories()).findOneAndUpdate(
    { _id: new ObjectId(id), status: { $in: ["review", "published", "rejected"] }, slug: { $type: "string" } },
    { $set: { status, updatedAt: now, ...(status === "published" && { publishedAt: now }) } },
    { returnDocument: "after" },
  );
}

/** Published stories, newest first. */
export async function publishedStories(limit = 30, before?: Date): Promise<StoryDoc[]> {
  return (await stories())
    .find({ status: "published", ...(before && { publishedAt: { $lt: before } }) })
    .sort({ publishedAt: -1 })
    .limit(limit)
    .toArray();
}

/** A published story as the API gives it: the whole text, and the
    sources it cites. */
export const storyJson = (s: StoryDoc) => ({
  id: String(s._id),
  url: `${SITE}${storyPath(s)}`,
  headline: s.headline,
  dek: s.dek,
  sections: s.sections,
  keyPoints: s.keyPoints,
  words: s.words,
  sources: s.sources.filter((x) => s.cited?.includes(x.url)).map((x) => ({ url: x.url, title: x.title, site: x.host })),
  publishedAt: s.publishedAt,
  updatedAt: s.updatedAt,
});

/** A story at its address, if it is written. */
export async function storyAt(day: string, slug: string): Promise<StoryDoc | null> {
  return (await stories()).findOne({ day, slug, status: { $in: ["review", "published"] } });
}

export const storyPath = (s: Pick<StoryDoc, "day" | "slug">) => `/news/${s.day}/${s.slug}/`;

/** A job as a worker sees it. */
export const jobJson = (j: StoryDoc, origin: string) => ({
  id: String(j._id),
  status: j.status,
  score: j.score,
  sites: j.hosts,
  leaseUntil: j.leaseUntil ?? null,
  sources: j.sources.map((s) => ({ url: s.url, title: s.title, site: s.host, publishedAt: s.publishedAt, excerpt: s.excerpt })),
  brief: BRIEF,
  submit: `${origin}/api/v1/stories/jobs/${j._id}`,
});
