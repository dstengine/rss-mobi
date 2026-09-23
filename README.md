# rss.mobi

A directory of RSS feeds, a mobile reader and a feed API. Anyone can submit
a feed; it is live as soon as it is read. Astro (server output) on Vercel,
MongoDB Atlas, Upstash Redis.

Rules for working on it: [`AGENTS.md`](AGENTS.md). Decisions:
[`docs/decisions/`](docs/decisions/). What changed: [`CHANGELOG.md`](CHANGELOG.md).

## Run it

```
docker start rss-mobi-mongo7 || docker run -d --name rss-mobi-mongo7 \
  -p 127.0.0.1:27018:27017 -v rss-mobi-mongo7:/data/db mongo:7
cat > .env.local <<'X'
MONGODB_CONNECTION_STRING=mongodb://127.0.0.1:27018/?directConnection=true
MONGODB_DB=rssmobi_dev
CRON_SECRET=dev-cron-secret-0123456789
X
npm install
npm run migrate
npm run dev            # http://localhost:4340
```

Poll feeds by hand: `curl -X POST localhost:4340/api/v1/cron/fetch -H
"Authorization: Bearer dev-cron-secret-0123456789" -H "Content-Type:
application/json" -d '{}'`.

## Configuration

Production secrets live in `.env` (never committed; see `.env.example`) and
are copied to Vercel and GitHub by `scripts/sync-secrets.sh`, which never
prints a value.

The database is MongoDB Atlas: organisation, project and cluster are all
named `rss-mobi` (free M0, AWS us-east-1). The app connects as
`rssmobi-app`, which can read and write the `rssmobi` database and nothing
else. The access list is `0.0.0.0/0` because neither Vercel nor GitHub
Actions has fixed addresses, so the password is the whole defence.

`.env.local` wins over `.env`, so a local script run plainly talks to the
local database. To aim one at Atlas, load `.env` first:

```
node --env-file=.env scripts/migrate.mjs rssmobi
```

## Jobs

`.github/workflows/cron.yml` calls `/api/v1/cron/*` every 15 minutes with
`CRON_SECRET`. `.github/workflows/backup.yml` backs the database up every
night.

## Backups and restore

Nightly at 02:00 UTC: `mongodump --gzip --archive`, encrypted with
[age](https://age-encryption.org) to the public key in `AGE_PUBLIC_KEY`,
uploaded to the R2 bucket `rss-mobi-backups`. After a successful upload,
archives older than 30 days are deleted — **except the newest**, whatever
its age. A copy lands in iCloud Drive (`Backups/rss.mobi/`) each morning
through `scripts/backup-pull.mjs` and the LaunchAgent
`scripts/mobi.rss.backup-pull.plist`, under the same rule.

The private key is `~/.config/rss-mobi/age.key`, with a copy in the
owner's password manager. Without it the archives cannot be read.

To restore — always into a new database first:

```
brew install age mongodb-database-tools
node scripts/backup.mjs list                      # or use a file from iCloud
scripts/restore.sh rssmobi-2026-09-23T02-00-05Z.archive.gz.age rssmobi_restore_test
```

`rssmobi-app` cannot write `rssmobi_restore_test` on Atlas, so the test
restore goes to the local database: pass
`mongodb://127.0.0.1:27018/?directConnection=true` as the third argument.
Compare document counts between `rssmobi` and `rssmobi_restore_test`, then
restore into the live name only if that is really what is wanted. Drop the
test database afterwards — deliberately, by hand.
