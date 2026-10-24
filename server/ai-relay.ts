import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * A local-only relay that keeps AI keys on the server side. The keys come from environment variables (a `.env` file),
 * are attached here to the outgoing request, and are never sent to the browser. It exists only in the dev server
 * (`npm start` / `npm run dev`); a static host such as github.io has no server, so it can't use it.
 *
 * Because it spends the owner's key, it only answers requests that come from the same local page:
 *  - the Host header must be localhost (defeats DNS rebinding),
 *  - an Origin header, if present, must match the Host (defeats other websites calling it),
 *  - POSTs need a custom header, which forces a CORS preflight that other origins can't pass.
 */

export type Env = Record<string, string | undefined>;
export type ProviderId = "openai" | "anthropic" | "azure";
export interface ServerKeys {
  openai: boolean;
  anthropic: boolean;
  azure: boolean;
}

const MAX_BODY = 2_000_000;
const AZURE_HOST = /\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/;
const val = (env: Env, k: string) => env[k]?.trim() ?? "";

function azureBase(env: Env): string | null {
  try {
    const u = new URL(val(env, "AZURE_OPENAI_ENDPOINT"));
    return u.protocol === "https:" && AZURE_HOST.test(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}

/** Which providers have a complete configuration. Booleans only: never the values. */
export function serverKeys(env: Env): ServerKeys {
  return {
    openai: !!val(env, "OPENAI_API_KEY"),
    anthropic: !!val(env, "ANTHROPIC_API_KEY"),
    azure: !!val(env, "AZURE_OPENAI_API_KEY") && !!val(env, "AZURE_OPENAI_DEPLOYMENT") && !!azureBase(env),
  };
}

interface Upstream {
  url: string;
  headers: Record<string, string>;
}

/** The only upstream URLs the relay will call, one per provider. The browser can't choose the destination. */
function upstreamFor(provider: ProviderId, rest: string, env: Env, req: IncomingMessage): Upstream | { status: number; message: string } {
  if (!serverKeys(env)[provider]) return { status: 501, message: `No ${provider} key is configured in .env on this computer.` };
  if (provider === "openai" && rest === "v1/chat/completions")
    return { url: "https://api.openai.com/v1/chat/completions", headers: { authorization: `Bearer ${val(env, "OPENAI_API_KEY")}` } };
  if (provider === "anthropic" && rest === "v1/messages") {
    const headers: Record<string, string> = { "x-api-key": val(env, "ANTHROPIC_API_KEY"), "anthropic-version": String(req.headers["anthropic-version"] ?? "2023-06-01") };
    if (req.headers["anthropic-beta"]) headers["anthropic-beta"] = String(req.headers["anthropic-beta"]);
    return { url: "https://api.anthropic.com/v1/messages", headers };
  }
  if (provider === "azure" && rest === "chat/completions") {
    const version = val(env, "AZURE_OPENAI_API_VERSION") || "2024-10-21";
    return {
      url: `${azureBase(env)}/openai/deployments/${encodeURIComponent(val(env, "AZURE_OPENAI_DEPLOYMENT"))}/chat/completions?api-version=${encodeURIComponent(version)}`,
      headers: { "api-key": val(env, "AZURE_OPENAI_API_KEY") },
    };
  }
  return { status: 404, message: "Unknown relay path." };
}

/** True only for requests that originate from a page served by this local server. */
export function isLocalRequest(req: IncomingMessage): boolean {
  const host = String(req.headers.host ?? "");
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(String(origin)).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Providers echo a masked copy of a bad key in their 401 messages (e.g. "sk-proj-ab************wxyz"). The browser must not
 * see even that much of a key held on the server, so error bodies have the key and any masked-key text removed.
 */
export function redactSecrets(text: string, env: Env): string {
  let out = text;
  for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AZURE_OPENAI_API_KEY"]) {
    const v = val(env, k);
    if (v.length >= 8) out = out.split(v).join("[key hidden]");
  }
  return out.replace(/[A-Za-z0-9_-]*\*{3,}[A-Za-z0-9_-]*/g, "[key hidden]");
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

const fail = (res: ServerResponse, status: number, message: string) => json(res, status, { error: { message } });

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

/** A Connect-style handler to mount at `/api/ai-server`. `fetchImpl` is injectable so tests don't touch the network. */
export function createAiServerHandler(env: Env, fetchImpl: typeof fetch = fetch) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (!isLocalRequest(req)) return fail(res, 403, "This relay only answers requests from the local app.");
    const path = (req.url ?? "/").split("?")[0].replace(/^\/+|\/+$/g, "");

    if (req.method === "GET" && path === "") return json(res, 200, serverKeys(env));
    if (req.method !== "POST") return fail(res, 405, "Method not allowed.");
    if (req.headers["x-system-learn"] !== "1") return fail(res, 403, "Missing app header.");

    const m = path.match(/^(openai|anthropic|azure)\/(.+)$/);
    if (!m) return fail(res, 404, "Unknown relay path.");
    const up = upstreamFor(m[1] as ProviderId, m[2], env, req);
    if ("status" in up) return fail(res, up.status, up.message);

    const body = await readBody(req);
    if (body === null) return fail(res, 413, "Request too large.");

    const ctrl = new AbortController();
    res.on("close", () => ctrl.abort());
    try {
      const upstream = await fetchImpl(up.url, { method: "POST", headers: { "content-type": "application/json", ...up.headers }, body, signal: ctrl.signal });
      res.statusCode = upstream.status;
      res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
      res.setHeader("cache-control", "no-store");
      if (!upstream.body) return void res.end();
      if (upstream.status >= 400) return void res.end(redactSecrets(await upstream.text(), env)); // small JSON error: buffer and clean it
      const reader = upstream.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (e) {
      if (ctrl.signal.aborted) return void res.end();
      if (!res.headersSent) fail(res, 502, `Couldn't reach the AI provider: ${e instanceof Error ? e.message : String(e)}`);
      else res.end();
    }
  };
}
