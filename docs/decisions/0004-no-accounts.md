# 0004 — No accounts: edit links instead of logins

**Date:** 2026-09-23 · **Status:** accepted

Whoever submits a feed receives a secret edit link, `/f/<slug>/edit/#<token>`.
The token is in the fragment, so it never reaches a server log or a
Referer; the page's script sends it as `X-Edit-Token`, and only its sha256
is stored. Collections (v1.0 slice 2) work the same way. Readers keep their
subscriptions in localStorage with OPML import and export.

This removes sign-up friction for both audiences and leaves no personal
data to protect. The cost: a lost edit link cannot be recovered. A
publisher who lost it, or never had it, asks for removal through the
report form. (The plan let a Search Console connection prove ownership;
that went with ADR 0006.)

**Reopen if:** users need the same subscriptions on several devices badly
enough to ask — then add an optional sync key before any login.
