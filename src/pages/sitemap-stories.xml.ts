import type { APIRoute } from "astro";
import { urlset } from "../lib/sitemap.ts";
import { storyEntries, xmlResponse } from "../lib/sitemaps.ts";

export const GET: APIRoute = async () => xmlResponse(urlset(await storyEntries()));
