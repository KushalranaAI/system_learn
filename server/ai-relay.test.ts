import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createAiServerHandler, redactSecrets, serverKeys, type Env } from "./ai-relay";

const KEYS: Env = {
  OPENAI_API_KEY: "sk-env-OPENAI-SECRET",
  ANTHROPIC_API_KEY: "sk-ant-env-SECRET",
  AZURE_OPENAI_API_KEY: "azure-env-SECRET",
  AZURE_OPENAI_ENDPOINT: "https://my-res.openai.azure.com/",
  AZURE_OPENAI_DEPLOYMENT: "gpt-4o-mini",
};

interface Seen { url: string; headers: Record<string, string>; body: string }

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

/** Starts the relay on a real port with a fake upstream; `fake` decides what the "provider" answers. */
async function start(env: Env, fake: (seen: Seen) => Response = () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } })) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const s = { url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) };
    seen.push(s);
    return fake(s);
  }) as unknown as typeof fetch;
  const handler = createAiServerHandler(env, fetchImpl);
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) => fetch(`http://127.0.0.1:${port}${path}`, init);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    call(path, { method: "POST", headers: { "content-type": "application/json", "x-system-learn": "1", ...headers }, body: JSON.stringify(body) });
  return { seen, call, post, port };
}

describe("serverKeys", () => {
  it("reports only booleans, never values", () => {
    const k = serverKeys(KEYS);
    expect(k).toEqual({ openai: true, anthropic: true, azure: true });
    expect(JSON.stringify(k)).not.toMatch(/SECRET|sk-/);
  });
  it("needs every Azure setting, a real Azure host, and ignores blanks", () => {
    expect(serverKeys({ OPENAI_API_KEY: "   " }).openai).toBe(false);
    expect(serverKeys({ ...KEYS, AZURE_OPENAI_DEPLOYMENT: "" }).azure).toBe(false);
    expect(serverKeys({ ...KEYS, AZURE_OPENAI_ENDPOINT: "https://evil.example.com" }).azure).toBe(false);
    expect(serverKeys({ ...KEYS, AZURE_OPENAI_ENDPOINT: "http://my-res.openai.azure.com" }).azure).toBe(false);
  });
});

describe("relay: status", () => {
  it("GET returns which providers are configured, and nothing secret", async () => {
    const { call } = await start(KEYS);
    const text = await (await call("/")).text();
    expect(JSON.parse(text)).toEqual({ openai: true, anthropic: true, azure: true });
    expect(text).not.toMatch(/SECRET|my-res|gpt-4o/);
  });
});

describe("relay: attaches the key on the server", () => {
  it("OpenAI: adds the bearer key and replaces any key the browser sent", async () => {
    const { post, seen } = await start(KEYS);
    const r = await post("/openai/v1/chat/completions", { model: "gpt-4o-mini", messages: [] }, { authorization: "Bearer browser-supplied" });
    expect(r.status).toBe(200);
    expect(seen[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(seen[0].headers.authorization).toBe("Bearer sk-env-OPENAI-SECRET");
    expect(JSON.stringify(seen[0].headers)).not.toContain("browser-supplied");
    expect(JSON.parse(seen[0].body).model).toBe("gpt-4o-mini");
  });

  it("Anthropic: adds x-api-key, forwards the version header", async () => {
    const { post, seen } = await start(KEYS);
    await post("/anthropic/v1/messages", { model: "m" }, { "x-api-key": "managed-by-server", "anthropic-version": "2023-06-01" });
    expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0].headers["x-api-key"]).toBe("sk-ant-env-SECRET");
    expect(seen[0].headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("Azure: builds the URL from .env (the browser can't choose it) and uses the api-key header", async () => {
    const { post, seen } = await start({ ...KEYS, AZURE_OPENAI_API_VERSION: "2025-01-01" });
    await post("/azure/chat/completions", { messages: [] });
    expect(seen[0].url).toBe("https://my-res.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2025-01-01");
    expect(seen[0].headers["api-key"]).toBe("azure-env-SECRET");
  });

  it("the key never appears in what the browser gets back, even from an upstream error", async () => {
    const { post } = await start(KEYS, () => new Response('{"error":{"message":"bad request"}}', { status: 400, headers: { "content-type": "application/json" } }));
    const r = await post("/openai/v1/chat/completions", {});
    expect(r.status).toBe(400);
    const text = await r.text();
    expect(text).not.toContain("SECRET");
    expect([...r.headers.entries()].join()).not.toContain("SECRET");
  });
});

describe("relay: error messages never reveal any part of the key", () => {
  it("redacts a masked key that the provider echoes back", async () => {
    const masked = "Incorrect API key provided: sk-env-O*****************CRET. You can find your API key at https://platform.openai.com.";
    const { post } = await start(KEYS, () => new Response(JSON.stringify({ error: { message: masked } }), { status: 401, headers: { "content-type": "application/json" } }));
    const r = await post("/openai/v1/chat/completions", {});
    expect(r.status).toBe(401);
    const text = await r.text();
    expect(text).not.toMatch(/sk-env-O|CRET|\*{3}/);
    expect(text).toContain("Incorrect API key provided");
    expect(JSON.parse(text).error.message).toContain("[key hidden]");
  });
  it("redacts the full key if a provider echoes it", () => {
    expect(redactSecrets("bad key sk-env-OPENAI-SECRET given", KEYS)).toBe("bad key [key hidden] given");
    expect(redactSecrets("bad azure-env-SECRET", KEYS)).toBe("bad [key hidden]");
  });
  it("leaves ordinary text alone", () => {
    expect(redactSecrets("Rate limit reached for gpt-4o-mini. Try again in 20s", KEYS)).toBe("Rate limit reached for gpt-4o-mini. Try again in 20s");
  });
});

describe("relay: streams", () => {
  it("passes server-sent events through chunk by chunk", async () => {
    const enc = new TextEncoder();
    const { post } = await start(KEYS, () => {
      const body = new ReadableStream({
        async start(c) {
          for (const p of ["data: one\n\n", "data: two\n\n", "data: [DONE]\n\n"]) {
            c.enqueue(enc.encode(p));
            await new Promise((r) => setTimeout(r, 30));
          }
          c.close();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    const r = await post("/openai/v1/chat/completions", { stream: true });
    expect(r.headers.get("content-type")).toBe("text/event-stream");
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    const chunks: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(dec.decode(value));
    }
    expect(chunks.join("")).toBe("data: one\n\ndata: two\n\ndata: [DONE]\n\n");
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("relay: refuses what it shouldn't", () => {
  it("no key configured for that provider -> 501, and nothing is sent upstream", async () => {
    const { post, seen } = await start({ OPENAI_API_KEY: "sk-x" });
    const r = await post("/anthropic/v1/messages", {});
    expect(r.status).toBe(501);
    expect(seen).toHaveLength(0);
  });

  it("only the fixed provider paths are reachable", async () => {
    const { post, seen } = await start(KEYS);
    for (const p of ["/openai/v1/models", "/openai/v1/files", "/anthropic/v1/complete", "/azure/models", "/openai/../etc", "/evil/v1/chat/completions", "/"]) {
      expect((await post(p, {})).status).toBe(404);
    }
    expect(seen).toHaveLength(0);
  });

  it("needs the app header, so a plain cross-site form/simple request can't spend the key", async () => {
    const { call, seen } = await start(KEYS);
    const r = await call("/openai/v1/chat/completions", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect(r.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it("rejects requests from another website (Origin) and DNS-rebinding (Host)", async () => {
    const { post, call, seen, port } = await start(KEYS);
    expect((await post("/openai/v1/chat/completions", {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("/openai/v1/chat/completions", {}, { origin: `http://127.0.0.1:${port}` })).status).toBe(200);
    expect((await call("/", { headers: { origin: "https://evil.example" } })).status).toBe(403);
    // a different Host header (what DNS rebinding looks like) via a raw request
    const raw = await new Promise<string>((resolve) => {
      import("node:http").then(({ request }) => {
        const q = request({ host: "127.0.0.1", port, path: "/", headers: { host: "attacker.example" } }, (res) => resolve(String(res.statusCode)));
        q.end();
      });
    });
    expect(raw).toBe("403");
    expect(seen).toHaveLength(1);
  });

  it("rejects oversized bodies", async () => {
    const { post, seen } = await start(KEYS);
    const r = await post("/openai/v1/chat/completions", { big: "x".repeat(2_100_000) }).catch(() => null);
    expect(r === null || r.status === 413).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it("reports a provider outage as 502 without leaking the key", async () => {
    const { post } = await start(KEYS, () => {
      throw new Error("connect ECONNREFUSED");
    });
    const r = await post("/openai/v1/chat/completions", {});
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain("SECRET");
  });
});
