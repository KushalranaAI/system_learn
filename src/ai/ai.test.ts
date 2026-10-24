import { afterEach, describe, expect, it, vi } from "vitest";
import { askAi } from "./client";
import type { AiSettings } from "./settings";

const guide = { headline: "API server is overloaded", whatHappened: ["It gets 9k req/s but handles 5k."], problems: [{ problem: "Overloaded server", why: "Too small", fix: "Upgrade to 8 vCPU", tradeoff: "Costs more" }], nextStep: "Add a cache." };

const base: AiSettings = { provider: "none", apiKey: "test-key", model: "", azureEndpoint: "", azureDeployment: "", azureApiVersion: "2024-10-21", remember: false };

function mockFetch(responder: (url: string, init: RequestInit) => unknown) {
  const calls: { url: string; init: RequestInit; headers: Headers; body: string }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(input instanceof Request ? input.headers : (init.headers as HeadersInit));
    const body = typeof init.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
    calls.push({ url, init, headers, body });
    if (url.startsWith("./")) throw new TypeError("no dev server in tests");
    return new Response(JSON.stringify(responder(url, init)), { status: 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("AI providers", () => {
  it("OpenAI: sends a bearer key and JSON mode, parses the guide", async () => {
    const calls = mockFetch(() => ({ choices: [{ message: { content: JSON.stringify(guide) } }] }));
    const g = await askAi({ ...base, provider: "openai", model: "gpt-4o-mini" }, "explain", { x: 1 });
    expect(g.headline).toBe(guide.headline);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
    expect(JSON.parse(calls[0].init.body as string).response_format).toEqual({ type: "json_object" });
  });

  it("Azure OpenAI: builds the deployment URL with api-version and an api-key header", async () => {
    const calls = mockFetch(() => ({ choices: [{ message: { content: "Here you go: " + JSON.stringify(guide) } }] }));
    const g = await askAi({ ...base, provider: "azure", azureEndpoint: "https://my-res.openai.azure.com/", azureDeployment: "gpt4o" }, "explain", {});
    expect(g.problems[0].fix).toBe("Upgrade to 8 vCPU");
    const direct = calls.find((c) => c.url.startsWith("https://"))!;
    expect(direct.url).toBe("https://my-res.openai.azure.com/openai/deployments/gpt4o/chat/completions?api-version=2024-10-21");
    expect((direct.init.headers as Record<string, string>)["api-key"]).toBe("test-key");
  });

  it("Anthropic: calls the Messages API with the key and parses structured output", async () => {
    const calls = mockFetch(() => ({
      id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(guide) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }));
    const g = await askAi({ ...base, provider: "anthropic" }, "explain", {});
    expect(g.nextStep).toBe("Add a cache.");
    expect(calls[0].url).toContain("api.anthropic.com/v1/messages");
    // the SDK carries the key itself (x-api-key or bearer, depending on SDK version)
    expect(calls[0].headers.get("x-api-key") ?? calls[0].headers.get("authorization")).toMatch(/test-key/);
    expect(calls[0].headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    const body = JSON.parse(calls[0].body);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config.format.type).toBe("json_schema");
  });

  it("reports a provider error message", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 }));
    await expect(askAi({ ...base, provider: "openai" }, "explain", {})).rejects.toThrow(/401: Incorrect API key/);
  });
});
