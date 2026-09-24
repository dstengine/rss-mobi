// Fetching someone else's URL on a stranger's say-so.
//
// Submission takes a URL from anyone and fetches it from our servers, which
// makes this the one place an outsider can point our infrastructure at
// something. So every hop is checked: http(s) only, default ports only, and
// a host that resolves to a private, loopback or link-local address is
// refused — including after a redirect, which is how that check is usually
// walked around. Redirects are followed by hand for exactly that reason.
//
// The shape follows `get()` in tools/events-scan.mjs of dstengine/dst (a
// pause per host, a user agent that says who we are, a timeout), plus the
// conditional GET a poller needs so an unchanged feed costs a 304.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const UA = "rss.mobi/1.0 (+https://rss.mobi/about/)";
const TIMEOUT = 10_000;
const MAX_BYTES = 5_000_000;
const MAX_REDIRECTS = 5;
const HOST_PAUSE = 1_000;

export class FetchError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export interface Fetched {
  status: number;
  url: string;
  body: string;
  type: string;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
}

export interface GetOptions {
  etag?: string;
  lastModified?: string;
  accept?: string;
  timeout?: number;
  /** Followers the readers fetching our copy report, passed on the way
      Feedly and Inoreader pass theirs: "; 16 subscribers" in the agent. */
  subscribers?: number;
  /** Tests resolve names themselves; production never passes this. */
  resolve?: (host: string) => Promise<string[]>;
}

const lastHit = new Map<string, number>();

export async function get(url: string, opts: GetOptions = {}): Promise<Fetched> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublic(current, opts.resolve);
    await pause(u.host);
    const headers: Record<string, string> = {
      "User-Agent": opts.subscribers ? UA.replace(/\)$/, `; ${opts.subscribers} subscribers)`) : UA,
      Accept:
        opts.accept ??
        "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5",
    };
    if (opts.etag) headers["If-None-Match"] = opts.etag;
    if (opts.lastModified) headers["If-Modified-Since"] = opts.lastModified;

    let res: Response;
    try {
      res = await fetch(u, { headers, redirect: "manual", signal: AbortSignal.timeout(opts.timeout ?? TIMEOUT) });
    } catch (e) {
      throw new FetchError(`fetch failed: ${(e as Error).message}`);
    }

    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const loc = res.headers.get("location");
      if (!loc) throw new FetchError(`HTTP ${res.status} without Location`, res.status);
      current = new URL(loc, u).toString();
      continue;
    }

    const common = {
      status: res.status,
      url: u.toString(),
      type: res.headers.get("content-type") ?? "",
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
    };
    if (res.status === 304) return { ...common, body: "", notModified: true };
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`, res.status);
    return { ...common, body: decode(await readCapped(res), common.type), notModified: false };
  }
  throw new FetchError("too many redirects");
}

async function readCapped(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new FetchError(`body over ${MAX_BYTES} bytes`);
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new FetchError(`body over ${MAX_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Bytes to text in the charset the server or the document declares.
    Plenty of feeds are still windows-1251 or iso-8859-1, and decoding them
    as UTF-8 turns every title into replacement characters. */
export function decode(bytes: Uint8Array, contentType = ""): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  const declared =
    contentType.match(/charset=["']?([\w-]+)/i)?.[1] ??
    head.match(/<\?xml[^>]*encoding=["']([\w-]+)["']/i)?.[1] ??
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(declared.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function pause(host: string) {
  const wait = (lastHit.get(host) ?? 0) + HOST_PAUSE - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

/** The URL, parsed, if it is safe for us to fetch; throws otherwise. */
export async function assertPublic(
  url: string,
  resolve: (host: string) => Promise<string[]> = async (h) =>
    (await lookup(h, { all: true })).map((a) => a.address),
): Promise<URL> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new FetchError("not a URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new FetchError("only http and https");
  if (u.username || u.password) throw new FetchError("credentials in URL");
  if (u.port && u.port !== "80" && u.port !== "443") throw new FetchError("non-standard port");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new FetchError("private host");
  }
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    throw new FetchError("host does not resolve");
  }
  if (!addresses.length || addresses.some(isPrivate)) throw new FetchError("private address");
  return u;
}

export function isPrivate(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
    if (/^fe[89ab]/.test(v)) return true; // link-local
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivate(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}
