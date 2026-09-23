// Which backups to delete: everything older than `days`, except the newest
// one, whatever its age. If backups stop for a month, the last good one is
// still there — an age-only rule (like an R2 lifecycle rule) would have
// deleted it.
const DAY = 86_400_000;

/** @param {{key: string, date: Date}[]} objects */
export function toPrune(objects, now = Date.now(), days = 30) {
  if (!objects.length) return [];
  const newest = objects.reduce((a, b) => (b.date > a.date ? b : a));
  return objects.filter((o) => o !== newest && now - o.date.getTime() > days * DAY).map((o) => o.key);
}

/** The date a backup was taken, read from its name
    (rssmobi-2026-09-23T02-00-05Z.archive.gz.age); null for other files. */
export function dateOf(name) {
  const m = name.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : null;
}
