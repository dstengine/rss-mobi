// POST /api/v1/discover {url} — finds and reads a feed without saving it:
// the preview step of the submit form, and a free tool on its own.
import type { APIRoute } from "astro";
import { feeds } from "../../../lib/db.ts";
import { discover } from "../../../lib/feeds/discover.ts";
import { FetchError } from "../../../lib/feeds/get.ts";
import { NotAFeed } from "../../../lib/feeds/parse.ts";
import { canonical, hostOf } from "../../../lib/feeds/url.ts";
import { humanFetchError } from "../../../lib/catalog.ts";
import { body, error, json, limitIp } from "../../../lib/http.ts";

export const POST: APIRoute = async (ctx) => {
  const limited = await limitIp(ctx, "discover", 20, "10 m");
  if (limited) return limited;
  const input = await body<{ url?: string }>(ctx, 4_000);
  if (!input?.url || typeof input.url !== "string") return error(400, "Send {\"url\": \"https://…\"}.");

  try {
    const found = await discover(input.url);
    const existing = await (await feeds()).findOne({ canonicalUrl: canonical(found.feedUrl) }, { projection: { slug: 1, status: 1 } });
    const f = found.feed;
    return json({
      feedUrl: found.feedUrl,
      title: f.title,
      description: f.description,
      siteUrl: f.siteUrl,
      host: hostOf(f.siteUrl) || hostOf(found.feedUrl),
      format: f.format,
      lang: f.lang,
      items: f.items.slice(0, 5).map((it) => ({ title: it.title, url: it.url, publishedAt: it.publishedAt })),
      itemCount: f.items.length,
      alternates: found.alternates.length ? [{ url: found.feedUrl, title: f.title }, ...found.alternates] : [],
      existing: existing && existing.status !== "hidden" ? existing.slug : null,
    });
  } catch (e) {
    if (e instanceof NotAFeed || e instanceof FetchError) return error(422, humanFetchError(e));
    console.error("discover failed", e);
    return error(500, "Something went wrong reading that address.");
  }
};
