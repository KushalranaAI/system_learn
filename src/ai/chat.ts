import Anthropic from "@anthropic-ai/sdk";
import { postCompletion, providerError } from "./client";
import { DEFAULT_MODELS, type AiSettings } from "./settings";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM = `You are the tutor built into "System Learn", an interactive system design simulator and course (lessons, labs, a sandbox canvas, and focused simulations).
The learner is looking at one screen. Everything you can see about it is in the "Screen context" JSON below - their design, traffic, settings, results, the lesson text or lab step they have open.

How to answer:
- Answer the question they ask, using the screen context. Quote their real numbers and component names; never invent measurements.
- If the context doesn't contain what you need, say so plainly and tell them where in the app to find it or what to change.
- Teach, don't just fix: say why, give the concrete change to make in the app, and name the trade-off.
- In a lab, guide with hints and reasoning. Don't hand over the full answer unless they explicitly ask for it.
- Be brief: a short paragraph or a few bullets. Define a term the first time you use it. Markdown is fine (bold, lists, small code spans).
- If the question is unrelated to system design or this app, answer in one sentence and steer back.`;

const MAX_CONTEXT_CHARS = 28000;

/** The screen context as compact JSON, trimmed so one question never gets very large. */
function contextText(context: unknown): string {
  const json = JSON.stringify(context ?? {});
  return json.length > MAX_CONTEXT_CHARS ? json.slice(0, MAX_CONTEXT_CHARS) + ' ...(truncated)"}' : json;
}

/** Read an OpenAI-style server-sent-event stream, calling onDelta with each piece of text. */
async function streamOpenAi(headers: Record<string, string>, body: object, onDelta: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok || !res.body) throw providerError(res.status, await res.text());
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const piece = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (piece) {
          full += piece;
          onDelta(piece);
        }
      } catch {
        /* partial JSON line - ignore */
      }
    }
  }
  return full;
}

/**
 * Ask the configured provider a free-form question. `context` is what is on the learner's screen right now; it is
 * rebuilt for every question and never includes the API key. Text is streamed through `onDelta` where the provider allows.
 */
export async function chatAi(s: AiSettings, history: ChatMsg[], context: unknown, onDelta: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const system = `${SYSTEM}\n\nScreen context (JSON):\n${contextText(context)}`;
  if (s.provider === "anthropic") {
    const client = new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
    const stream = client.messages.stream(
      { model: s.model || DEFAULT_MODELS.anthropic, max_tokens: 2048, system, messages: history },
      { signal },
    );
    stream.on("text", onDelta);
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") throw new Error("The model declined to answer this one.");
    return final.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }
  const messages = [{ role: "system", content: system }, ...history];
  if (s.provider === "openai") {
    const body = { model: s.model || DEFAULT_MODELS.openai, messages };
    const headers = { authorization: `Bearer ${s.apiKey}` };
    try {
      return await streamOpenAi(headers, body, onDelta, signal);
    } catch (e) {
      if (!(e instanceof TypeError) || signal?.aborted) throw e;
      const text = await postCompletion("https://api.openai.com/v1/chat/completions", headers, body, true, signal); // network/CORS → local relay
      onDelta(text);
      return text;
    }
  }
  if (s.provider === "azure") {
    const base = s.azureEndpoint.trim().replace(/\/+$/, "");
    const url = `${base}/openai/deployments/${encodeURIComponent(s.azureDeployment.trim())}/chat/completions?api-version=${encodeURIComponent(s.azureApiVersion || "2024-10-21")}`;
    const text = await postCompletion(url, { "api-key": s.apiKey }, { messages }, true, signal);
    onDelta(text);
    return text;
  }
  throw new Error("No AI provider is configured.");
}
