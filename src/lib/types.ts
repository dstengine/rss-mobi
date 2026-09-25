import type { ObjectId } from "mongodb";

export type Robots = "index,follow" | "noindex,follow";
/** How a link to an original is rendered. `direct` is a plain followed
    link; `ugc` and `nofollow` add rel values; `hop` goes through /go/;
    `none` prints the address as text. */
export type LinkMode = "direct" | "ugc" | "nofollow" | "hop" | "none";

export type FeedStatus = "active" | "hidden" | "disabled";

export type Copy = "full" | "excerpt";

export interface FeedDoc {
  _id: ObjectId;
  slug: string;
  url: string;
  canonicalUrl: string;
  siteUrl: string;
  host: string;
  title: string;
  description: string;
  lang: string;
  tags: string[];
  image?: string;
  format: string;
  status: FeedStatus;
  editHash: string;
  etag?: string;
  lastModified?: string;
  nextFetchAt: Date;
  /** When a reader would find the feed behind: the last poll plus its own
      pace. Later than that, reading it polls it (catalog.ts schedule). */
  freshBy?: Date;
  /** When a page, our copy or the reader last showed it; hourly at most. */
  readAt?: Date;
  /** The last body read, hashed: a site that answers every request in
      full is not parsed again for the same bytes. */
  bodyHash?: string;
  lastFetchAt?: Date;
  lastError?: string;
  failCount: number;
  okCount: number;
  itemCount: number;
  /** Manual overrides; null means "decide by the rules". */
  robots: Robots | null;
  linkMode: LinkMode | null;
  /** When IndexNow was first told this feed's page is indexable. */
  announcedAt?: Date;
  /** What our copy of the feed carries: the whole post, as the original
      does (the default), or only an excerpt — the owner's choice. */
  copy?: Copy;
  /** Readers that fetch our copy and say how many follow it, by reader:
      forwarded in our own user agent to the original, so a publisher's
      count of followers does not drop when they read through us. */
  subscribers?: Record<string, { n: number; at: Date }>;
  /** Posts a week lately, the newest post's date, and the score topic
      lists sort by — recomputed after every poll (activity.ts). */
  postsPerWeek?: number;
  lastPostAt?: Date;
  rank?: number;
  /** The site's icon, as found at `iconAt`; null when it has none we can
      use (icon.ts). */
  icon?: string | null;
  iconAt?: Date;
  /** False for a big publisher we seeded (scripts/seed.mts): Google has
      its posts within minutes, so they skip the index-check queue and
      their pages stay noindex, instead of spending the day's checks while
      the webmasters' posts the queue exists for wait behind them. */
  checkIndex?: boolean;
  submittedIpHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Where an item stands in the index-check queue. `queued` waits for its
    first check; `pending` has that check in flight; the two verdicts are
    what the policy reads. A recheck keeps the last verdict until the new
    one arrives, so a page does not blink out of the index while it runs.
    `skipped` is never checked: its feed does not take part (FeedDoc.checkIndex). */
export type IndexStatus = "queued" | "pending" | "indexed" | "not_indexed" | "error" | "skipped";

export interface ItemDoc {
  _id: ObjectId;
  feedId: ObjectId;
  feedSlug: string;
  guid: string;
  url: string;
  canonicalUrl: string;
  host: string;
  title: string;
  excerpt: string;
  image?: string;
  /** The picture lists and the post's page show, served resized from
      /item/<id>/image/ (pictures.ts): where it is and its size. Null when
      we looked and found none; absent until we look, at `pictureAt`. */
  picture?: { url: string; w: number; h: number } | null;
  pictureAt?: Date;
  author?: string;
  tags: string[];
  lang: string;
  publishedAt: Date;
  /** False when the feed is hidden or its host blocked; filters read this
      instead of joining back to feeds on every request. */
  visible: boolean;
  indexStatus: IndexStatus;
  indexNextCheckAt: Date | null;
  indexCheckedAt?: Date;
  indexChecks: number;
  /** The DataForSEO task in flight, when it was filed and what it cost. */
  serpTaskId?: string;
  serpPostedAt?: Date;
  serpCost?: number;
  robots: Robots | null;
  /** The feed owner's link choice, copied from the feed on insert and on
      every edit, so a link is marked right wherever the post is listed. */
  linkMode: LinkMode | null;
  /** Set when the page's robots changed and IndexNow has not yet accepted
      the news; cleared only after a 200 or 202, so a failed ping is tried
      again on the next run. */
  announce?: true;
  /** What Search Console's URL Inspection last said about our page for
      this post (src/lib/pagecheck.ts): PASS means Google has it. */
  pageVerdict?: string;
  pageCoverage?: string;
  pageCheckedAt?: Date;
  /** TTL: the item disappears after this date unless a story needs it. */
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The filters a collection keeps. Feeds are stored beside them, and a
    date or a page size means nothing for a list that is read for years. */
export type SavedFilters = Pick<import("./filters.ts").Filters, "tags" | "lang" | "hosts" | "q" | "exclude">;

export interface CollectionDoc {
  _id: ObjectId;
  /** Public, short, unguessable: the collection's URL is /c/<id>/. */
  id: string;
  editHash: string;
  title: string;
  /** Feed slugs, in the order the owner put them. */
  feeds: string[];
  filters: SavedFilters;
  createdIpHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyDoc {
  _id: ObjectId;
  name: string;
  hash: string;
  prefix: string;
  scopes: string[];
  /** Requests per minute. */
  rate: number;
  createdAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
}
