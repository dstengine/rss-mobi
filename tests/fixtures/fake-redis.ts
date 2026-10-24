// An Upstash REST stand-in for tests. It answers the commands cache.ts
// sends the way Redis would — SET with NX and EX, DEL, GET, INCRBY, EXPIRE,
// PING and the limiter's sliding-window script — and keeps every command
// it was sent, so a test can say what an operation costs in commands,
// which is what Upstash counts against the plan's 500 000 a month.
// Install it before cache.ts is first imported: redis() reads its
// configuration once.
export interface FakeRedis {
  /** Every command sent so far, as the client sent it. */
  sent: string[][];
  /** The names of the commands sent since the last call. */
  take(): string[];
  /** Puts the real fetch back. */
  restore(): void;
}

const BASE = "https://redis.test.invalid";

export function installFakeRedis(): FakeRedis {
  process.env.KV_REST_API_URL = BASE;
  process.env.KV_REST_API_TOKEN = "test-token";
  const store = new Map<string, { v: string; exp: number }>();
  const sent: string[][] = [];
  let taken = 0;
  const realFetch = globalThis.fetch;

  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  const read = (k: string): string | null => {
    const e = store.get(k);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      store.delete(k);
      return null;
    }
    return e.v;
  };
  /** `exp` is absolute milliseconds, 0 for no expiry. */
  const write = (k: string, v: string, exp: number) => store.set(k, { v, exp });

  /** @upstash/ratelimit's single-region sliding window, as its Lua reads:
      KEYS the current and previous bucket, ARGV tokens, now, window and
      the increment. Returns [remaining, limit]; remaining -1 is a refusal. */
  const slidingWindow = (a: string[]): [number, number] => {
    const n = Number(a[0]);
    const [currentKey, previousKey] = a.slice(1, 1 + n);
    const [tokens, now, window, incrementBy] = a.slice(1 + n).map(Number);
    const current = Number(read(currentKey) ?? 0);
    const previous = Math.floor((1 - (now % window) / window) * Number(read(previousKey) ?? 0));
    if (incrementBy > 0 && previous + current >= tokens) return [-1, tokens];
    const value = current + incrementBy;
    write(currentKey, String(value), value === incrementBy ? Date.now() + window * 2 + 1000 : (store.get(currentKey)?.exp ?? 0));
    return [tokens - (value + previous), tokens];
  };

  function run(cmd: unknown[]): { result: unknown } | { error: string } {
    const [name, ...a] = cmd.map(String);
    switch (name.toLowerCase()) {
      case "ping":
        return { result: b64("PONG") };
      case "get": {
        const v = read(a[0]);
        return { result: v === null ? null : b64(v) };
      }
      case "set": {
        const [key, value, ...opts] = a;
        const o = opts.map((s) => s.toLowerCase());
        if (o.includes("nx") && read(key) !== null) return { result: null };
        const ex = o.indexOf("ex");
        write(key, value, ex >= 0 ? Date.now() + Number(o[ex + 1]) * 1000 : 0);
        return { result: "OK" };
      }
      case "del": {
        let n = 0;
        for (const k of a) if (store.delete(k)) n++;
        return { result: n };
      }
      case "incrby": {
        const n = Number(read(a[0]) ?? 0) + Number(a[1]);
        write(a[0], String(n), store.get(a[0])?.exp ?? 0);
        return { result: n };
      }
      case "expire": {
        const e = store.get(a[0]);
        if (!e) return { result: 0 };
        e.exp = Date.now() + Number(a[1]) * 1000;
        return { result: 1 };
      }
      case "evalsha":
      case "eval":
        // [sha or script, number of keys, ...keys, ...args]
        return { result: slidingWindow(a.slice(1)) };
      default:
        return { error: `ERR the fake Redis does not answer ${name}` };
    }
  }

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(BASE)) return realFetch(input, init);
    const body = JSON.parse(String(init?.body ?? "[]"));
    // One command is posted to the base URL; a pipeline (the client's
    // default) to /pipeline, as an array of commands answered by an array.
    const batch = /\/(pipeline|multi-exec)$/.test(url);
    const cmds: unknown[][] = batch ? body : [body];
    sent.push(...cmds.map((c) => c.map(String)));
    const answers = cmds.map(run);
    return new Response(JSON.stringify(batch ? answers : answers[0]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return {
    sent,
    take() {
      const names = sent.slice(taken).map((c) => c[0].toLowerCase());
      taken = sent.length;
      return names;
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}
