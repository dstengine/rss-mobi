// Hard daily ceilings on paid APIs.
//
// Modelled on tools/fal-budget.mjs in https://github.com/dstengine/dst:
// reserve *before* the call, because a limit checked after the request has
// been paid for is not a limit; and the ceilings are constants, because one
// that can be raised by setting a variable is a suggestion — changing it is
// a commit.
//
// The ledger differs: fal-budget keeps a JSON file, and a serverless
// function has no disk that outlives it. Here each day is one document and
// the reservation is a single conditional $inc, so two functions reserving
// at the same moment cannot both squeeze under the ceiling.
import type { Collection } from "mongodb";

/** Dollars per UTC day. */
export const LIMITS = {
  /** DataForSEO index checks, v1.0. A check is a `site:` query, which
      DataForSEO bills at five times a plain one: $0.003, so $0.12 is 40
      checks a day. Temporary, from 24 Sep 2026, while the account runs on
      its trial credit; $1 (about 330 checks) once it is topped up. */
  serp: 0.12,
  /** Claude rewrites, v1.1. */
  llm: 5,
} as const;

export type BudgetName = keyof typeof LIMITS;

export class BudgetExceeded extends Error {}

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

export type Ledger = Pick<Collection<{ _id: string; usd: number; updatedAt: Date }>, "updateOne" | "findOneAndUpdate" | "findOne">;

/** Reserves `usd` against today's `name` budget, or throws BudgetExceeded. */
export async function reserve(ledger: Ledger, name: BudgetName, usd: number, what = "", day = utcDay()): Promise<number> {
  const limit = LIMITS[name];
  const _id = `${name}:${day}`;
  const amount = Math.round(usd * 1e6) / 1e6;
  await ledger.updateOne({ _id }, { $setOnInsert: { usd: 0, updatedAt: new Date() } }, { upsert: true });
  const after = await ledger.findOneAndUpdate(
    { _id, usd: { $lte: limit - amount } },
    { $inc: { usd: amount }, $set: { updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!after) {
    const spent = (await ledger.findOne({ _id }))?.usd ?? 0;
    throw new BudgetExceeded(`${name} budget: $${spent.toFixed(4)} of $${limit} spent today; ${what} needs $${amount}`);
  }
  return after.usd;
}

/** Corrects today's ledger by `delta` dollars once a call's real cost is
    known — negative when it cost less than was reserved, or was refused
    before anything was charged. Unconditional: the money is already spent,
    so a day can end a few cents past its limit, and the next reservation
    then fails. */
export async function settle(ledger: Ledger, name: BudgetName, delta: number, day = utcDay()): Promise<void> {
  const amount = Math.round(delta * 1e6) / 1e6;
  if (!amount) return;
  await ledger.updateOne({ _id: `${name}:${day}` }, { $inc: { usd: amount }, $set: { updatedAt: new Date() } });
}

/** Dollars left today; never negative. */
export async function headroom(ledger: Ledger, name: BudgetName, day = utcDay()): Promise<number> {
  const spent = (await ledger.findOne({ _id: `${name}:${day}` }))?.usd ?? 0;
  return Math.max(0, LIMITS[name] - spent);
}
