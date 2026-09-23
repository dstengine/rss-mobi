// A minimal S3 client for Cloudflare R2: list, get, put, delete, signed
// with AWS Signature V4 using node:crypto. Written out rather than pulling
// in the AWS SDK for four calls in two scripts.
import { createHash, createHmac } from "node:crypto";

const sha = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function r2FromEnv(env = process.env) {
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
    if (!env[k]) throw new Error(`${k} is not set`);
  }
  return r2({ account: env.R2_ACCOUNT_ID, keyId: env.R2_ACCESS_KEY_ID, secret: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET });
}

/** AWS Signature V4. Returns the headers to send, authorization included.
    Exported for its test against AWS's published example. */
export function signV4({ method, host, path, query = {}, headers = {}, payloadHash, keyId, secret, region, service, amzDate }) {
  const day = amzDate.slice(0, 8);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host, "x-amz-date": amzDate };
  const names = Object.keys(all).sort();
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(query[k])}`)
    .join("&");
  const canonical = [method, path, qs, names.map((h) => `${h}:${all[h]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`, qs };
}

export function r2({ account, keyId, secret, bucket }) {
  const host = `${account}.r2.cloudflarestorage.com`;

  async function call(method, key = "", query = {}, body) {
    const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
    const path = `/${bucket}${key ? `/${key.split("/").map(enc).join("/")}` : ""}`;
    const payloadHash = sha(body ?? "");
    const { qs, host: _h, ...headers } = signV4({
      method, host, path, query, payloadHash, keyId, secret, amzDate,
      headers: { "x-amz-content-sha256": payloadHash },
      region: "auto",
      service: "s3",
    });
    const res = await fetch(`https://${host}${path}${qs ? `?${qs}` : ""}`, { method, headers, body });
    if (!res.ok && res.status !== 404) throw new Error(`R2 ${method} ${key || "(bucket)"}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  return {
    /** Every object in the bucket: key, size, date. */
    async list(prefix = "") {
      const out = [];
      let token;
      do {
        const q = { "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) };
        const xml = await (await call("GET", "", q)).text();
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const f = (t) => m[1].match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1];
          out.push({ key: f("Key"), size: Number(f("Size")), date: new Date(f("LastModified")) });
        }
        token = xml.match(/<NextContinuationToken>([^<]*)</)?.[1];
      } while (token);
      return out;
    },
    async get(key) {
      const res = await call("GET", key);
      if (res.status === 404) throw new Error(`R2: ${key} not found`);
      return new Uint8Array(await res.arrayBuffer());
    },
    put: (key, bytes) => call("PUT", key, {}, bytes),
    del: (key) => call("DELETE", key),
  };
}
