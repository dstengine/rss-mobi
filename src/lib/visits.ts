// Where a visit came from, from the page that sent the reader here. Only
// the referrer's host is looked at, and only one of four words is kept:
// no address, no path, nothing about the reader.

/** Answer engines and chat assistants that link to their sources. */
const AI = /(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/;

/** Search engines by name, whatever the country domain; the Google app's
    `android-app://com.google.android.googlequicksearchbox` too. */
const SEARCH = /(^|\.)(google|bing|duckduckgo|yandex|yahoo|ecosia|brave|baidu|naver|seznam|qwant|startpage)\./;

export const SOURCES = ["search", "ai", "direct", "other"] as const;
export type Source = (typeof SOURCES)[number];

/** The source of a visit that opened a page on `host` from `referrer`, or
    null when the referrer is the site itself: that is a visit going on, in
    a new tab or after the reader came back. */
export function sourceOf(referrer: string, host: string): Source | null {
  if (!referrer) return "direct";
  let from: string;
  try {
    from = new URL(referrer).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (from === host.toLowerCase()) return null;
  if (AI.test(from)) return "ai";
  return SEARCH.test(from) ? "search" : "other";
}
