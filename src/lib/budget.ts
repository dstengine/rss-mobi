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
  /** DataForSEO index checks, v1.0. At ~$0.0006 a check, about 1,600 a day. */
  serp: 1,
  /** Claude rewrites, v1.1. */
  llm: 5,
} as const;

export type BudgetName = keyof typeof LIMITS;

export class BudgetExceeded extends Error {}

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

type Ledger = Pick<Collection<{ _id: string; usd: number; updatedAt: Date }>, "updateOne" | "findOneAndUpdate" | "findOne">;

/** Reserves `usd` against today's `name` budget, or throws BudgetExceeded. */
export async function reserve(ledger: Ledger, name: BudgetName, usd: number, what = ""): Promise<number> {
  const limit = LIMITS[name];
  const _id = `${name}:${utcDay()}`;
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

/** Dollars left today; never negative. */
export async function headroom(ledger: Ledger, name: BudgetName): Promise<number> {
  const spent = (await ledger.findOne({ _id: `${name}:${utcDay()}` }))?.usd ?? 0;
  return Math.max(0, LIMITS[name] - spent);
}
