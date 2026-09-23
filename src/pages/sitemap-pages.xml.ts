import type { APIRoute } from "astro";
import { urlset } from "../lib/sitemap.ts";
import { pageEntries, xmlResponse } from "../lib/sitemaps.ts";

export const GET: APIRoute = async () => xmlResponse(urlset(await pageEntries()));
