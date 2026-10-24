import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DEFAULT_MODELS, type AiSettings } from "./settings";

/** The shape every AI explanation comes back in, so the UI can render it like the built-in guide. */
export const AiGuideSchema = z.object({
  headline: z.string().describe("One sentence verdict a learner understands at a glance."),
  whatHappened: z.array(z.string()).describe("2-5 short sentences: what the simulation shows and why, using its numbers."),
  problems: z
    .array(
      z.object({
        problem: z.string(),
        why: z.string(),
        fix: z.string().describe("A concrete change to make in the simulator."),
        tradeoff: z.string().describe("What the fix costs or gives up."),
      }),
    )
    .describe("The most important problems first, at most 3. Empty if everything is healthy."),
  nextStep: z.string().describe("One suggestion for what to try next to learn more."),
});

export type AiGuide = z.infer<typeof AiGuideSchema>;

const SYSTEM = `You are a friendly, precise system design tutor inside "System Learn", an interactive simulator.
A learner builds an architecture (or tunes a simulation), runs it, and asks you to explain the result.

Rules:
- Use only the numbers and facts in the provided context; never invent measurements.
- Explain in plain language for someone learning system design; define a term the first time you use it.
- Be concrete: name components exactly as they appear, and say which setting to change in the simulator.
- Every fix must come with an honest trade-off.
- Keep each sentence short. No markdown, no headings.
- Return JSON only, matching this shape:
  {"headline": string, "whatHappened": string[], "problems": [{"problem": string, "why": string, "fix": string, "tradeoff": string}], "nextStep": string}`;

function userPrompt(task: string, context: unknown): string {
  return `${task}\n\nContext (JSON from the simulator):\n${JSON.stringify(context, null, 1)}`;
}

function parseJsonGuide(text: string): AiGuide {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const raw = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  const parsed = AiGuideSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("The AI's answer didn't have the expected shape.");
  return parsed.data;
}

/** OpenAI and Azure OpenAI share the chat-completions shape. */
async function chatCompletions(url: string, headers: Record<string, string>, body: object, viaProxy: boolean, signal?: AbortSignal): Promise<AiGuide> {
  const init: RequestInit = viaProxy
    ? { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ url, headers, body }) }
    : { method: "POST", signal, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
  const res = await fetch(viaProxy ? "./api/ai-proxy" : url, init);
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text)?.error?.message ?? text;
    } catch {
      /* not JSON */
    }
    throw new Error(`${res.status}: ${msg.slice(0, 300)}`);
  }
  const json = JSON.parse(text);
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("The AI returned an empty answer.");
  return parseJsonGuide(content);
}

/**
 * Ask the configured provider to explain a simulator result. The key is sent only to that provider
 * (directly from the browser, or for Azure through this app's own local dev server to get around CORS).
 */
export async function askAi(s: AiSettings, task: string, context: unknown, signal?: AbortSignal): Promise<AiGuide> {
  const prompt = userPrompt(task, context);
  if (s.provider === "anthropic") {
    const client = new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
    const response = await client.messages.parse(
      {
        model: s.model || DEFAULT_MODELS.anthropic,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
        output_config: { effort: "low", format: zodOutputFormat(AiGuideSchema) },
      },
      { signal },
    );
    if (response.stop_reason === "refusal") throw new Error("The model declined to answer this one.");
    if (!response.parsed_output) throw new Error("The AI's answer didn't have the expected shape.");
    return response.parsed_output;
  }
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: prompt },
  ];
  if (s.provider === "openai") {
    const body = { model: s.model || DEFAULT_MODELS.openai, messages, response_format: { type: "json_object" } };
    const headers = { authorization: `Bearer ${s.apiKey}` };
    try {
      return await chatCompletions("https://api.openai.com/v1/chat/completions", headers, body, false, signal);
    } catch (e) {
      if (e instanceof TypeError) return chatCompletions("https://api.openai.com/v1/chat/completions", headers, body, true, signal); // network/CORS → local proxy
      throw e;
    }
  }
  if (s.provider === "azure") {
    const base = s.azureEndpoint.trim().replace(/\/+$/, "");
    const url = `${base}/openai/deployments/${encodeURIComponent(s.azureDeployment.trim())}/chat/completions?api-version=${encodeURIComponent(s.azureApiVersion || "2024-10-21")}`;
    const body = { messages, response_format: { type: "json_object" } };
    const headers = { "api-key": s.apiKey };
    try {
      return await chatCompletions(url, headers, body, true, signal);
    } catch (e) {
      if (e instanceof TypeError) return chatCompletions(url, headers, body, false, signal); // no dev server (static build) → try direct
      throw e;
    }
  }
  throw new Error("No AI provider is configured.");
}

/** A short round trip to confirm the key, model and endpoint work. */
export async function testConnection(s: AiSettings): Promise<string> {
  const g = await askAi(s, "This is a connection test. Reply with headline 'Connected', one whatHappened item, no problems, and a nextStep.", { test: true });
  return g.headline;
}
