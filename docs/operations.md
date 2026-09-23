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

`.github/workflows/cron.yml` calls `/api/v1/cron/*` every 15 minutes with
`CRON_SECRET`, once the repository variable `CRON_ENABLED` is `true`. Why
GitHub Actions and not Vercel cron: [ADR 0003](decisions/0003-cron-via-github-actions.md).

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
