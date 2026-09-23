import { test } from "node:test";
import assert from "node:assert/strict";
import { toPrune, dateOf } from "../scripts/lib/prune.mjs";
import { signV4 } from "../scripts/lib/r2.mjs";

const DAY = 86_400_000;
const now = Date.parse("2026-09-23T12:00:00Z");
const at = (daysAgo: number, key = `b${daysAgo}`) => ({ key, date: new Date(now - daysAgo * DAY) });

test("backups older than 30 days go, except the newest", () => {
  assert.deepEqual(toPrune([at(1), at(10), at(31), at(45)], now), ["b31", "b45"]);
});

test("the newest backup survives even when it is older than 30 days", () => {
  // Backups stopped two months ago: nothing new has arrived since.
  assert.deepEqual(toPrune([at(60), at(75), at(90)], now), ["b75", "b90"]);
  assert.deepEqual(toPrune([at(400)], now), []);
  assert.deepEqual(toPrune([], now), []);
});

test("backup names carry their date", () => {
  assert.equal(dateOf("rssmobi-2026-09-23T02-00-05Z.archive.gz.age")?.toISOString(), "2026-09-23T02:00:05.000Z");
  assert.equal(dateOf("notes.txt"), null);
});

test("SigV4 matches AWS's published example", () => {
  // docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html,
  // the IAM ListUsers example with its documented example keys.
  const h = signV4({
    method: "GET",
    host: "iam.amazonaws.com",
    path: "/",
    query: { Action: "ListUsers", Version: "2010-05-08" },
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    keyId: "AKIDEXAMPLE",
    secret: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "iam",
    amzDate: "20150830T123600Z",
  });
  assert.match(h.authorization, /Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7$/);
});
