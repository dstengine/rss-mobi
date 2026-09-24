// Work a request starts but does not wait for.
//
// On Vercel a function may be frozen the moment its response is sent, and
// a promise still running then is simply lost. waitUntil asks the platform
// to keep the function alive until the promise settles; anywhere else it
// does nothing and the promise runs on as usual. The visitor's response is
// never held up either way.
import { waitUntil } from "@vercel/functions";

export function after(label: string, work: () => Promise<unknown>): void {
  const done = work().catch((e) => console.error(`after ${label}: ${(e as Error).message}`));
  try {
    waitUntil(done);
  } catch {}
}

/** After answering, polls the named feeds that are due. The poller and
    its XML parser load only then, not on the page's way out. */
export const freshen = (slugs: string[]) =>
  after("poll", async () => (slugs.length ? (await import("./catalog.ts")).pollIfDue(slugs) : undefined));
