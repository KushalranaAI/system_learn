import { build } from "../presets";
import type { Lab } from "./types";

const chat = (llm: { replicas: number; batching: boolean }, cacheHit?: number) =>
  build({
    nodes: [
      ["client", "client"],
      ["api", "server"],
      ["db", "db"],
      ["llm", "llm", { model: "small", ...llm }],
      ...(cacheHit !== undefined ? [["cache", "cache", { hitRatio: cacheHit }] as ["cache", "cache", { hitRatio: number }]] : []),
    ],
    wires: `client>api, api>db, api>llm${cacheHit !== undefined ? ", api>cache" : ""}`,
  });

export const aiLlmServing: Lab = {
  slug: "ai-llm-serving",
  module: 26,
  title: "Serve an LLM chat app",
  product: "AI chat",
  summary: "Self-host an 8B chat model for a support chat. Batch requests on the GPU, fit the KV cache, add a semantic cache, survive losing it, and route easy prompts to a cheaper model.",
  difficulty: "medium",
  minutes: 40,
  tags: ["GPUs", "continuous batching", "KV cache", "semantic cache", "model routing"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A support chat for a bank's app. Customers ask questions; an **8B open-weight model** you host yourself answers.

- Launch: **16 chats/s** at peak. After the marketing push: **60 chats/s**.
- A typical turn: ~1,000 prompt tokens (instructions, history, the question) and ~300 output tokens.
- One model replica is one GPU (~$1,500/month). They're the expensive part: everything else is a rounding error.
- Answers stream token by token, so users care about two numbers: **time to first token** and **tokens per second** after that.

On the canvas, an **LLM inference** node is a pool of model replicas. Its latency is time to first token.`,
    },
    {
      type: "quiz",
      title: "Where the time goes",
      body: "A request has two phases. **Prefill** reads the whole prompt in one parallel pass. **Decode** then produces the answer one token at a time; every token needs a full pass over the model's weights.",
      question: "Why does a GPU serving one user at a time waste most of its power?",
      options: [
        { text: "Decoding is limited by memory bandwidth: each step reads every weight to produce one token", correct: true, why: "Right. An 8B model reads ~16 GB of weights per step. Doing that for one sequence or for 64 costs almost the same, so batching many sequences into each step multiplies throughput." },
        { text: "Prefill is slow, so the GPU waits for the prompt", why: "Prefill is compute-bound and fast (tens of milliseconds for 1,000 tokens on an 8B model). The waste is in decode." },
        { text: "The network between users and the GPU is the bottleneck", why: "A few hundred tokens per second is a tiny amount of network traffic." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: batch size",
      body: "One H100 serving the 8B model. Today it decodes one sequence at a time. Find a batch size that gives the replica real throughput while each user still sees a fast stream.",
      sim: "llm-batching",
      locked: ["model", "gpus", "promptTokens", "outputTokens", "gpuHourUsd"],
      goals: [
        { metric: "tokensPerSec", op: ">=", value: 2000, label: "Replica throughput ≥ 2,000 tokens/s" },
        { metric: "userTps", op: ">=", value: 30, label: "Each user sees ≥ 30 tokens/s" },
        { metric: "costPerM", op: "<=", value: 0.5, label: "GPU cost ≤ $0.50 per 1M output tokens" },
      ],
      hints: ["Slide the batch size up and watch both charts.", "Throughput keeps growing with batch size, but per-user speed falls.", "Somewhere between 16 and 128 meets all three."],
      solution: { batch: 32 },
    },
    {
      type: "design",
      title: "Launch day: turn on batching",
      body: "Two replicas of the small model, with batching **off**. At 16 chats/s most requests fail. Fix it without adding GPUs.",
      starter: chat({ replicas: 2, batching: false }),
      test: {
        traffic: { reads: 16, writes: 2, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 1500 },
          { type: "budget", maxUsd: 3500, why: "two GPUs is all the budget allows" },
        ],
      },
      hints: ["Select the LLM node and look at its settings.", "Without batching a replica decodes one or two sequences at a time.", "Turn on continuous batching."],
      solution: chat({ replicas: 2, batching: true }),
    },
    {
      type: "sim",
      title: "Will it fit? GPU memory",
      body: "The team wants a 70B model for harder questions, on 4 × 80 GB GPUs with a 32k-token context, serving 64 conversations at once. Each running conversation keeps a **KV cache** in GPU memory. Make 64 fit without buying more GPUs or shrinking the context.",
      sim: "kv-cache",
      locked: ["model", "gpus", "gpuMemGB", "contextTokens", "targetSeqs", "avgFillPct"],
      goals: [{ metric: "fits", op: ">=", value: 1, label: "64 concurrent sequences fit" }],
      hints: [
        "Look at the bars: how much reserved KV memory is never used?",
        "Contiguous allocation reserves the full 32k tokens for every chat. PagedAttention allocates 16-token blocks as the chat grows.",
        "Paged allocation alone gets you most of the way; FP8 KV cache halves the rest.",
      ],
      solution: { allocation: "paged", kvBits: 8 },
    },
    {
      type: "design",
      title: "60 chats/s on a $6,500 budget",
      body: "The marketing push quadruples traffic to 60 chats/s. Finance caps the bill at $6,500/month: not enough GPUs to answer everything with the model. About 40% of questions repeat something already asked (\"how do I reset my PIN?\"). Answer those from a **semantic cache**.",
      test: {
        traffic: { reads: 60, writes: 6, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 1500 },
          { type: "budget", maxUsd: 6500 },
          { type: "uses", kind: "cache", why: "repeated questions should never reach a GPU" },
        ],
      },
      hints: [
        "Six replicas would handle it, but cost $9,000.",
        "Add a cache wired from the API server: on the canvas, it acts as the semantic cache in front of the model.",
        "Set its hit ratio to about 0.4 and run four replicas.",
      ],
      solution: chat({ replicas: 4, batching: true }, 0.4),
    },
    {
      type: "sim",
      title: "Pick the similarity threshold",
      body: "The semantic cache answers a question with a cached answer when the two embeddings are close enough. Too loose, and \"cancel my card\" gets the answer to \"cancel my direct debit\". Pick a threshold.",
      sim: "semantic-cache",
      locked: ["repeatPct", "nearMissSpread", "llmMs", "llmCostCents"],
      goals: [
        { metric: "wrongRate", op: "<=", value: 0.01, label: "Wrong cached answers ≤ 1%" },
        { metric: "hitRate", op: ">=", value: 0.3, label: "Hit rate ≥ 30%" },
      ],
      hints: ["Watch the red line on the chart as you move the threshold.", "Every hit above the real 40% repeat rate is a wrong answer.", "Somewhere around 0.91-0.93."],
      solution: { threshold: 0.92 },
    },
    {
      type: "design",
      title: "Lose the cache",
      body: "At t=10s the cache node dies and every question goes to the model. Keep 99% of chats succeeding every second. Finance agrees to $9,500/month for this.",
      test: {
        traffic: { reads: 60, writes: 6, bots: 0 },
        incident: { type: "killKind", kind: "cache" },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "budget", maxUsd: 9500 },
        ],
      },
      hints: [
        "With the cache gone, the replicas must carry all 60 chats/s.",
        "Each small replica handles about 12 chats/s with batching.",
        "Run six replicas (the cache still saves money on normal days).",
      ],
      solution: chat({ replicas: 6, batching: true }, 0.4),
    },
    {
      type: "sim",
      title: "Route easy prompts to a small model",
      body: "For the harder questions you also call a frontier model through an API. Most prompts are easy. Send everything to a small model first and escalate only when it isn't confident. Cut the bill by more than half without losing quality.",
      sim: "model-cascade",
      locked: ["hardPct", "smallCost", "largeCost", "smallMs", "largeMs"],
      goals: [
        { metric: "quality", op: ">=", value: 0.94, label: "Correct answers ≥ 94%" },
        { metric: "costVsLarge", op: "<=", value: 0.5, label: "Cost ≤ 50% of large-only" },
        { metric: "avgLatencyMs", op: "<=", value: 1500, label: "Average latency ≤ 1.5 s" },
      ],
      hints: ["Small-only is cheap but wrong too often. Try the cascade.", "A higher threshold escalates more: better quality, higher cost.", "Around 0.75-0.8."],
      solution: { mode: "cascade", threshold: 0.8 },
    },
  ],
};
