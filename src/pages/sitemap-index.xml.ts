import type { APIRoute } from "astro";
import { sitemapIndex, newest } from "../lib/sitemap.ts";
import { feedEntries, feedFileCount, itemEntries, itemFileCount, pageEntries, tagEntries, xmlResponse } from "../lib/sitemaps.ts";
import { site } from "../site.config.ts";

export const GET: APIRoute = async () => {
  const [pages, tags, files, itemFiles] = await Promise.all([pageEntries(), tagEntries(), feedFileCount(), itemFileCount()]);
  const children = [
    { loc: `${site.url}/sitemap-pages.xml`, lastmod: newest(pages.map((e) => e.lastmod)) },
    ...(tags.length ? [{ loc: `${site.url}/sitemap-tags.xml`, lastmod: newest(tags.map((e) => e.lastmod)) }] : []),
  ];
  for (let n = 1; n <= files; n++) {
    const entries = await feedEntries(n);
    if (entries.length) children.push({ loc: `${site.url}/sitemap-feeds-${n}.xml`, lastmod: newest(entries.map((e) => e.lastmod)) });
  }
  for (let n = 1; n <= itemFiles; n++) {
    const entries = await itemEntries(n);
    if (entries.length) children.push({ loc: `${site.url}/sitemap-items-${n}.xml`, lastmod: newest(entries.map((e) => e.lastmod)) });
  }
  return xmlResponse(sitemapIndex(children));
};
