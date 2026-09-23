// Outbound notices: Telegram alerts to us, IndexNow pings to search engines.
import { env, SITE } from "./env.ts";

/** A line to the alerts chat. sendMessage only — no webhook is ever set on
    this bot, so it cannot interfere with anything else that reads it. Never
    throws: an alert that fails must not fail the job that raised it. */
export async function alert(text: string): Promise<void> {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chat = env("TELEGRAM_CHAT_ID");
  if (!token || !chat) {
    console.warn("alert (no Telegram configured):", text);
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: `rss.mobi: ${text}`.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.error("alert failed", e);
  }
}

/** Tells Bing, Yandex, Seznam and Naver that these rss.mobi URLs changed.
    Google does not take IndexNow; it reads the sitemap. */
export async function indexNow(paths: string[]): Promise<number | null> {
  const key = env("INDEXNOW_KEY");
  if (!key || !paths.length) return null;
  const urlList = [...new Set(paths.map((p) => new URL(p, SITE).toString()))].slice(0, 10_000);
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation: `${SITE}/${key}.txt`, urlList }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.status;
  } catch (e) {
    console.error("IndexNow failed", e);
    return null;
  }
}
