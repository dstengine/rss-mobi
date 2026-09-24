# Operations

How the live site at rss.mobi is run. None of this is needed to work on
the code locally; see the [README](../README.md) for that.

## Deploys

Vercel builds every push: `main` goes to production at rss.mobi, and a
pull request gets a preview URL. `vercel deploy --prod` from a clean
checkout of `main` does the same by hand, if GitHub is ever the problem.

## Configuration

Production secrets live in `.env` at the repository root (never committed;
see `.env.example`) and are copied to Vercel and GitHub by
`scripts/sync-secrets.sh`, which never prints a value. Scripts read `.env`
through `scripts/lib/env.sh`: sourcing it as shell would run the `&` in the
database connection string as a background job.

The database is MongoDB Atlas. The app's database user can read and write
the `rssmobi` database and nothing else.

`.env.local` wins over `.env`, so a local script run plainly talks to the
local database. To aim one at production, load `.env` first:

```
node --env-file=.env scripts/migrate.mjs rssmobi
```

## Scheduled jobs

Upstash QStash calls `/api/v1/cron/*` every 15 minutes with
`CRON_SECRET` ([ADR 0007](decisions/0007-cron-via-qstash.md)); see or
recreate its schedules with
`node --env-file=.env scripts/qstash-schedules.mjs [list]`.
`.github/workflows/cron.yml` does the same as a fallback, while the
repository variable `CRON_ENABLED` is `true`. The jobs take locks and do
only what is due, so two callers do no harm.

- `/api/v1/cron/fetch` polls the feeds whose turn has come.
- `/api/v1/cron/index-check` asks DataForSEO whether each post's original is
  in Google (`src/lib/indexcheck.ts`). A run collects the answers to earlier
  tasks, then files up to 100 new ones, oldest first.

### Index-check spending

A check is one `site:` query in DataForSEO's standard queue, $0.003. What
stops it spending:

- **The daily ceiling**, `LIMITS.serp` in `src/lib/budget.ts` ($1, about
  330 checks). A batch is reserved before its POST and settled to the real
  cost after. At the ceiling, posts wait in the queue with their pages at
  `noindex`, and Telegram hears once that day.
- **A refusal** — no money, a rate limit, bad credentials (HTTP 401/402/429,
  DataForSEO's 401xx/402xx) — pauses checks until 00:00 UTC, with one
  message. To resume sooner, after fixing the cause, delete the Redis key
  `n:serp:paused:<YYYY-MM-DD>`.
- **The balance** is read once a day; under ten days of the ceiling, one
  message a day until it is topped up at https://app.dataforseo.com/.
- **Every check** is logged in `index_checks` with its verdict and cost.

Rechecks: days 1, 3 and 7, then weekly while the original is missing, and
monthly once Google has it. A failed check is retried the next day and
keeps the item's last verdict.

## Backups and restore

Nightly at 02:00 UTC (`.github/workflows/backup.yml`, once the repository
variable `BACKUP_ENABLED` is `true`): `mongodump --gzip --archive`,
encrypted with [age](https://age-encryption.org) to the public key in
`AGE_PUBLIC_KEY`, uploaded to the R2 bucket `rss-mobi-backups`. After a
successful upload, archives older than 30 days are deleted — **except the
newest**, whatever its age. A copy lands in iCloud Drive
(`Backups/rss.mobi/`) each morning through `scripts/backup-pull.mjs` and
the LaunchAgent `scripts/mobi.rss.backup-pull.plist`, under the same rule.

The private key is `~/.config/rss-mobi/age.key`, with a copy in the
owner's password manager. Without it the archives cannot be read.

To restore — always into a new database first:

```
brew install age mongodb-database-tools
node scripts/backup.mjs list                      # or use a file from iCloud
scripts/restore.sh rssmobi-2026-09-23T02-00-05Z.archive.gz.age rssmobi_restore_test \
  'mongodb://127.0.0.1:27018/?directConnection=true'
```

The production user cannot write any other database, so the test restore
goes to the local one. Compare document counts between `rssmobi` and
`rssmobi_restore_test`, then restore into the live name only if that is
really what is wanted. Drop the test database afterwards — deliberately,
by hand.
