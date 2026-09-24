// Followers a feed has in other readers, as those readers report them when
// they fetch our copy (copy.ts records the reports). Kept apart from
// copy.ts so the pages that show the number do not load an HTML cleaner.
import type { FeedDoc } from "./types.ts";

/** How long a reader's reported count stands without being reported again. */
const FRESH = 7 * 24 * 3600_000;

/** Followers across readers that reported within the last week. */
export function subscriberTotal(map: FeedDoc["subscribers"], now = Date.now()): number {
  return Object.values(map ?? {}).reduce((sum, r) => (now - new Date(r.at).getTime() < FRESH ? sum + r.n : sum), 0);
}
