// A/B assignment: deterministic, weighted, and blind to who is asking.
//
// Two kinds of subject, never mixed:
//   - a visitor: the anonymous id a page keeps in localStorage. The variant
//     is applied in a client-side island, so the HTML the server renders —
//     and the CDN caches — is the same for everyone.
//   - a page: its URL. Groups of pages get a variant each, and one page
//     shows one variant to every visitor, crawlers included. This is how
//     SEO changes are tested without cloaking.

export interface Variant {
  id: string;
  weight: number;
}

export interface Experiment {
  id: string;
  kind: "visitor" | "page";
  variants: Variant[];
  /** Off means everyone gets the first variant (the control). */
  active: boolean;
}

/** FNV-1a, 32 bit: fast, dependency-free, and evenly spread for this. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // A final avalanche, so ids that differ only in the last character do not
  // land in neighbouring buckets.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** The variant `subject` gets in `exp`. The same pair always gets the same
    answer; the experiment id is part of the hash so two experiments do not
    split visitors the same way. */
export function assign(exp: Experiment, subject: string): string {
  const control = exp.variants[0]?.id ?? "control";
  if (!exp.active || exp.variants.length < 2) return control;
  const total = exp.variants.reduce((s, v) => s + Math.max(0, v.weight), 0);
  if (total <= 0) return control;
  let point = (hash32(`${exp.id}:${subject}`) / 2 ** 32) * total;
  for (const v of exp.variants) {
    point -= Math.max(0, v.weight);
    if (point < 0) return v.id;
  }
  return exp.variants.at(-1)!.id;
}

/** Experiments in force. Code, not database: an experiment changes what a
    template renders, so starting one is a deploy anyway, and a registry
    that can drift from the code that reads it is two sources of truth.
    Results and decisions live in docs/experiments/<id>.md. */
export const EXPERIMENTS: Record<string, Experiment> = {
  "feed-title-v1": {
    id: "feed-title-v1",
    kind: "page",
    variants: [
      { id: "control", weight: 1 },
      { id: "subscribe", weight: 1 },
    ],
    active: false,
  },
  "submit-steps-v1": {
    id: "submit-steps-v1",
    kind: "visitor",
    variants: [
      { id: "preview", weight: 1 },
      { id: "one-step", weight: 1 },
    ],
    active: false,
  },
};

export function variantFor(id: keyof typeof EXPERIMENTS, subject: string): string {
  const exp = EXPERIMENTS[id];
  return exp ? assign(exp, subject) : "control";
}

/** Two-proportion z-test: is variant B's conversion rate different from A's?
    Returns z and a two-sided p-value. The decision rule (a minimum sample
    before anyone looks, one primary metric) lives in AGENTS.md; this only
    does the arithmetic. */
export function zTest(convA: number, nA: number, convB: number, nB: number): { z: number; p: number } {
  if (!nA || !nB) return { z: 0, p: 1 };
  const pA = convA / nA;
  const pB = convB / nB;
  const pooled = (convA + convB) / (nA + nB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  if (!se) return { z: 0, p: 1 };
  const z = (pB - pA) / se;
  return { z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

function normalCdf(x: number): number {
  // Abramowitz–Stegun 7.1.26; accurate to ~1e-7, which is plenty here.
  const t = 1 / (1 + 0.3275911 * x / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + y);
}
