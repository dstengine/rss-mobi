// What the site calls itself, and what it wants to be found for.
//
// `keyword` is the one phrase scripts/seo-check.mjs looks for in the title
// and description of every indexable page, and in the h1 of the pages we
// name ourselves. `titleSuffix` carries it too: nobody searches for
// "rss.mobi" yet, so the most expensive characters on the page go to the
// phrase people do search for. See AGENTS.md.

export const site = {
  name: "rss.mobi",
  url: "https://rss.mobi",
  keyword: "RSS feeds",
  titleSuffix: "RSS Feeds Directory",
  description:
    "A free directory of RSS feeds: find feeds by topic, follow them on your phone and submit your own. No account, no sign-up.",
  /** Where complaints and takedown requests go besides the report form:
      a catch-all mailbox on vvm.space. Empty would hide it from the terms
      and about pages, which say only what is true. */
  contact: "rss-mobi@vvm.space" as string,
  /** The header row on a wide screen. */
  nav: [
    { href: "/tags/", label: "Topics", icon: "topics", title: "Browse RSS feeds by topic" },
    { href: "/reader/", label: "Reader", icon: "reader", title: "Read the RSS feeds you follow on your phone" },
    { href: "/submit/", label: "Submit", icon: "plus", title: "Submit an RSS feed to the directory" },
  ],
  /** The tab bar along the bottom of a phone, as in an app: the five
      places a reader moves between. `match` lists the paths that count as
      being on that tab, so a feed's page still shows where it belongs. */
  tabs: [
    { href: "/", label: "Home", icon: "home", title: "The RSS feeds directory: newest feeds and topics", match: ["/feed/", "/item/", "/submit/", "/f/"] },
    { href: "/tags/", label: "Topics", icon: "topics", title: "Browse RSS feeds by topic", match: ["/tag/"] },
    { href: "/reader/", label: "Reader", icon: "reader", title: "Read the RSS feeds you follow on your phone", match: [] },
    { href: "/c/new/", label: "Combine", icon: "combine", title: "Combine several RSS feeds into one", match: ["/c/"] },
    { href: "/search/", label: "Search", icon: "search", title: "Search the RSS feeds directory", match: [] },
  ],
  /** The phone menu, under its search box: what the tab bar leaves out. */
  menu: [
    { href: "/submit/", label: "Submit a feed", icon: "plus", title: "Submit an RSS feed to the directory" },
    { href: "/about/", label: "About", icon: "about", title: "About the rss.mobi RSS feeds directory" },
    { href: "/terms/", label: "Terms", icon: "terms", title: "Terms for submitting and reading RSS feeds" },
  ],
  footer: [
    { href: "/about/", label: "About", title: "About the rss.mobi RSS feeds directory" },
    { href: "/terms/", label: "Terms", title: "Terms for submitting and reading RSS feeds" },
    { href: "/c/new/", label: "Combine feeds", title: "Combine several RSS feeds into one" },
    { href: "/api/v1/feeds", label: "API", title: "The RSS feeds directory as JSON" },
    // AGPL-3.0 §13: the people using the site are offered its source.
    { href: "https://github.com/dstengine/rss-mobi", label: "Source", title: "Source code of this RSS feeds directory, AGPL-3.0" },
  ],
} as const;

/** The date each page's own copy last changed. A page that lists entries
    is dated by the newest of them against this date; a page with no
    entries at all is dated by this alone. Edit a page's text, move its
    date — that is the whole rule, and seo-check cannot enforce it. */
export const COPY_UPDATED: Record<string, string> = {
  "/": "2026-09-23",
  "/tags/": "2026-09-23",
  "/tag/": "2026-09-23",
  "/feed/": "2026-09-23",
  "/submit/": "2026-09-23",
  "/about/": "2026-09-24",
  "/terms/": "2026-09-24",
  "/reader/": "2026-09-23",
  "/c/new/": "2026-09-23",
};

export const copyDate = (path: string) => new Date(`${COPY_UPDATED[path] ?? "2026-09-23"}T00:00:00Z`);
