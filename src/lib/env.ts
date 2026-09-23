// Runtime configuration. Read from process.env on every call rather than at
// import, so a missing value fails the request that needs it — with its own
// name in the message — instead of the whole deploy.

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function need(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const SITE = "https://rss.mobi";
