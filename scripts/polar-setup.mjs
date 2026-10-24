#!/usr/bin/env node
// Sets up what rss.mobi sells on Polar (ADR 0010): the product, its
// licence-key benefit and the checkout link, and prints the env lines the
// site needs. Idempotent — each is found by name before it is made. Needs
// an organisation access token in .env:
//
//   node scripts/set-secret.mjs POLAR_ACCESS_TOKEN            # production
//   node scripts/set-secret.mjs POLAR_SANDBOX_ACCESS_TOKEN    # sandbox.polar.sh
//
//   node --env-file=.env scripts/polar-setup.mjs --sandbox   # first: buy with card 4242…
//   node --env-file=.env scripts/polar-setup.mjs             # then production
//   node --env-file=.env scripts/polar-setup.mjs --dry-run   # say what would be made
//
// Nothing printed here is a secret: organisation id, product id and the
// checkout URL are what the public page shows anyway.

const flags = new Set(process.argv.slice(2));
const sandbox = flags.has("--sandbox");
const dry = flags.has("--dry-run");
const base = sandbox ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";
const token = process.env[sandbox ? "POLAR_SANDBOX_ACCESS_TOKEN" : "POLAR_ACCESS_TOKEN"];
if (!token) {
  console.error(`${sandbox ? "POLAR_SANDBOX_ACCESS_TOKEN" : "POLAR_ACCESS_TOKEN"} is not set; see the comment at the top of this script`);
  process.exit(2);
}

/** What is sold. Change here, re-run: a renamed product is a new one. */
export const PRODUCT = {
  name: "rss.mobi API key — 30 days",
  priceCents: 2900,
  currency: "usd",
  description: [
    "A key for the rss.mobi RSS feeds API, for 30 days from purchase: 600 requests a minute instead of 120, and the full fields on every post and feed.",
    "",
    "Send it as `Authorization: Bearer <key>`. The key is shown here after payment and in your receipt; rss.mobi stores nothing about you.",
    "",
    "Refund within 14 days on request. Details: https://rss.mobi/api/",
  ].join("\n"),
  metadata: { site: "rss.mobi", scope: "read:full", days: 30 },
};
export const BENEFIT = { description: "rss.mobi API key, 30 days", prefix: "RSSMOBI", expires: { ttl: 1, timeframe: "month" } };
export const LINK = { label: "rss.mobi API key" };

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data?.detail ?? data).slice(0, 500)}`);
  return data;
}

const items = async (path) => (await api("GET", path)).items ?? [];

async function main() {
  const orgs = await items("/v1/organizations?limit=10");
  if (orgs.length !== 1) throw new Error(`the token sees ${orgs.length} organisations; use an organisation access token`);
  const org = orgs[0];
  console.log(`organisation ${org.name} (${org.slug}) ${org.id}${sandbox ? " — sandbox" : ""}`);

  let product = (await items(`/v1/products?organization_id=${org.id}&is_archived=false&limit=100`)).find((p) => p.name === PRODUCT.name);
  if (product) console.log(`product exists: ${product.id}`);
  else if (dry) console.log(`would create product "${PRODUCT.name}" at $${(PRODUCT.priceCents / 100).toFixed(2)}`);
  else {
    product = await api("POST", "/v1/products", {
      name: PRODUCT.name,
      description: PRODUCT.description,
      recurring_interval: null,
      recurring_interval_count: null,
      prices: [{ amount_type: "fixed", price_amount: PRODUCT.priceCents, price_currency: PRODUCT.currency }],
      metadata: PRODUCT.metadata,
      organization_id: org.id,
    });
    console.log(`product made: ${product.id}`);
  }

  let benefit = (await items(`/v1/benefits?organization_id=${org.id}&type=license_keys&limit=100`)).find((b) => b.description === BENEFIT.description);
  if (benefit) console.log(`benefit exists: ${benefit.id}`);
  else if (dry) console.log(`would create licence-key benefit "${BENEFIT.description}", prefix ${BENEFIT.prefix}, expires after ${BENEFIT.expires.ttl} ${BENEFIT.expires.timeframe}`);
  else {
    benefit = await api("POST", "/v1/benefits", {
      type: "license_keys",
      description: BENEFIT.description,
      organization_id: org.id,
      properties: { prefix: BENEFIT.prefix, expires: BENEFIT.expires, limit_usage: null },
    });
    console.log(`benefit made: ${benefit.id}`);
  }

  if (product && benefit) {
    const attached = (product.benefits ?? []).some((b) => b.id === benefit.id);
    if (attached) console.log("benefit is on the product");
    else if (dry) console.log("would attach the benefit to the product");
    else {
      await api("POST", `/v1/products/${product.id}/benefits`, { benefits: [benefit.id] });
      console.log("benefit attached");
    }
  }

  let link = (await items(`/v1/checkout-links?organization_id=${org.id}&limit=100`)).find((l) => l.label === LINK.label);
  if (link) console.log(`checkout link exists: ${link.url}`);
  else if (dry) console.log(`would create checkout link "${LINK.label}"`);
  else if (product) {
    link = await api("POST", "/v1/checkout-links", {
      payment_processor: "stripe",
      products: [product.id],
      label: LINK.label,
      allow_discount_codes: true,
      require_billing_address: false,
      metadata: { site: "rss.mobi" },
    });
    console.log(`checkout link made: ${link.url}`);
  }

  console.log(`\n# for .env, Vercel (production) and the sandbox run:\nPOLAR_ORGANIZATION_ID=${org.id}\nPOLAR_ENV=${sandbox ? "sandbox" : "production"}\nPOLAR_KEY_PREFIX=${BENEFIT.prefix}\nPOLAR_CHECKOUT_URL=${link?.url ?? "<after the link is made>"}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
