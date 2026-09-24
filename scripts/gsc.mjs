#!/usr/bin/env node
// rss.mobi's own Search Console from the command line, through the
// rss-mobi-workers service account (src/lib/gsc.ts).
//
//   node scripts/gsc.mjs set-key ~/Downloads/rss-mobi-509607-….json
//   node scripts/gsc.mjs sites          # what the account can see
//   node scripts/gsc.mjs summary [days] # clicks, impressions, CTR, position
//   node scripts/gsc.mjs sitemaps
//   node scripts/gsc.mjs inspect <url>  # one of our pages; 2,000 a day
//
// set-key stores the key in .env as base64 and moves the file to
// ~/.config/rss-mobi/, so the only copy is not left in Downloads.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const envFile = join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const gsc = await import("../src/lib/gsc.ts");
const [cmd, arg] = process.argv.slice(2);
const day = (d) => d.toISOString().slice(0, 10);
const print = (v) => console.log(JSON.stringify(v, null, 2));

if (cmd === "set-key") {
  if (!arg || !existsSync(arg)) throw new Error("usage: node scripts/gsc.mjs set-key <key.json>");
  const json = readFileSync(arg, "utf8");
  const sa = gsc.serviceAccount(json.trim());
  const lines = readFileSync(envFile, "utf8").split("\n");
  const line = `GSC_SERVICE_ACCOUNT=${Buffer.from(json.trim()).toString("base64")}`;
  const at = lines.findIndex((l) => l.startsWith("GSC_SERVICE_ACCOUNT="));
  if (at >= 0) lines[at] = line;
  else lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, line);
  writeFileSync(envFile, lines.join("\n"));
  const dir = join(homedir(), ".config/rss-mobi");
  mkdirSync(dir, { recursive: true });
  const kept = join(dir, "gsc-service-account.json");
  renameSync(arg, kept);
  chmodSync(kept, 0o600);
  console.log(`✓ key for ${sa.client_email} saved to .env; the file moved to ${kept}`);
} else if (cmd === "sites") {
  print(await gsc.sites());
} else if (cmd === "summary") {
  const days = Number(arg ?? 28);
  // Search Console runs two to three days behind: end three days ago.
  const end = new Date(Date.now() - 3 * 86_400_000);
  const range = { startDate: day(new Date(end - (days - 1) * 86_400_000)), endDate: day(end) };
  const [total] = await gsc.searchAnalytics(range);
  const pages = await gsc.searchAnalytics({ ...range, dimensions: ["page"], rowLimit: 10 });
  const queries = await gsc.searchAnalytics({ ...range, dimensions: ["query"], rowLimit: 10 });
  print({ property: gsc.PROPERTY, ...range, total: total ?? { clicks: 0, impressions: 0 }, pages, queries });
} else if (cmd === "sitemaps") {
  print(await gsc.sitemaps());
} else if (cmd === "inspect") {
  if (!arg) throw new Error("usage: node scripts/gsc.mjs inspect <url on rss.mobi>");
  print(await gsc.inspect(arg));
} else {
  console.error("usage: node scripts/gsc.mjs set-key <key.json> | sites | summary [days] | sitemaps | inspect <url>");
  process.exit(2);
}
