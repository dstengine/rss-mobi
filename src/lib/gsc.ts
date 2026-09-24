// rss.mobi's own Search Console, for our scheduled jobs and the weekly
// retro. The service account rss-mobi-workers@rss-mobi-509607 is a Full
// user of the https://rss.mobi/ property; its key is GSC_SERVICE_ACCOUNT.
//
// Only our own property. Publishers do not connect theirs (ADR 0006):
// whether someone else's post is in Google is a question for DataForSEO,
// under the `serp` budget.
//
// Signed with node:crypto rather than the googleapis package: one JWT, one
// token exchange and four JSON endpoints do not need 100 MB of client.
import { createSign } from "node:crypto";
import { env, SITE } from "./env.ts";
import { count } from "./cache.ts";
import { utcDay } from "./budget.ts";

/** The property, as Search Console names it. */
export const PROPERTY = `${SITE}/`;
const SCOPE = "https://www.googleapis.com/auth/webmasters";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://searchconsole.googleapis.com";
/** URL Inspection allows 2,000 calls a day per property. */
export const INSPECT_PER_DAY = 2000;

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/** The key Google hands out as a JSON file, stored as is or as base64. */
export function serviceAccount(value = env("GSC_SERVICE_ACCOUNT")): ServiceAccount | null {
  if (!value) return null;
  const json = value.startsWith("{") ? value : Buffer.from(value, "base64").toString("utf8");
  const key = JSON.parse(json) as Partial<ServiceAccount>;
  if (!key.client_email?.endsWith(".iam.gserviceaccount.com") || !key.private_key) {
    throw new Error("GSC_SERVICE_ACCOUNT is not a service account key");
  }
  return { client_email: key.client_email, private_key: key.private_key };
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** The signed request Google trades for an access token (RFC 7523). */
export function assertion(sa: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(sa.private_key);
  return `${head}.${claims}.${b64url(signature)}`;
}

let token: { value: string; until: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertion(sa) }),
    signal: AbortSignal.timeout(10_000),
  });
  // Google's error code ("invalid_grant") and nothing else: logs are public.
  if (!res.ok) throw new Error(`gsc: token exchange failed, HTTP ${res.status} ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? ""}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, until: Date.now() + body.expires_in * 1000 };
  return token.value;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const sa = serviceAccount();
  if (!sa) throw new Error("GSC_SERVICE_ACCOUNT is not set");
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    // URL Inspection takes about five seconds a page; a call still going
    // after twelve is not worth the function's time limit.
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`gsc: ${method} ${path.split("?")[0]} failed, HTTP ${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const property = encodeURIComponent(PROPERTY);

/** Properties the service account can see, with its permission on each. */
export async function sites(): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  return (await call<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>("GET", "/webmasters/v3/sites")).siteEntry ?? [];
}

export interface SearchRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Clicks, impressions, CTR and position between two dates (inclusive,
    YYYY-MM-DD). Search Console runs two to three days behind. */
export async function searchAnalytics(q: { startDate: string; endDate: string; dimensions?: ("query" | "page" | "date" | "country" | "device")[]; rowLimit?: number }): Promise<SearchRow[]> {
  return (await call<{ rows?: SearchRow[] }>("POST", `/webmasters/v3/sites/${property}/searchAnalytics/query`, q)).rows ?? [];
}

export interface SitemapStatus {
  path: string;
  lastSubmitted?: string;
  lastDownloaded?: string;
  isPending?: boolean;
  errors?: string;
  warnings?: string;
  contents?: { type: string; submitted: string; indexed?: string }[];
}

export async function sitemaps(): Promise<SitemapStatus[]> {
  return (await call<{ sitemap?: SitemapStatus[] }>("GET", `/webmasters/v3/sites/${property}/sitemaps`)).sitemap ?? [];
}

export async function submitSitemap(url: string): Promise<void> {
  if (!url.startsWith(PROPERTY)) throw new Error(`gsc: ${url} is not on ${PROPERTY}`);
  await call("PUT", `/webmasters/v3/sites/${property}/sitemaps/${encodeURIComponent(url)}`);
}

export class QuotaExceeded extends Error {}

export interface Inspection {
  verdict?: string;
  coverageState?: string;
  indexingState?: string;
  robotsTxtState?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  lastCrawlTime?: string;
}

/** How Google sees one of our pages. Counted against the daily quota before
    the call, the way budgets are reserved: a quota checked afterwards has
    already been spent. */
export async function inspect(url: string): Promise<Inspection> {
  if (!url.startsWith(PROPERTY)) throw new Error(`gsc: only pages on ${PROPERTY} can be inspected`);
  const used = await count(`gsc:inspect:${utcDay()}`);
  if (used > INSPECT_PER_DAY) throw new QuotaExceeded(`gsc: ${INSPECT_PER_DAY} inspections already used today`);
  const r = await call<{ inspectionResult?: { indexStatusResult?: Inspection } }>("POST", "/v1/urlInspection/index:inspect", {
    inspectionUrl: url,
    siteUrl: PROPERTY,
  });
  const s = r.inspectionResult?.indexStatusResult ?? {};
  return {
    verdict: s.verdict,
    coverageState: s.coverageState,
    indexingState: s.indexingState,
    robotsTxtState: s.robotsTxtState,
    pageFetchState: s.pageFetchState,
    googleCanonical: s.googleCanonical,
    lastCrawlTime: s.lastCrawlTime,
  };
}
