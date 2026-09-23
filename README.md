# rss.mobi

[rss.mobi](https://rss.mobi/) is a directory of RSS feeds, with a mobile
reader and a feed API on the way. Anyone can submit a feed: it is found
from a site or feed address, read, and live straight away, with no account
and no review queue. Each feed gets a page with its latest posts and
one-tap links to follow it in Feedly, Inoreader, NetNewsWire or any other
reader.

Astro (server output) on Vercel, MongoDB, Upstash Redis. Feeds are parsed
from RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed.

- What changed: [`CHANGELOG.md`](CHANGELOG.md)
- Why it is built this way: [`docs/decisions/`](docs/decisions/)
- Rules for working on the code, for people and agents alike:
  [`AGENTS.md`](AGENTS.md)
- Running it in production: [`docs/operations.md`](docs/operations.md)

## Run it

Node 24 and Docker. MongoDB 7 runs locally; 8 refuses to start on some
Docker Desktop kernels.

```
docker run -d --name rss-mobi-mongo7 -p 127.0.0.1:27018:27017 \
  -v rss-mobi-mongo7:/data/db mongo:7
cat > .env.local <<'X'
MONGODB_CONNECTION_STRING=mongodb://127.0.0.1:27018/?directConnection=true
MONGODB_DB=rssmobi_dev
CRON_SECRET=dev-cron-secret-0123456789
X
npm install
npm run migrate
npm run dev            # http://localhost:4340
```

Submit a feed at `/submit/`, then poll by hand:

```
curl -X POST localhost:4340/api/v1/cron/fetch \
  -H "Authorization: Bearer dev-cron-secret-0123456789" \
  -H "Content-Type: application/json" -d '{}'
```

## Test

```
npm test                                      # unit tests, no services needed
RSS_MOBI_BASE=http://localhost:4340 npm run test:live
npm run seo -- http://localhost:4340          # titles, sitemaps, robots
```

`test:live` fetches every page type as Googlebot and as a phone and fails
if the HTML differs: nothing here may show a crawler something else than a
reader.

## Contributing

Issues and pull requests are welcome. Code, comments and docs are in
English. A change is ready when `npm test` passes, `npm run seo` is clean
and `CHANGELOG.md` says what changed; `AGENTS.md` lists the rules that are
easy to break. Security problems: see [`SECURITY.md`](SECURITY.md), not a
public issue.

## Licence

[GNU Affero General Public License v3.0](LICENSE). If you run a modified
version as a service, its users are entitled to its source.
