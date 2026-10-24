// Paid API keys, sold through Polar (ADR 0010). A buyer gets a licence key
// from Polar at checkout — `RSSMOBI-…` — and sends it the way a `rmk_` key
// is sent, `Authorization: Bearer`. Nothing about a sale reaches rss.mobi:
// when the key is used it is checked against Polar's public validation
// endpoint, which needs no secret of ours, and the verdict is cached ten
// minutes under the key's hash. A valid key reads like a hand-made key
// with read:full at the default rate; a refunded or expired one is a 404
// at Polar and a 401 here, within ten minutes.
import { cached } from "./cache.ts";
import { env } from "./env.ts";
import { sha256 } from "./tokens.ts";
import { RATE_DEFAULT, type Caller } from "./keys.ts";

/** The prefix the Polar benefit puts on every key it grants. */
export const polarPrefix = () => env("POLAR_KEY_PREFIX") ?? "RSSMOBI";

export const polarApi = () => (env("POLAR_ENV") === "sandbox" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh");

/** Whether a presented token has the shape of a key Polar granted for us:
    our prefix, a separator, then the key body Polar generated. */
export function isPolarKey(token: string): boolean {
  const p = polarPrefix();
  return token.startsWith(p) && /^[A-Z0-9]{2,16}[-_][0-9A-Za-z-]{16,80}$/.test(token);
}

/** What Polar said about a key; JSON-safe, so it can be cached. */
interface Verdict {
  ok: boolean;
  expiresAt?: string | null;
  customer?: string;
  benefit?: string;
}

/** One question to Polar. 404 is Polar's answer for a key it does not
    know, has revoked or that has expired; 400/422 for one it cannot read.
    Anything else is Polar's trouble, thrown so that it is not cached. */
async function ask(token: string, organization: string): Promise<Verdict> {
  const res = await fetch(`${polarApi()}/v1/customer-portal/license-keys/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ key: token, organization_id: organization }),
    signal: AbortSignal.timeout(5_000),
  });
  if (res.status === 404 || res.status === 400 || res.status === 422) return { ok: false };
  if (!res.ok) throw new Error(`polar: validate answered ${res.status}`);
  const k = (await res.json()) as { status?: string; expires_at?: string | null; benefit_id?: string; customer?: { id?: string } };
  if (k.status !== "granted") return { ok: false };
  if (k.expires_at && new Date(k.expires_at).getTime() <= Date.now()) return { ok: false };
  return { ok: true, expiresAt: k.expires_at ?? null, customer: k.customer?.id, benefit: k.benefit_id };
}

/** The caller a Polar key stands for; "invalid" for one Polar does not
    honour, or when no keys are sold here; "unavailable" when Polar could
    not be asked and nothing is cached — the caller hears that rather than
    being read as anonymous. */
export async function polarLookup(token: string): Promise<Caller | "invalid" | "unavailable"> {
  const organization = env("POLAR_ORGANIZATION_ID");
  if (!organization) return "invalid";
  const hash = sha256(token);
  let v: Verdict;
  try {
    v = await cached<Verdict>(`polar:${hash}`, 600, () => ask(token, organization));
  } catch (e) {
    console.error("polar: key check failed", e instanceof Error ? e.message : e);
    return "unavailable";
  }
  if (!v.ok) return "invalid";
  return {
    name: `polar:${v.customer ?? "customer"}`,
    hash,
    prefix: `pl_${hash.slice(0, 8)}`,
    scopes: ["read:full"],
    rate: RATE_DEFAULT,
    createdAt: new Date(0),
    via: "polar",
    expiresAt: v.expiresAt ? new Date(v.expiresAt) : undefined,
  };
}
