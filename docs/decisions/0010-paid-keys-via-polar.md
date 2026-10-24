# 0010 — Paid API keys through Polar, checked on use

**Date:** 2026-10-24 · **Status:** accepted

The first paid thing on rss.mobi is an API key: 600 requests a minute
instead of the anonymous 120, and `read:full`, for $29 and 30 days, sold
at `/api/`. Polar (polar.sh) is the merchant of record: it takes the card,
issues the receipt, handles tax, and grants the buyer a licence key with
our prefix (`RSSMOBI-…`) through its License Keys benefit. The buyer sends
that key as `Authorization: Bearer`, exactly like a hand-made `rmk_` key.

The key is checked when it is used, not when it is sold:
`src/lib/polar.ts` asks Polar's public validation endpoint, which needs no
secret of ours, and caches the verdict ten minutes under the key's hash.
So there is no webhook, no customer record, no e-mail and no secret on
Vercel — only the public organisation id and the checkout link. A refund
revokes the key at Polar (its default), and we see a 404 within ten
minutes. Polar unreachable with nothing cached is a 503 the caller hears,
never a silent fall to the anonymous allowance (the rule in `http.ts`).

Why Polar: it pays out to individuals in Armenia through Stripe Connect
Express (Stripe's own list, 24 Oct 2026: AM, express, recipient
agreement, transfers, individual), charges 5 % + $0.50 on the free plan,
and sells licence keys as a built-in benefit. Lemon Squeezy is moving to
Stripe Managed Payments, which does not take Armenian sellers.

Why not a subscription first: nothing to cancel after the rail test, and
the kill criterion — a payout on an Armenian account — is reached as fast
by a one-time sale. A `$29/month` product is one more product on the
same benefit once the first payout has arrived; renewals would then need
`subscription.revoked` by webhook or, as now, a 404 on use.

**Reopen if:** a buyer needs an account (invoices, several keys, usage),
Polar's validation is slow or down often enough to show in the API's
latency, the fee passes 10 % of what is sold, or a subscription product
is added — then webhooks and a local record of grants.
