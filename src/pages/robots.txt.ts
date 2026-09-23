import type { APIRoute } from "astro";
import { site } from "../site.config.ts";

// /api/ is closed because it is data, not pages. /f/ holds edit pages,
// which are useless without the key in their fragment. /go/ is reserved
// for tracked outbound hops (v1.2), and /c/*/edit for collection editing.
const BODY = `User-agent: *
Disallow: /api/
Disallow: /f/
Disallow: /go/
Disallow: /c/*/edit
Allow: /

Sitemap: ${site.url}/sitemap-index.xml
`;

export const GET: APIRoute = () =>
  new Response(BODY, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
