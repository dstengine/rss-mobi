// "40 posts", "1 feed": a count with its noun. Pages show it inside
// <span class="nowrap">, so the number and the word never part at a line
// end, while the text keeps a plain space for copying. No imports, so the
// page scripts can use it too.
export const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A feed's pace in words: "about 12 posts a week", "about 2 posts a
    month"; empty for one with nothing lately. */
export function pace(perWeek?: number): string {
  if (!perWeek) return "";
  if (perWeek >= 1) return `about ${counted(Math.round(perWeek), "post")} a week`;
  return `about ${counted(Math.max(1, Math.round((perWeek * 30) / 7)), "post")} a month`;
}

/** Initialisms a topic is written in capitals, and names with their own
    casing. */
const UPPER = new Set(["ai", "api", "ar", "aws", "css", "diy", "eu", "f1", "gpu", "html", "iot", "js", "llm", "nba", "nfl", "nft", "pc", "saas", "seo", "sql", "tv", "uk", "ui", "us", "ux", "vr"]);
const CASED: Record<string, string> = {
  ios: "iOS",
  macos: "macOS",
  javascript: "JavaScript",
  typescript: "TypeScript",
  github: "GitHub",
  youtube: "YouTube",
  wordpress: "WordPress",
  devops: "DevOps",
  php: "PHP",
  // Names that a sentence still capitalises.
  amazon: "Amazon",
  android: "Android",
  anthropic: "Anthropic",
  apple: "Apple",
  google: "Google",
  linux: "Linux",
  microsoft: "Microsoft",
  nvidia: "Nvidia",
  openai: "OpenAI",
  python: "Python",
  windows: "Windows",
};
const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs"]);

/** A topic's slug as a heading names it: "web-development" is "Web
    Development", "llms" is "LLMs", "ios" is "iOS". In a sentence
    (`heading` false) only initialisms and names keep their capitals:
    "web development", "generative AI". */
export function topicName(tag: string, heading = true): string {
  return tag
    .split("-")
    .map((w, i) => {
      if (CASED[w]) return CASED[w];
      if (UPPER.has(w)) return w.toUpperCase();
      if (w.endsWith("s") && UPPER.has(w.slice(0, -1))) return `${w.slice(0, -1).toUpperCase()}s`;
      if (!heading || (i > 0 && SMALL.has(w))) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}
