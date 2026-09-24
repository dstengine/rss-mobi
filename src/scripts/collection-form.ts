// The collection form: picked feeds, a search that adds more, and the
// filters. Pages call `mountForm` with what to start from and what to do
// on submit; everything remote is written with textContent.
import { subs } from "./subs.ts";
import { track } from "./track.ts";

export interface PickedFeed {
  slug: string;
  title: string;
  host: string;
}

export interface CollectionValue {
  title: string;
  feeds: string[];
  filters: { tags: string[]; hosts: string[]; q?: string; exclude: string[]; lang?: string };
}

export interface Initial {
  title?: string;
  feeds?: PickedFeed[];
  filters?: Partial<CollectionValue["filters"]>;
}

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const split = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

// What typed into the search box is an address rather than words:
// "example.com", "www.example.com/blog", "https://example.com/feed.xml".
const URLISH = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(:\d+)?([/?#]\S*)?$/i;
const asUrl = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);

async function post(path: string, payload: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : { error: "No connection. Try again." };
  return { ok: Boolean(res?.ok), status: res?.status ?? 0, data };
}

export function mountForm(initial: Initial, onSubmit: (v: CollectionValue) => Promise<string | null>) {
  const form = $<HTMLFormElement>("#collection");
  const picked = new Map<string, PickedFeed>();
  const list = $("#c-feeds");
  const results = $("#c-results");
  const error = $("#c-error");

  function paint() {
    list.replaceChildren(
      ...[...picked.values()].map((f) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = f.title;
        const host = document.createElement("span");
        host.className = "meta";
        host.textContent = f.host;
        const x = document.createElement("button");
        x.type = "button";
        x.className = "remove";
        x.textContent = "Remove";
        x.title = `Remove ${f.title} from this collection`;
        x.addEventListener("click", () => {
          picked.delete(f.slug);
          paint();
        });
        li.append(name, host, x);
        return li;
      }),
    );
    $("#c-none").hidden = picked.size > 0;
    const mine = subs().filter((s) => !picked.has(s.slug));
    const button = $<HTMLButtonElement>("#c-mine");
    button.hidden = mine.length === 0;
    button.textContent = `Add the feeds I follow (${mine.length})`;
  }

  function add(...feeds: PickedFeed[]) {
    for (const f of feeds) picked.set(f.slug, { slug: f.slug, title: f.title, host: f.host });
    paint();
  }

  $("#c-mine").addEventListener("click", () => add(...subs()));

  const search = $<HTMLInputElement>("#c-search");
  const status = $("#c-status");
  const say = (text: string, bad = false) => {
    status.textContent = text;
    status.classList.toggle("bad", bad);
    status.hidden = !text;
  };

  // A pasted address adds its feed: the directory's own if it has one, and
  // otherwise the feed is found, submitted and added in one go, so a
  // collection is never limited to what the directory already knows. The
  // box clears as soon as an address is taken, so the next one can be pasted
  // while the first is still being looked up; they are worked through in
  // order, and one that fails comes back into the box to be corrected and
  // stays named in the status until the batch is through.
  let queue = Promise.resolve();
  let waiting = 0;
  let failed: string[] = [];
  const missed = () => (failed.length ? ` Nothing found at ${failed.join(", ")}.` : "");
  function addByUrl(raw: string) {
    results.replaceChildren();
    search.value = "";
    if (!waiting) failed = [];
    waiting++;
    queue = queue
      .then(() => addOne(raw))
      .catch(() => say(`${raw}: that did not work. Try again.`, true))
      .finally(() => waiting--);
  }
  async function addOne(raw: string) {
    const url = asUrl(raw);
    const more = waiting > 1 ? ` (${waiting - 1} more waiting)` : "";
    say(`Looking for a feed at ${raw}…${more}`);
    let feed: PickedFeed | null = null;
    let fresh = false;
    let why = "";
    // Cheapest first. An exact feed address the directory has costs one
    // query; a site's address is read to find its feed, and only a feed the
    // directory lacks is submitted, since submissions are few an hour.
    const look = await post("/api/v1/lookup", { urls: [url] });
    feed = look.ok ? (look.data.found?.[0]?.feed ?? null) : null;
    if (!feed) {
      const d = await post("/api/v1/discover", { url });
      let slug: string | null = d.ok ? d.data.existing : null;
      if (d.ok && !slug) {
        const r = await post("/api/v1/feeds", { url: d.data.feedUrl });
        if (r.ok) {
          feed = r.data.feed;
          fresh = true;
        } else {
          slug = r.data.existing ?? null;
          why = r.status === 429 ? "the directory takes five new feeds an hour from one address. Try this one later." : r.data.error;
        }
      } else if (!d.ok) why = d.data.error;
      if (slug) {
        const g = await fetch(`/api/v1/feeds/${encodeURIComponent(slug)}`).catch(() => null);
        feed = g?.ok ? ((await g.json()).feed ?? null) : null;
      }
      if (!feed) {
        if (!search.value) search.value = raw;
        failed.push(raw);
        say(`${raw}: ${why || "no feed was found at that address."}`, true);
        return;
      }
    }
    add(feed);
    say(`Added ${feed.title}.${fresh ? " It is new to the directory, too." : ""}${missed()}`, failed.length > 0);
    track("collection_add_url", { label: fresh ? "new" : "existing" });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let asked = "";
  search.addEventListener("input", (e) => {
    const q = (e.target as HTMLInputElement).value.trim();
    clearTimeout(timer);
    if (!waiting) say("");
    if (URLISH.test(q)) {
      asked = q;
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "result";
      // The address without its scheme, free to wrap after a slash rather
      // than at any letter.
      const t = document.createElement("span");
      const parts = q.replace(/^https?:\/\//i, "").replace(/\/$/, "").split("/");
      t.append(...parts.flatMap((p, i) => (i < parts.length - 1 ? [`${p}/`, document.createElement("wbr")] : [p])));
      const h = document.createElement("span");
      h.className = "meta";
      h.textContent = "Add its feed to this collection";
      b.append(t, h);
      b.addEventListener("click", () => addByUrl(q));
      li.append(b);
      results.replaceChildren(li);
      return;
    }
    if (q.length < 2) {
      results.replaceChildren();
      return;
    }
    timer = setTimeout(async () => {
      asked = q;
      const res = await fetch(`/api/v1/feeds?${new URLSearchParams({ q, limit: "8" })}`).catch(() => null);
      const data = res?.ok ? await res.json() : { feeds: [] };
      if (asked !== q) return;
      results.replaceChildren(
        ...data.feeds.map((f: PickedFeed) => {
          const li = document.createElement("li");
          const b = document.createElement("button");
          b.type = "button";
          b.className = "result";
          const t = document.createElement("span");
          t.textContent = f.title;
          const h = document.createElement("span");
          h.className = "meta";
          h.textContent = picked.has(f.slug) ? `${f.host} · added` : f.host;
          b.append(t, h);
          b.addEventListener("click", () => {
            add(f);
            h.textContent = `${f.host} · added`;
          });
          li.append(b);
          return li;
        }),
      );
      if (!data.feeds.length) {
        const li = document.createElement("li");
        li.className = "muted small";
        li.textContent = "Nothing in the directory matches that.";
        results.append(li);
      }
    }, 250);
  });

  // Enter in the search box must not submit the form. On an address it
  // adds that feed; on words the results are already showing.
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = search.value.trim();
    if (URLISH.test(q)) addByUrl(q);
  });

  const f = initial.filters ?? {};
  $<HTMLInputElement>("#c-title").value = initial.title ?? "";
  $<HTMLInputElement>("#c-tags").value = (f.tags ?? []).join(", ");
  $<HTMLInputElement>("#c-hosts").value = (f.hosts ?? []).join(", ");
  $<HTMLInputElement>("#c-q").value = f.q ?? "";
  $<HTMLInputElement>("#c-exclude").value = (f.exclude ?? []).join(", ");
  $<HTMLInputElement>("#c-lang").value = f.lang ?? "";
  $<HTMLDetailsElement>("#c-filters").open = Boolean(f.tags?.length || f.hosts?.length || f.q || f.exclude?.length || f.lang);
  add(...(initial.feeds ?? []));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = $<HTMLButtonElement>("#c-submit");
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Saving…";
    error.hidden = true;
    const q = $<HTMLInputElement>("#c-q").value.trim();
    const lang = $<HTMLInputElement>("#c-lang").value.trim().toLowerCase();
    const problem = await onSubmit({
      title: $<HTMLInputElement>("#c-title").value.trim(),
      feeds: [...picked.keys()],
      filters: {
        tags: split($<HTMLInputElement>("#c-tags").value),
        hosts: split($<HTMLInputElement>("#c-hosts").value),
        exclude: split($<HTMLInputElement>("#c-exclude").value),
        ...(q ? { q } : {}),
        ...(lang ? { lang } : {}),
      },
    }).catch(() => "Something went wrong. Check your connection and try again.");
    button.disabled = false;
    button.textContent = label;
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
    }
  });

  form.hidden = false;
}
