// One MongoDB client per function instance.
//
// A serverless function that opens a client per request runs the cluster out
// of connections within minutes of real traffic. The client lives on
// globalThis so it also survives Vite's module reloads in development.
import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import { env, need } from "./env.ts";
import type { ApiKeyDoc, CollectionDoc, FeedDoc, ItemDoc } from "./types.ts";

const g = globalThis as unknown as { __rssMongo?: Promise<MongoClient> };

export function client(): Promise<MongoClient> {
  g.__rssMongo ??= new MongoClient(need("MONGODB_CONNECTION_STRING"), {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 8_000,
    appName: "rss.mobi",
  }).connect().catch((e) => {
    // A failed connect must not be cached, or every later request on this
    // instance fails without trying again.
    g.__rssMongo = undefined;
    throw e;
  });
  return g.__rssMongo;
}

export async function db(): Promise<Db> {
  return (await client()).db(env("MONGODB_DB") ?? "rssmobi");
}

const c = <T extends Document>(name: string) => async (): Promise<Collection<T>> => (await db()).collection<T>(name);

export const feeds = c<FeedDoc>("feeds");
export const items = c<ItemDoc>("items");
export const collections = c<CollectionDoc>("collections");
export const apiKeys = c<ApiKeyDoc>("api_keys");
export const indexChecks = c<Document>("index_checks");
export const spend = c<{ _id: string; usd: number; updatedAt: Date }>("spend");
export const blocklist = c<{ _id: string; reason: string; createdAt: Date }>("blocklist");
export const reports = c<Document>("reports");
export const events = c<Document>("events");
export const metricsDaily = c<Document>("metrics_daily");
export const experiments = c<Document>("experiments");
