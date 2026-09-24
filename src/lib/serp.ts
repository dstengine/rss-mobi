// DataForSEO's Google SERP API: is another site's page in Google's index?
//
// One check is one `site:` query in the standard queue: a POST files up to
// 100 tasks, and a later run collects each result by its id. The standard
// queue answers within minutes, and cron runs every fifteen, so posting
// and collecting are two halves of every run rather than one call that
// waits. Collecting is free; posting is billed per task.
//
// A `site:` query costs five times a plain one ($0.003 against $0.0006),
// and it is the one that answers the question: a plain search for a URL
// finds an indexed page most of the time, and "most of the time" is not
// good enough for the verdict that opens our page to search.
import { env } from "./env.ts";
import { canonical } from "./feeds/url.ts";

const API = "https://api.dataforseo.com/v3";
/** Dollars per check: $0.0006 a SERP in the standard queue, times five
    for the `site:` operator. The real cost comes back with each POST and
    is settled against the reservation. */
export const CHECK_USD = 0.003;
/** The API's own limit on tasks in one POST. */
export const MAX_TASKS = 100;
const KEYWORD_MAX = 700;
/** Google in English, from the United States. Whether a page is indexed
    does not depend much on where the question is asked from. */
const WHERE = { location_code: 2840, language_code: "en", device: "desktop", depth: 10 } as const;

/** An account-level refusal: bad credentials, no money, a rate limit, a
    paused account. Retrying into it spends nothing and fixes nothing, so
    the job stops for the rest of the day and says so once. */
export class SerpStop extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

/** HTTP 401/402/429 and DataForSEO's 401xx and 402xx codes. */
export const isStop = (code: number) => code === 401 || code === 402 || code === 429 || (code >= 40100 && code < 40300);

/** The query that lists a page if Google has it: `site:host/path`. Null
    when the URL cannot be put into one. */
export function keywordFor(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const kw = `site:${u.host.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  return kw.length <= KEYWORD_MAX ? kw : null;
}

/** Whether any result is the original, compared by `canonical()` so that
    www, a trailing slash or a tracking parameter is not a different page. */
export function listed(urls: string[], canonicalUrl: string): boolean {
  return urls.some((u) => canonical(u) === canonicalUrl);
}

export interface Posted {
  /** Dollars DataForSEO charged for the whole POST. */
  cost: number;
  tasks: { tag: string; id?: string; code: number; message: string; cost: number }[];
}

export type Collected =
  | { state: "ready"; urls: string[]; total: number }
  | { state: "waiting" }
  | { state: "gone"; code: number }
  | { state: "error"; code: number; message: string };

export interface SerpApi {
  post(tasks: { keyword: string; tag: string }[]): Promise<Posted>;
  collect(id: string): Promise<Collected>;
  /** Dollars left on the account. */
  balance(): Promise<number>;
}

interface Envelope {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: {
    id?: string;
    status_code: number;
    status_message: string;
    cost?: number;
    data?: { tag?: string };
    result?: { se_results_count?: number; items?: { type?: string; url?: string }[] | null; money?: { balance?: number } }[] | null;
  }[];
}

/** The client, or null when the credentials are not configured. */
export function dataForSeo(fetchImpl: typeof fetch = fetch): SerpApi | null {
  const login = env("DATAFORSEO_LOGIN");
  const password = env("DATAFORSEO_PASSWORD");
  if (!login || !password) return null;
  const auth = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;

  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<Envelope> {
    const res = await fetchImpl(API + path, {
      method,
      headers: { Authorization: auth, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    // Codes and messages only: a body can echo the account's login.
    if (isStop(res.status)) throw new SerpStop(`DataForSEO refused: HTTP ${res.status}`, res.status);
    if (!res.ok) throw new Error(`DataForSEO: ${method} ${path.split("/").slice(0, 5).join("/")} failed, HTTP ${res.status}`);
    const reply = (await res.json()) as Envelope;
    const code = reply.status_code ?? 0;
    if (isStop(code)) throw new SerpStop(`DataForSEO refused: ${code} ${reply.status_message ?? ""}`.trim(), code);
    if (code !== 20000) throw new Error(`DataForSEO: ${code} ${reply.status_message ?? ""}`.trim());
    return reply;
  }

  return {
    async post(tasks) {
      const reply = await call("POST", "/serp/google/organic/task_post", tasks.map((t) => ({ ...WHERE, keyword: t.keyword, tag: t.tag })));
      return {
        cost: reply.cost ?? 0,
        tasks: (reply.tasks ?? []).map((t) => ({ tag: t.data?.tag ?? "", id: t.status_code === 20100 ? t.id : undefined, code: t.status_code, message: t.status_message, cost: t.cost ?? 0 })),
      };
    },

    async collect(id) {
      const t = (await call("GET", `/serp/google/organic/task_get/regular/${encodeURIComponent(id)}`)).tasks?.[0];
      if (!t) return { state: "error", code: 0, message: "no task in the response" };
      if (t.status_code === 40601 || t.status_code === 40602) return { state: "waiting" };
      if (t.status_code === 40401 || t.status_code === 40403) return { state: "gone", code: t.status_code };
      if (isStop(t.status_code)) throw new SerpStop(`DataForSEO refused: ${t.status_code} ${t.status_message}`, t.status_code);
      if (t.status_code !== 20000) return { state: "error", code: t.status_code, message: t.status_message };
      const r = t.result?.[0];
      const urls = (r?.items ?? []).filter((i) => i.type === "organic" && i.url).map((i) => i.url!);
      return { state: "ready", urls, total: r?.se_results_count ?? 0 };
    },

    async balance() {
      return (await call("GET", "/appendix/user_data")).tasks?.[0]?.result?.[0]?.money?.balance ?? 0;
    },
  };
}
