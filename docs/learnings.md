# Learnings

Observation → evidence → where it was applied. Newest first.

## 2026-09-23 — slice 1

- **MongoDB 8 does not start on Docker Desktop's Linux 6.19 kernel.**
  Evidence: `mongo:8` exits at once with SERVER-121912. Applied: local
  development uses `mongo:7`; Atlas is unaffected.
- **Astro refuses cross-site POSTs without a JSON content type.** Evidence:
  a bare `curl -X POST` to the cron endpoint got 403 "Cross-site POST form
  submissions are forbidden" before reaching our 401. Applied: the cron
  workflow and every client send `Content-Type: application/json`.
- **`process.loadEnvFile` never overwrites a variable already set.**
  Applied: `.env.local` is loaded before `.env`, so development can point
  at a local database while `.env` holds production values.
- **A side effect must be recorded only once it happened.** The first
  IndexNow version set `announcedAt` before pinging, so a missing key would
  have marked every feed announced forever. Applied: `announcedAt` is set
  only on a 200/202.
- **Feed titles carry taglines.** "Articles on Smashing Magazine — For Web
  Designers And Developers" made a 60-character slug cut mid-word. Applied:
  `slugify` keeps the part before a separator and cuts between words.
- **Excerpts often repeat the title.** Many feeds open their content with
  the post's heading. Applied: `withoutTitle()` in the parser.
