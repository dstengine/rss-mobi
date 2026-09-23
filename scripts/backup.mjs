#!/usr/bin/env node
// The R2 half of the nightly backup (.github/workflows/backup.yml):
//
//   node scripts/backup.mjs upload <file>   # after mongodump | age
//   node scripts/backup.mjs prune           # only after a successful upload
//   node scripts/backup.mjs list
//
// Prune deletes archives older than 30 days except the newest. It runs
// only after an upload succeeded, so a broken backup never deletes
// anything.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { r2FromEnv } from "./lib/r2.mjs";
import { toPrune, dateOf } from "./lib/prune.mjs";

const [cmd, file] = process.argv.slice(2);
const bucket = r2FromEnv();

if (cmd === "upload") {
  if (!file) throw new Error("upload needs a file");
  const bytes = readFileSync(file);
  if (bytes.length < 100) throw new Error(`${file} is ${bytes.length} bytes — refusing to upload an empty backup`);
  await bucket.put(basename(file), bytes);
  console.log(`uploaded ${basename(file)} (${(bytes.length / 1e6).toFixed(2)} MB)`);
} else if (cmd === "prune") {
  const objects = (await bucket.list("rssmobi-")).map((o) => ({ ...o, date: dateOf(o.key) ?? o.date }));
  const doomed = toPrune(objects);
  for (const key of doomed) await bucket.del(key);
  console.log(`kept ${objects.length - doomed.length}, deleted ${doomed.length}${doomed.length ? `: ${doomed.join(", ")}` : ""}`);
} else if (cmd === "list") {
  for (const o of await bucket.list("rssmobi-")) console.log(`${o.date.toISOString()}  ${(o.size / 1e6).toFixed(2)} MB  ${o.key}`);
} else {
  console.error("usage: backup.mjs upload <file> | prune | list");
  process.exit(2);
}
