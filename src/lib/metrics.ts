// Events rolled up by day, for the weekly retro and for experiment
// readouts: one row per day, metric and variant in `metrics_daily`, so
// neither has to read raw events, which expire after 180 days anyway.
//
// A metric is an event name (`follow`), a view by page type
// (`view:feed`), or an event by its label where the label is a small
// fixed set (`subscribe_copy:topic`). The variant is "all" for everyone,
// or `<experiment>=<variant>` for the events that carried one — a z-test
// compares two of those rows over the experiment's days.
//
// A day is a UTC day. Rolling one up again replaces its rows with what
// the events say now, so a rerun changes nothing and a missed run is
// caught up by the next.
import { events, metricsDaily } from "./db.ts";
import { zTest } from "./experiments.ts";

const DAY = 86_400_000;

/** Events whose label is worth a metric of its own, and the labels the
    site's own code sends for them. Any other label — a host, a count, or
    whatever a stranger posts — counts toward the event alone, so nobody
    can make a row per value. */
const LABELS: Record<string, RegExp> = {
  subscribe_copy: /^(topic|collection|builder)$/,
  subscribe_open: /^(Feedly|Inoreader|NetNewsWire|rss\.mobi)$/,
  submit_error: /^\d{3}$/,
  collection_add_url: /^(new|existing)$/,
};
const LABELLED = Object.keys(LABELS);

const PAGE_TYPES: Record<string, string> = {
  "": "home",
  feed: "feed",
  item: "item",
  tag: "tag",
  tags: "tags",
  reader: "reader",
  c: "collection",
  search: "search",
  submit: "submit",
  rss: "rss",
  f: "edit",
  about: "about",
  terms: "terms",
};

/** The kind of page a path is, from its first segment. */
export const pageType = (path: string | null | undefined) => (typeof path === "string" && path.startsWith("/") ? (PAGE_TYPES[path.split("/")[1]] ?? "other") : "other");

/** The metrics one event counts toward. */
export function metricsOf(e: { name: string; path?: string | null; label?: string | null }): string[] {
  const out = [e.name];
  if (e.name === "view") out.push(`view:${pageType(e.path)}`);
  else if (e.label && LABELS[e.name]?.test(e.label)) out.push(`${e.name}:${e.label}`);
  return out;
}

export interface MetricRow {
  day: string;
  metric: string;
  variant: string;
  n: number;
}

export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** The rows for one day, counted from its events. */
export async function countDay(day: string): Promise<MetricRow[]> {
  const from = new Date(`${day}T00:00:00Z`);
  const groups = await (await events())
    .aggregate<{ _id: { name: string; seg: string | null; label: string | null; exp: Record<string, string> | null }; n: number }>([
      { $match: { at: { $gte: from, $lt: new Date(from.getTime() + DAY) } } },
      {
        $group: {
          _id: {
            name: "$name",
            // Only the first path segment matters, and only for views.
            seg: { $cond: [{ $eq: ["$name", "view"] }, { $arrayElemAt: [{ $split: [{ $ifNull: ["$path", ""] }, "/"] }, 1] }, null] },
            label: { $cond: [{ $in: ["$name", LABELLED] }, "$label", null] },
            exp: { $ifNull: ["$exp", null] },
          },
          n: { $sum: 1 },
        },
      },
    ])
    .toArray();
  const counts = new Map<string, MetricRow>();
  const add = (metric: string, variant: string, n: number) => {
    const k = `${metric}\u0000${variant}`;
    const row = counts.get(k) ?? { day, metric, variant, n: 0 };
    row.n += n;
    counts.set(k, row);
  };
  for (const { _id: g, n } of groups) {
    const path = g.seg === null ? null : `/${g.seg ?? ""}`;
    const variants = ["all", ...Object.entries(g.exp ?? {}).map(([id, v]) => `${id}=${v}`)];
    for (const metric of metricsOf({ name: g.name, path, label: g.label })) for (const v of variants) add(metric, v, n);
  }
  return [...counts.values()].sort((a, b) => a.metric.localeCompare(b.metric) || a.variant.localeCompare(b.variant));
}

/** Replaces a day's rows with a fresh count. Idempotent. */
export async function rollUp(day: string): Promise<number> {
  if (!/^\d{4}-\d\d-\d\d$/.test(day)) throw new Error(`not a day: ${day}`);
  const rows = await countDay(day);
  const col = await metricsDaily();
  const at = new Date();
  if (rows.length) {
    await col.bulkWrite(
      rows.map((r) => ({ updateOne: { filter: { day, metric: r.metric, variant: r.variant }, update: { $set: { n: r.n, updatedAt: at } }, upsert: true } })),
      { ordered: false },
    );
  }
  // What this count did not produce, an earlier one did and is now wrong.
  await col.deleteMany({ day, updatedAt: { $lt: at } });
  return rows.length;
}

/** The last `n` whole days before `now`, oldest first. */
export const lastDays = (n: number, now = new Date()) => Array.from({ length: n }, (_, i) => dayOf(new Date(now.getTime() - (n - i) * DAY)));

/** Totals of each metric over [from, to], for one variant ("all" unless
    asked). */
export async function totals(from: string, to: string, variant = "all"): Promise<Record<string, number>> {
  const rows = await (await metricsDaily())
    .aggregate<{ _id: string; n: number }>([{ $match: { day: { $gte: from, $lte: to }, variant } }, { $group: { _id: "$metric", n: { $sum: "$n" } } }, { $sort: { _id: 1 } }])
    .toArray();
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}

/** An experiment's readout from the rolled-up days: for each variant, how
    many `exposure` events and `conversion` events it had, and the z-test
    of each variant against the first (the control). */
export async function readout(exp: { id: string; variants: { id: string }[] }, conversion: string, exposure: string, from: string, to: string) {
  const rows = await (await metricsDaily())
    .find({ day: { $gte: from, $lte: to }, metric: { $in: [conversion, exposure] }, variant: { $in: exp.variants.map((v) => `${exp.id}=${v.id}`) } })
    .toArray();
  const sum = (metric: string, v: string) => rows.filter((r) => r.metric === metric && r.variant === `${exp.id}=${v}`).reduce((s, r) => s + (r.n as number), 0);
  const arms = exp.variants.map((v) => ({ variant: v.id, exposures: sum(exposure, v.id), conversions: sum(conversion, v.id) }));
  const [control, ...rest] = arms;
  return {
    arms: arms.map((a) => ({ ...a, rate: a.exposures ? a.conversions / a.exposures : 0 })),
    tests: rest.map((a) => ({ variant: a.variant, ...zTest(control.conversions, control.exposures, a.conversions, a.exposures) })),
  };
}
