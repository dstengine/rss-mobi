// API keys: for the sites that read the directory — the DST network, and
// anyone else we give one to. A key buys its own allowance instead of the
// anonymous one, and scopes on top of reading:
//
//   read:full    every field, the index-check status of each post included
//   write:feeds  submitting at the key's own rate, many feeds in one call
//   admin        everything, and /api/v1/admin/…
//
// A key is shown once, when it is made (scripts/api-key.mjs); only its
// hash is stored. Its first eight characters after `rmk_` are its public
// name — in logs, in the rate limiter, and to revoke it by.
import { apiKeys } from "./db.ts";
import { newToken, sha256 } from "./tokens.ts";
import type { ApiKeyDoc } from "./types.ts";

export const SCOPES = ["read:full", "write:feeds", "admin"] as const;
export type Scope = (typeof SCOPES)[number];

/** Requests a minute a key gets unless it is made with another figure. The
    anonymous allowance is 120. */
export const RATE_DEFAULT = 600;

export const hasScope = (key: Pick<ApiKeyDoc, "scopes"> | null | undefined, scope: Scope) =>
  !!key && (key.scopes.includes(scope) || key.scopes.includes("admin"));

/** A new key, its public prefix and the hash that is all we keep. */
export function mint(): { token: string; prefix: string; hash: string } {
  const token = `rmk_${newToken(24)}`;
  return { token, prefix: token.slice(4, 12), hash: sha256(token) };
}

export async function createKey(name: string, scopes: string[], rate = RATE_DEFAULT): Promise<{ token: string; key: ApiKeyDoc }> {
  const bad = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
  if (bad.length) throw new Error(`unknown scope: ${bad.join(", ")} (known: ${SCOPES.join(", ")})`);
  if (!name.trim()) throw new Error("a key needs a name: the site it is for");
  if (!Number.isInteger(rate) || rate < 1 || rate > 10_000) throw new Error("rate is requests a minute, 1 to 10000");
  const { token, prefix, hash } = mint();
  const key = { name: name.trim(), hash, prefix, scopes: [...new Set(scopes)], rate, createdAt: new Date() } as Omit<ApiKeyDoc, "_id">;
  const { insertedId } = await (await apiKeys()).insertOne(key as ApiKeyDoc);
  return { token, key: { ...key, _id: insertedId } };
}

/** Revokes by prefix. A revoked key answers 401 from then on; the record
    stays, so its name and dates can still be looked up. */
export async function revokeKey(prefix: string): Promise<ApiKeyDoc | null> {
  return (await apiKeys()).findOneAndUpdate({ prefix, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } }, { returnDocument: "after" });
}

export async function listKeys(): Promise<Omit<ApiKeyDoc, "hash">[]> {
  return (await apiKeys()).find({}, { projection: { hash: 0 } }).sort({ createdAt: 1 }).toArray();
}

/** The key a presented token belongs to: the key, "invalid" for one that
    is unknown or revoked, or null when no token was presented. */
export async function lookup(token: string | null | undefined): Promise<ApiKeyDoc | "invalid" | null> {
  if (!token) return null;
  if (!/^rmk_[\w-]{20,64}$/.test(token)) return "invalid";
  const key = await (await apiKeys()).findOne({ hash: sha256(token) });
  return key && !key.revokedAt ? key : "invalid";
}
