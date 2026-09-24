import type { ObjectId } from "mongodb";

export type Robots = "index,follow" | "noindex,follow";
/** How a link to an original is rendered. `direct` is a plain followed
    link; `ugc` and `nofollow` add rel values; `hop` goes through /go/;
    `none` prints the address as text. */
export type LinkMode = "direct" | "ugc" | "nofollow" | "hop" | "none";

export type FeedStatus = "active" | "hidden" | "disabled";

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
  submittedIpHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Where an item stands in the index-check queue. `queued` waits for its
    first check; `pending` has that check in flight; the two verdicts are
    what the policy reads. A recheck keeps the last verdict until the new
    one arrives, so a page does not blink out of the index while it runs. */
export type IndexStatus = "queued" | "pending" | "indexed" | "not_indexed" | "error";

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
  linkMode: LinkMode | null;
  /** Set when the page's robots changed and IndexNow has not yet accepted
      the news; cleared only after a 200 or 202, so a failed ping is tried
      again on the next run. */
  announce?: true;
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
