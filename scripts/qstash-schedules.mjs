#!/usr/bin/env node
// The QStash schedules that call rss.mobi's jobs (ADR 0007). Idempotent:
// each schedule has a fixed id, and creating it again replaces it.
//
//   node --env-file=.env scripts/qstash-schedules.mjs        # create or update
//   node --env-file=.env scripts/qstash-schedules.mjs list   # what is there
//
// QStash forwards CRON_SECRET as the Authorization header, the same one
// the GitHub workflow sends. Prints ids, schedules and destinations only:
// a schedule's stored headers include that secret.
const token = process.env.QSTASH_TOKEN;
const secret = process.env.CRON_SECRET;
if (!token || !secret) {
  console.error("QSTASH_TOKEN and CRON_SECRET must be set (node --env-file=.env …)");
  process.exit(1);
}
const API = (process.env.QSTASH_URL ?? "https://qstash.upstash.io").replace(/\/$/, "");
const SITE = "https://rss.mobi";
const JOBS = [
  { id: "rss-mobi-fetch", path: "/api/v1/cron/fetch", cron: "*/15 * * * *" },
  // Seven minutes later, so the two never hold the function at once.
  { id: "rss-mobi-index-check", path: "/api/v1/cron/index-check", cron: "7,22,37,52 * * * *" },
];

async function list() {
  const res = await fetch(`${API}/v2/schedules`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`QStash: list failed, HTTP ${res.status}`);
  return (await res.json()).map((s) => ({ id: s.scheduleId, cron: s.cron, destination: s.destination, paused: !!s.isPaused }));
}

if (process.argv[2] === "list") {
  console.table(await list());
} else {
  for (const job of JOBS) {
    const res = await fetch(`${API}/v2/schedules/${SITE}${job.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Upstash-Schedule-Id": job.id,
        "Upstash-Cron": job.cron,
        "Upstash-Method": "POST",
        "Upstash-Forward-Authorization": `Bearer ${secret}`,
        // The jobs are idempotent and the next run is minutes away: a
        // failed run is not retried into a function that is still failing.
        "Upstash-Retries": "0",
      },
      body: "{}",
    });
    console.log(`${job.id}: HTTP ${res.status}`);
    if (!res.ok) process.exitCode = 1;
  }
  console.table(await list());
}
