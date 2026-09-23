// Secrets we hand out and only ever store as hashes: edit tokens for
// feeds and collections, API keys.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const newToken = (bytes = 24) => randomBytes(bytes).toString("base64url");

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Constant-time comparison of a presented token with a stored hash. */
export function matches(token: string | null | undefined, hash: string | undefined): boolean {
  if (!token || !hash) return false;
  const a = Buffer.from(sha256(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A short, unguessable public id for a collection. */
export const shortId = () => randomBytes(6).toString("base64url").replace(/[-_]/g, "x").toLowerCase();

/** IPs are never stored; a salted hash is enough to rate-limit and to
    notice one address submitting a hundred feeds. The salt rotates daily,
    so the hash cannot be followed across days. */
export function ipHash(ip: string, day = new Date().toISOString().slice(0, 10)): string {
  return sha256(`${day}:${process.env.CRON_SECRET ?? "dev"}:${ip}`).slice(0, 32);
}
