import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";
import { existsSync } from "node:fs";

// Local development reads secrets into process.env, which is where the
// server code looks for them (src/lib/env.ts). `.env.local` is read first
// and wins, because loadEnvFile never overwrites a variable that is already
// set: it points development at a local database while `.env` holds the
// production values. Vercel has neither file and sets process.env itself.
for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);

// Every page is rendered on request: the catalogue changes with each
// submission and each fetch, which a static build would chase all day
// against a limit of 100 builds. The CDN in front absorbs the repeat
// traffic instead — see `cacheFor()` in src/lib/http.ts.
export default defineConfig({
  site: "https://rss.mobi",
  output: "server",
  trailingSlash: "ignore",
  adapter: vercel({
    // The fetch and index-check jobs are batch work; everything else
    // returns in well under a second.
    maxDuration: 60,
  }),
});
