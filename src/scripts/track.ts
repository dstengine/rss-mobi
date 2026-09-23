// Client-side analytics and experiment assignment.
//
// Events carry what happened, where, and which variant was showing — no
// visitor id, no IP, nothing that identifies a person. The anonymous id in
// localStorage never leaves the browser: it only decides which variant of
// a visitor experiment this browser sees, the same one every visit.
import { variantFor, EXPERIMENTS } from "../lib/experiments.ts";

const ID_KEY = "rssmobi:vid";

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
