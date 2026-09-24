#!/usr/bin/env node
// Moves the value on the clipboard into .env under NAME, so a secret never
// appears on screen, in shell history or in anybody's chat: copy it in the
// browser, then run
//
//   node ~/dst/rss.mobi/scripts/set-secret.mjs R2_ACCESS_KEY_ID
//
// The clipboard is cleared afterwards. Values for the names below are
// checked for shape first, so copying the wrong field fails here rather than
// as a 401 a day later. macOS only (pbpaste, pbcopy).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SHAPES = {
  R2_ACCOUNT_ID: [/^[0-9a-f]{32}$/, "32 hex characters — the Account ID, or the S3 endpoint or dashboard URL that contains it"],
  R2_ACCESS_KEY_ID: [/^[0-9a-f]{32}$/, "32 hex characters — the Access Key ID"],
  R2_SECRET_ACCESS_KEY: [/^[0-9a-f]{64}$/, "64 hex characters — the Secret Access Key"],
  DATAFORSEO_LOGIN: [/^\S+@\S+$/, "the email address you signed up with"],
  DATAFORSEO_PASSWORD: [/^\S{8,}$/, "the API password from the API Access page, not your account password"],
};

const fail = (why) => {
  console.error(why);
  process.exit(1);
};

const name = process.argv[2] ?? "";
if (!/^[A-Z][A-Z0-9_]*$/.test(name)) fail("usage: node scripts/set-secret.mjs NAME");

const raw = process.env.SECRET_FROM_STDIN ? readFileSync(0, "utf8") : execFileSync("pbpaste", { encoding: "utf8" });
let value = raw.trim();
if (!value) fail("The clipboard is empty — copy the value first.");
if (/\s/.test(value)) fail("The clipboard holds more than one word — copy just the value.");
// The Account ID is easiest to copy as part of something else.
if (name === "R2_ACCOUNT_ID") value = value.match(/(?:^|\/\/|\/)([0-9a-f]{32})(?:$|[./])/)?.[1] ?? value;

const shape = SHAPES[name];
if (shape && !shape[0].test(value)) fail(`${name} should be ${shape[1]}. Nothing saved; copy it again.`);

const file = process.env.ENV_FILE ?? new URL("../.env", import.meta.url).pathname;
const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [""];
const line = `${name}=${value}`;
const at = lines.findIndex((l) => l.startsWith(`${name}=`));
if (at >= 0) lines[at] = line;
else lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, line);
writeFileSync(file, lines.join("\n"), { mode: 0o600 });

if (!process.env.SECRET_FROM_STDIN) execFileSync("pbcopy", { input: "" });
console.log(`✓ ${name} saved (${value.length} characters). Clipboard cleared.`);
