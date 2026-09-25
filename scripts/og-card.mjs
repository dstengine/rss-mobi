#!/usr/bin/env node
// Draws public/og.png: the card a shared link to any page but a post's
// unfolds into (a post's is its own picture). 1200×630, Open Graph's size.
// Rendered from SVG with the system's fonts, so run it on a Mac and commit
// the result; it changes only when this file does.
//
//   node scripts/og-card.mjs
import sharp from "sharp";

const W = 1200;
const H = 630;
const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#fbfaf8"/>
  <g transform="translate(96 96)">
    <rect width="132" height="132" rx="30" fill="#c2410c"/>
    <g transform="translate(13.2 13.2) scale(4.4)">
      <circle cx="7" cy="17" r="2" fill="#fff"/>
      <path fill="#fff" d="M5 10a9 9 0 0 1 9 9h-2.5A6.5 6.5 0 0 0 5 12.5zM5 5a14 14 0 0 1 14 14h-2.5A11.5 11.5 0 0 0 5 7.5z"/>
    </g>
  </g>
  <text x="256" y="180" font-family="${FONT}" font-size="56" font-weight="700" fill="#1c1a17">rss.mobi</text>
  <text x="92" y="370" font-family="${FONT}" font-size="92" font-weight="800" fill="#1c1a17" letter-spacing="-2">RSS Feeds Directory</text>
  <text x="96" y="446" font-family="${FONT}" font-size="38" fill="#6b6560">Find feeds by topic and follow them on your phone.</text>
  <text x="96" y="520" font-family="${FONT}" font-size="32" font-weight="600" fill="#c2410c">Free · No account · Works offline</text>
  <rect y="${H - 20}" width="${W}" height="20" fill="#c2410c"/>
</svg>`;

const out = new URL("../public/og.png", import.meta.url);
await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(out.pathname);
console.log(`wrote ${out.pathname}`);
