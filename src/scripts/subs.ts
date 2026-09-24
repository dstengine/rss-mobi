// The reader's subscriptions: kept in this browser's localStorage and
// nowhere else. There are no accounts, so there is nothing to sync — an
// OPML export is how a list moves to another device or another reader.
import { track } from "./track.ts";

export interface Sub {
  slug: string;
  title: string;
  host: string;
  /** The feed's own address, for OPML export. */
  url: string;
}

const SUBS = "rssmobi:subs";
const SEEN = "rssmobi:seen";
export const MAX_SUBS = 200;

function read<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    // Private windows and full or blocked storage: the page still works,
    // it just forgets on reload.
    return false;
  }
}

const valid = (s: any): s is Sub => s && typeof s.slug === "string" && typeof s.title === "string" && typeof s.url === "string";

export const subs = (): Sub[] => read<unknown[]>(SUBS, []).filter(valid);
export const following = (slug: string) => subs().some((s) => s.slug === slug);

function save(list: Sub[]) {
  write(SUBS, list);
  window.dispatchEvent(new CustomEvent("rssmobi:subs"));
}

/** Adds feeds not already followed; returns how many were new. */
export function follow(...feeds: Sub[]): number {
  const list = subs();
  const have = new Set(list.map((s) => s.slug));
  const fresh = feeds.filter((f) => valid(f) && !have.has(f.slug) && (have.add(f.slug), true));
  if (!fresh.length) return 0;
  save([...list, ...fresh.map(({ slug, title, host, url }) => ({ slug, title, host, url }))].slice(0, MAX_SUBS));
  return fresh.length;
}

export function unfollow(slug: string) {
  save(subs().filter((s) => s.slug !== slug));
}

/** When the reader last showed the newest post, so newer ones can be
    marked. One timestamp for the whole list; per-post read state would
    need an account's worth of storage. */
export const lastSeen = (): number => Number(read<number>(SEEN, 0)) || 0;
export const markSeen = (at: number) => write(SEEN, at);

/** Every [data-follow] button on the page: toggles and keeps its label in
    step with the list, including changes made in another tab. */
export function wireFollowButtons(root: ParentNode = document) {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("button[data-follow]")];
  const paint = () => {
    for (const b of buttons) {
      const on = following(b.dataset.follow!);
      b.setAttribute("aria-pressed", String(on));
      (b.querySelector(".label") ?? b).textContent = on ? "Following" : "Follow";
      b.title = on ? "In your reader on this device. Tap to stop following." : "Add to your reader on this device. No account needed.";
    }
  };
  for (const b of buttons) {
    b.hidden = false;
    b.addEventListener("click", () => {
      const d = b.dataset;
      if (following(d.follow!)) {
        unfollow(d.follow!);
        track("unfollow");
      } else {
        follow({ slug: d.follow!, title: d.title ?? d.follow!, host: d.host ?? "", url: d.url ?? "" });
        track("follow");
      }
      paint();
    });
  }
  window.addEventListener("rssmobi:subs", paint);
  window.addEventListener("storage", (e) => e.key === SUBS && paint());
  paint();
}
