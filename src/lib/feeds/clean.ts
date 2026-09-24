// A post's HTML, made safe to pass on.
//
// Our copy of a feed carries the post as its publisher wrote it, and the
// reader shows it inside our own page. Both are HTML from a stranger, so
// it goes through an allowlist: text, links, images, tables, code, audio
// and video, and embeds from YouTube and Vimeo only. No scripts, no
// styles, no event handlers, no forms. Relative addresses are made
// absolute against the post, since a reader has no idea where it came
// from, and the invisible pixels publishers count opens with are dropped.
import sanitizeHtml from "sanitize-html";
import { absolute } from "./url.ts";

const TAGS = [
  ...sanitizeHtml.defaults.allowedTags.filter((t) => !["nav", "header", "footer", "aside"].includes(t)),
  "img", "picture", "source", "figure", "figcaption", "video", "audio", "track", "iframe", "del", "ins", "details", "summary",
];

const ATTRS: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "title", "rel", "target"],
  img: ["src", "srcset", "sizes", "alt", "title", "width", "height", "loading", "decoding"],
  source: ["src", "srcset", "sizes", "type", "media"],
  video: ["src", "poster", "controls", "width", "height", "preload", "playsinline"],
  audio: ["src", "controls", "preload"],
  track: ["src", "kind", "srclang", "label"],
  iframe: ["src", "width", "height", "title", "allow", "allowfullscreen", "loading"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan", "scope"],
  ol: ["start", "reversed", "type"],
  time: ["datetime"],
  abbr: ["title"],
  blockquote: ["cite"],
  q: ["cite"],
};

/** Hosts whose images are counters, not pictures. */
const TRACKERS = /(^|\.)(feedburner\.com|feedsportal\.com|pixel\.wp\.com|stats\.wordpress\.com|doubleclick\.net|google-analytics\.com|mailchimp\.com|list-manage\.com|substackcdn\.com\/open|medium\.com\/_\/stat)/i;

const URL_ATTRS = ["href", "src", "poster", "cite"];

/** `html` from a feed, safe to show and to republish. `base` is the post's
    own address: relative links and images resolve against it. */
export function clean(html: string, base: string): string {
  if (!html) return "";
  const out = sanitizeHtml(html, {
    allowedTags: TAGS,
    allowedAttributes: ATTRS,
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"], source: ["http", "https"] },
    allowProtocolRelative: false,
    allowedIframeHostnames: ["www.youtube.com", "www.youtube-nocookie.com", "youtube.com", "player.vimeo.com"],
    transformTags: {
      "*": (tagName, attribs) => {
        const a = { ...attribs };
        // Lazy loaders keep the real picture in data-src and put a blank
        // one in src; a reader runs none of their script.
        if (tagName === "img" || tagName === "source") {
          const lazy = a["data-src"] || a["data-lazy-src"] || a["data-original"];
          if (lazy && (!a.src || a.src.startsWith("data:"))) a.src = lazy;
          if (a["data-srcset"] && !a.srcset) a.srcset = a["data-srcset"];
        }
        for (const k of URL_ATTRS) if (a[k]) a[k] = absolute(a[k], base) || a[k];
        if (a.srcset) a.srcset = srcset(a.srcset, base);
        if (tagName === "a") {
          a.rel = "nofollow ugc noopener";
          a.target = "_blank";
        }
        if (tagName === "img") {
          a.loading = "lazy";
          a.decoding = "async";
        }
        if (tagName === "iframe") a.loading = "lazy";
        if (tagName === "video" || tagName === "audio") {
          a.controls = "";
          a.preload = "none";
        }
        return { tagName, attribs: a };
      },
    },
    exclusiveFilter: (frame) => {
      if (frame.tag === "img") {
        const w = Number(frame.attribs.width);
        const h = Number(frame.attribs.height);
        if ((w > 0 && w <= 2) || (h > 0 && h <= 2)) return true;
        if (!frame.attribs.src || TRACKERS.test(hostPath(frame.attribs.src))) return true;
      }
      // A feed's "share this" row: links to its own counters, no text.
      if (frame.tag === "a" && TRACKERS.test(hostPath(frame.attribs.href ?? "")) && !frame.text.trim()) return true;
      return false;
    },
  });
  // What the filters above emptied: a paragraph that held only a pixel.
  return out.replace(/<(p|div|span)>\s*<\/\1>/g, "").trim();
}

function srcset(v: string, base: string): string {
  return v
    // Candidates part at a comma and a space: image CDNs put bare commas
    // inside the address itself ("w_424,c_limit").
    .split(/,\s+/)
    .map((part) => {
      const [u, ...rest] = part.trim().split(/\s+/);
      return [absolute(u, base) || u, ...rest].join(" ");
    })
    .filter((s) => /^https?:/.test(s))
    .join(", ");
}

function hostPath(u: string): string {
  try {
    const x = new URL(u);
    return x.host + x.pathname;
  } catch {
    return "";
  }
}
