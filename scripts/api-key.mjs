#!/usr/bin/env node
// Makes, lists and revokes API keys (src/lib/keys.ts).
//
//   node --env-file=.env scripts/api-key.mjs create --name cmx --scopes read:full[,write:feeds] [--rate 600]
//   node --env-file=.env scripts/api-key.mjs create … --save ~/dst/.env:RSS_MOBI_KEY_CMX
//   node --env-file=.env scripts/api-key.mjs list
//   node --env-file=.env scripts/api-key.mjs revoke <prefix>
//
// A key is shown once. With --save it is not shown at all: it goes
// straight into the named variable of that env file (replaced if it is
// there already) and only its prefix is printed — the way to hand a key to
// a network site without it passing through a terminal's scrollback.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createKey, listKeys, revokeKey, RATE_DEFAULT, SCOPES } from "../src/lib/keys.ts";
import { client } from "../src/lib/db.ts";

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const usage = () => {
  console.error(`usage: api-key.mjs create --name <site> --scopes <${SCOPES.join("|")},…> [--rate ${RATE_DEFAULT}] [--save <file>:<VAR>]
       api-key.mjs list
       api-key.mjs revoke <prefix>`);
  process.exit(2);
};

function save(target, token) {
  const at = target.lastIndexOf(":");
  if (at < 1) throw new Error("--save takes <file>:<VAR>");
  const file = target.slice(0, at).replace(/^~(?=\/)/, homedir());
  const name = target.slice(at + 1);
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`not a variable name: ${name}`);
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  const kept = lines.filter((l) => !l.startsWith(`${name}=`));
  if (kept.at(-1) === "") kept.pop();
  writeFileSync(file, `${[...kept, `${name}=${token}`].join("\n")}\n`, { mode: 0o600 });
  return { file, name };
}

try {
  if (cmd === "create") {
    const name = opt("name");
    const scopes = (opt("scopes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!name) usage();
    const { token, key } = await createKey(name, scopes, Number(opt("rate") ?? RATE_DEFAULT));
    const where = opt("save");
    if (where) {
      const { file, name: v } = save(where, token);
      console.log(`key ${key.prefix} for ${key.name} (${key.scopes.join(", ") || "reading"}, ${key.rate}/min) saved as ${v} in ${file}`);
    } else {
      console.log(`key ${key.prefix} for ${key.name} (${key.scopes.join(", ") || "reading"}, ${key.rate}/min). Shown once, stored only as a hash:\n\n${token}\n`);
    }
  } else if (cmd === "list") {
    const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
    for (const k of await listKeys()) {
      console.log(`${k.prefix}  ${k.name.padEnd(16)} ${(k.scopes.join(",") || "reading").padEnd(28)} ${String(k.rate).padStart(5)}/min  made ${day(k.createdAt)}  used ${day(k.lastUsedAt)}${k.revokedAt ? `  REVOKED ${day(k.revokedAt)}` : ""}`);
    }
  } else if (cmd === "revoke") {
    const prefix = rest[0];
    if (!prefix) usage();
    const k = await revokeKey(prefix);
    console.log(k ? `revoked ${k.prefix} (${k.name})` : `no live key with prefix ${prefix}`);
    if (!k) process.exitCode = 1;
  } else usage();
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await (await client()).close();
}
