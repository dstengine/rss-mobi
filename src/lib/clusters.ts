// Stories several sites are covering at once, found in the last two days
// of posts: the raw material for a written story (stories.ts).
//
// Posts are compared by their rarer words — a word in two to forty posts
// says what a post is about; "Trump" or "AI" in hundreds says little. A post
// joins a cluster only when it matches one of the cluster's first posts
// (its anchors), never merely some later member: comparing with any member
// chains one story into the next through a shared name, and an SNL sketch
// about a chief executive ends up in one cluster with his dinner at the
// White House.
import { key } from "./feeds/url.ts";

export interface Post {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  host: string;
  feedSlug: string;
  publishedAt: Date;
}

export interface Cluster {
  posts: Post[];
  hosts: number;
  newest: Date;
  score: number;
}

/** Hours after which a cluster's freshness counts half. */
export const HALF_LIFE_H = 12;
const ANCHORS = 3;

const STOP = new Set(
  "a an the and or but of to in on for with at by from as is are was were be been it its this that these those after before over into about than new says say said will would could can how why what who when where which your you our we they he she his her their them not no more most up out just also has have had do does did via amid here there now get gets got first last next one two three all any some".split(
    " ",
  ),
);

/** The words of a text that could say what it is about. */
export function words(s: string): Set<string> {
  return new Set(
    key(s)
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)),
  );
}

/** Stories on at least `minHosts` sites, best first: the number of sites
    covering it, halved every HALF_LIFE_H hours since its newest post. */
export function cluster(posts: Post[], opts: { now?: number; minHosts?: number } = {}): Cluster[] {
  const now = opts.now ?? Date.now();
  const minHosts = opts.minHosts ?? 2;
  const docs = [...posts]
    .sort((a, b) => +a.publishedAt - +b.publishedAt)
    .map((p) => ({ p, title: words(p.title), all: words(`${p.title} ${p.excerpt.slice(0, 400)}`) }));

  const df = new Map<string, number>();
  for (const d of docs) for (const w of d.all) df.set(w, (df.get(w) ?? 0) + 1);
  const maxDf = Math.max(40, Math.round(docs.length * 0.01));
  const rare = (w: string) => {
    const n = df.get(w) ?? 0;
    return n >= 2 && n <= maxDf;
  };

  type Group = { anchors: typeof docs; members: typeof docs };
  const groups: Group[] = [];
  const byWord = new Map<string, Set<number>>();

  for (const d of docs) {
    // Candidates: clusters whose anchors share a rare title word.
    const candidates = new Set<number>();
    for (const w of d.title) if (rare(w)) for (const g of byWord.get(w) ?? []) candidates.add(g);
    let best = -1;
    let bestScore = 0;
    for (const g of candidates) {
      for (const a of groups[g].anchors) {
        if (a.p.host === d.p.host) continue;
        const sharedAll = [...d.all].filter((w) => rare(w) && a.all.has(w)).length;
        const sharedTitle = [...d.title].filter((w) => rare(w) && a.title.has(w)).length;
        const jaccard = sharedTitle / (d.title.size + a.title.size - sharedTitle || 1);
        const s = sharedAll + sharedTitle;
        // Two title words in common are often just a name — the same
        // person in two different stories — so two count only when they
        // are much of both titles.
        const alike = sharedTitle >= 3 ? jaccard >= 0.2 : sharedTitle === 2 && jaccard >= 0.3;
        if (sharedAll >= 3 && alike && s > bestScore) {
          best = g;
          bestScore = s;
        }
      }
    }
    if (best >= 0) {
      const g = groups[best];
      g.members.push(d);
      if (g.anchors.length < ANCHORS && !g.anchors.some((a) => a.p.host === d.p.host)) {
        g.anchors.push(d);
        for (const w of d.title) if (rare(w)) (byWord.get(w) ?? byWord.set(w, new Set()).get(w)!).add(best);
      }
    } else {
      groups.push({ anchors: [d], members: [d] });
      for (const w of d.title) if (rare(w)) (byWord.get(w) ?? byWord.set(w, new Set()).get(w)!).add(groups.length - 1);
    }
  }

  // One story can still start as two clusters, when its first posts
  // described it differently ("lifts off" before "reaches orbit"). A
  // cluster whose signature — the rare words most of its titles share —
  // matches a bigger one's is folded into it.
  const sized = groups.map((g) => g.members).sort((a, b) => b.length - a.length);
  const kept: { members: typeof docs; sig: Set<string> }[] = [];
  const bySig = new Map<string, number[]>();
  for (const members of sized) {
    const sig = signature(members.map((d) => d.title), rare);
    let into = -1;
    if (sig.size >= 3) {
      const shared = new Map<number, number>();
      for (const w of sig) for (const k of bySig.get(w) ?? []) shared.set(k, (shared.get(k) ?? 0) + 1);
      for (const [k, n] of shared) if (n >= 3 && (into < 0 || k < into)) into = k;
    }
    if (into >= 0) kept[into].members.push(...members);
    else {
      kept.push({ members, sig });
      for (const w of sig) (bySig.get(w) ?? bySig.set(w, []).get(w)!).push(kept.length - 1);
    }
  }

  return kept
    .map(({ members: ds }) => {
      const members = ds.map((d) => d.p);
      const hosts = new Set(members.map((p) => p.host)).size;
      const newest = new Date(Math.max(...members.map((p) => +p.publishedAt)));
      return { posts: members, hosts, newest, score: hosts * Math.pow(0.5, (now - +newest) / (HALF_LIFE_H * 3_600_000)) };
    })
    .filter((c) => c.hosts >= minHosts)
    .sort((a, b) => b.score - a.score);
}

/** The rare words in at least half of a cluster's titles (two at least),
    or, for a single post, its own rare title words. */
function signature(titles: Set<string>[], rare: (w: string) => boolean): Set<string> {
  const count = new Map<string, number>();
  for (const t of titles) for (const w of t) if (rare(w)) count.set(w, (count.get(w) ?? 0) + 1);
  const need = titles.length === 1 ? 1 : Math.max(2, Math.ceil(titles.length / 2));
  return new Set([...count].filter(([, n]) => n >= need).map(([w]) => w));
}

/** Stories rss.mobi does not rewrite: harm to people who did not choose
    to be in the news, cases still before a court, and advice. A default,
    matched on the posts' titles; the list is kept short and plain so a
    miss is visible rather than clever. */
const SENSITIVE =
  /\b(murder\w*|kill(ed|ing|s)?|shoot(ing|ings)?|shot dead|stabb\w*|rape\w*|sexual(ly)? (assault\w*|abuse\w*)|abuse\w*|suicide\w*|overdose\w*|trial|convict\w*|charged|arrest\w*|indict\w*|lawsuit\w*|sued|bomb plot|terror\w*|dies|died|dead|death\w*|obituar\w*|diagnos\w*|symptom\w*|invest(ing|ment advice)|stock tips?)\b/i;

export const sensitive = (c: Pick<Cluster, "posts">) => c.posts.some((p) => SENSITIVE.test(p.title));
