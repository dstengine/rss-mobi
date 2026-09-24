import type { APIRoute } from "astro";
import { urlset } from "../lib/sitemap.ts";
import { itemEntries, itemFileCount, xmlResponse } from "../lib/sitemaps.ts";

export const GET: APIRoute = async ({ params }) => {
  const n = Number(params.n);
  if (!Number.isInteger(n) || n < 1 || n > (await itemFileCount())) return new Response("Not found", { status: 404 });
  return xmlResponse(urlset(await itemEntries(n)));
};
