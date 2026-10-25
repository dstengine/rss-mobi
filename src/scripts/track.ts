// Client-side analytics and experiment assignment.
//
// Events carry what happened, where, and which variant was showing — no
// visitor id, no IP, nothing that identifies a person. The anonymous id in
// localStorage never leaves the browser: it only decides which variant of
// a visitor experiment this browser sees, the same one every visit.
import { variantFor, EXPERIMENTS } from "../lib/experiments.ts";
import { sourceOf } from "../lib/visits.ts";

const ID_KEY = "rssmobi:vid";
const VISIT_KEY = "rssmobi:visit";

export function visitorId(): string {
  try {
    let v = localStorage.getItem(ID_KEY);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(ID_KEY, v);
    }
    return v;
  } catch {
    // Private windows and blocked storage get the control, every time.
    return "anonymous";
  }
}

/** The variant this browser sees in a visitor experiment. */
export function variant(id: keyof typeof EXPERIMENTS): string {
  return variantFor(id, visitorId());
}

export function track(name: string, data: { label?: string; exp?: Record<string, string> } = {}): void {
  const body = JSON.stringify({ name, path: location.pathname, ...data });
  try {
    if (navigator.sendBeacon?.("/api/v1/events", new Blob([body], { type: "application/json" }))) return;
  } catch {
    // fall through to fetch
  }
  fetch("/api/v1/events", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
}

/** Counts a visit: the first page a tab opens on the site, by where the
    reader came from. A flag in sessionStorage keeps a reload and the pages
    after it from counting again; like the events, it carries no id, and
    the tab forgets it when it closes. */
export function trackVisit(): void {
  const source = sourceOf(document.referrer, location.hostname);
  if (!source) return;
  try {
    if (sessionStorage.getItem(VISIT_KEY)) return;
    sessionStorage.setItem(VISIT_KEY, "1");
  } catch {
    // Blocked storage: the referrer alone tells a new visit from the next
    // page of one, though a reload counts again.
  }
  track("visit", { label: source });
}
