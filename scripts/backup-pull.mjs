#!/usr/bin/env node
// Copies the newest backup from R2 into iCloud Drive and applies the same
// rule there: 30 days, and the newest always stays. Run daily by the
// LaunchAgent in scripts/mobi.rss.backup-pull.plist; launchd runs a missed
// day when the Mac wakes.
//
// Archives stay encrypted with age; the key is ~/.config/rss-mobi/age.key.
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { r2FromEnv } from "./lib/r2.mjs";
import { toPrune, dateOf } from "./lib/prune.mjs";

const root = new URL("..", import.meta.url).pathname;
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const DIR = join(homedir(), "Library/Mobile Documents/com~apple~CloudDocs/Backups/rss.mobi");
mkdirSync(DIR, { recursive: true });

const remote = await r2FromEnv().list("rssmobi-");
const newest = remote.reduce((a, b) => ((dateOf(b.key) ?? b.date) > (dateOf(a.key) ?? a.date) ? b : a), remote[0]);
if (!newest) {
  console.log("no backups in R2 yet");
} else if (existsSync(join(DIR, newest.key)) && statSync(join(DIR, newest.key)).size === newest.size) {
  console.log(`already have ${newest.key}`);
} else {
  const bytes = await r2FromEnv().get(newest.key);
  // Written under a temporary name and renamed once complete, so iCloud
  // never syncs half a file under the final name.
  writeFileSync(join(DIR, `${newest.key}.part`), bytes);
  renameSync(join(DIR, `${newest.key}.part`), join(DIR, newest.key));
  console.log(`pulled ${newest.key} (${(bytes.length / 1e6).toFixed(2)} MB)`);
}

const local = readdirSync(DIR)
  .filter((n) => n.startsWith("rssmobi-") && !n.endsWith(".part"))
  .map((key) => ({ key, date: dateOf(key) ?? statSync(join(DIR, key)).mtime }));
for (const key of toPrune(local)) {
  unlinkSync(join(DIR, key));
  console.log(`deleted ${key}`);
}
