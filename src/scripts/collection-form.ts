// The collection form: picked feeds, a search that adds more, and the
// filters. Pages call `mountForm` with what to start from and what to do
// on submit; everything remote is written with textContent.
import { subs } from "./subs.ts";

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

  let timer: ReturnType<typeof setTimeout> | undefined;
  let asked = "";
  $<HTMLInputElement>("#c-search").addEventListener("input", (e) => {
    const q = (e.target as HTMLInputElement).value.trim();
    clearTimeout(timer);
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

  // Enter in the search box searches; it must not submit the form.
  $<HTMLInputElement>("#c-search").addEventListener("keydown", (e) => e.key === "Enter" && e.preventDefault());

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
