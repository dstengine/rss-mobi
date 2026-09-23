# rss-mobi-cron

The scheduler for [rss.mobi](https://rss.mobi/), a directory of RSS feeds.
Every 15 minutes a GitHub Actions workflow asks the site to poll the feeds
whose turn has come. The request carries a shared secret, kept in this
repository's secrets; the log shows only the HTTP status.

The site's own code is in a private repository. This one is generated from
it, so changes made here directly are overwritten.
