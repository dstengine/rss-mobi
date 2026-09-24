import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { assertion, inspect, serviceAccount, submitSitemap } from "../src/lib/gsc.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = {
  type: "service_account",
  client_email: "rss-mobi-workers@rss-mobi-509607.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

test("the service account key is read as JSON or as base64", () => {
  const raw = JSON.stringify(key);
  assert.equal(serviceAccount(raw)?.client_email, key.client_email);
  assert.equal(serviceAccount(Buffer.from(raw).toString("base64"))?.client_email, key.client_email);
  assert.equal(serviceAccount(""), null);
  assert.throws(() => serviceAccount(JSON.stringify({ client_email: "someone@gmail.com", private_key: "x" })), /not a service account/);
});

test("the assertion is a JWT signed with the account's key, for an hour", () => {
  const jwt = assertion(serviceAccount(JSON.stringify(key))!, 1_790_000_000);
  const [head, claims, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(head, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const c = JSON.parse(Buffer.from(claims, "base64url").toString());
  assert.equal(c.iss, key.client_email);
  assert.equal(c.aud, "https://oauth2.googleapis.com/token");
  assert.equal(c.scope, "https://www.googleapis.com/auth/webmasters");
  assert.equal(c.exp - c.iat, 3600);
  assert.ok(createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url")));
});

test("only rss.mobi's own pages are inspected or submitted", async () => {
  await assert.rejects(inspect("https://example.com/post"), /only pages on https:\/\/rss\.mobi\//);
  await assert.rejects(submitSitemap("https://example.com/sitemap.xml"), /not on https:\/\/rss\.mobi\//);
});
