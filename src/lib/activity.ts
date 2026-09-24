// How alive a feed is, and the rank the topic lists sort by.
//
// A directory's list of feeds is only worth reading if the ones at the top
// deserve it. We have three honest signals: how many people follow a feed
// in their readers (the counts Feedly, Inoreader and the rest report when
// they fetch our copy), how often it posts, and how recently. Each poll
// recomputes all three, so a feed that goes quiet sinks on its own.
import type { ObjectId } from "mongodb";
import { feeds, items } from "./db.ts";
import { subscriberTotal } from "./followers.ts";
import type { FeedDoc } from "./types.ts";

const DAY = 86_400_000;
/** Pace is measured over the last four weeks. */
const WINDOW = 28 * DAY;
/** A pace is never measured over less than a week: one post an hour after
    a blog opens is one post a week, not seven. */
const MIN_SPAN = 7 * DAY;
/** Past a couple of posts a day, more is not better for a reader. */
const PACE_CAP = 14;

export interface Seen {
  /** The oldest post we know of. */
  first: Date;
  /** The newest. */
  last: Date;
  /** How many fall in the last four weeks. */
  recent: number;
}

/** Posts a week over the last four weeks — or since the oldest post we
    know of, when that is later: a feed that carries two days of posts
    shows two days' pace, not a month's diluted. One decimal. */
export function perWeek(seen: Seen | undefined, now = Date.now()): number {
  if (!seen?.recent) return 0;
  const span = Math.max(MIN_SPAN, now - Math.max(now - WINDOW, new Date(seen.first).getTime()));
  return Math.round(((seen.recent * 7 * DAY) / span) * 10) / 10;
}

/** The score a topic list sorts by: followers and pace on a log scale, so
    neither a firehose nor one big audience runs away with it, less a point
    for every month without a post after the first two weeks. */
export function rankOf(a: { followers: number; perWeek: number; lastPostAt?: Date }, now = Date.now()): number {
  const quiet = a.lastPostAt ? Math.max(0, (now - new Date(a.lastPostAt).getTime()) / DAY - 14) / 30 : 12;
  const score = Math.log2(1 + a.followers) + Math.log2(1 + Math.min(a.perWeek, PACE_CAP)) - quiet;
  return Math.round(score * 100) / 100;
}

/** What we have seen a feed publish. A feed that dates nothing had its
    first posts stamped with the moment we first read it — years of
    backlog, all "now" — so those are left out: they say nothing of pace. */
export async function seenPosts(feedId: ObjectId, feedCreatedAt: Date, now = new Date()): Promise<Seen | undefined> {
  const backlogEnd = new Date(new Date(feedCreatedAt).getTime() + 10 * 60_000);
  const since = new Date(now.getTime() - WINDOW);
  const [row] = await (await items())
    .aggregate<Seen>([
      { $match: { feedId, publishedAt: { $lte: now } } },
      { $match: { $expr: { $not: [{ $and: [{ $eq: ["$publishedAt", "$createdAt"] }, { $lte: ["$createdAt", backlogEnd] }] }] } } },
      {
        $group: {
          _id: null,
          first: { $min: "$publishedAt" },
          last: { $max: "$publishedAt" },
          recent: { $sum: { $cond: [{ $gte: ["$publishedAt", since] }, 1, 0] } },
        },
      },
      { $project: { _id: 0 } },
    ])
    .toArray();
  return row;
}

/** Recomputes a feed's pace, last post and rank; run after every poll. */
export async function noteActivity(feed: Pick<FeedDoc, "_id" | "createdAt" | "subscribers">, now = new Date()): Promise<void> {
  const seen = await seenPosts(feed._id, feed.createdAt, now);
  const pace = perWeek(seen, now.getTime());
  const lastPostAt = seen?.last;
  const rank = rankOf({ followers: subscriberTotal(feed.subscribers, now.getTime()), perWeek: pace, lastPostAt }, now.getTime());
  await (await feeds()).updateOne(
    { _id: feed._id },
    { $set: { postsPerWeek: pace, rank, ...(lastPostAt ? { lastPostAt } : {}) } },
  );
}
