import { build } from "../presets";
import type { Lab } from "./types";

const rag = (opts: { vectors?: number; ingest?: number }) =>
  build({
    nodes: [
      ["client", "client"],
      ["api", "server"],
      ["db", "db"],
      ["llm", "llm", { model: "small", replicas: 3, batching: true }],
      ...(opts.vectors ? [["vectors", "vectordb", { replicas: opts.vectors }] as ["vectors", "vectordb", { replicas: number }]] : []),
      ...(opts.ingest
        ? ([
            ["queue", "queue"],
            ["embedders", "worker", { workers: opts.ingest }],
          ] as [string, "queue" | "worker", { workers?: number }?][])
        : []),
    ],
    wires: [
      "client>api, api>db, api>llm",
      opts.vectors ? "api>vectors" : "",
      opts.ingest ? "api>queue, queue>embedders, embedders>db, embedders>vectors" : "",
    ].filter(Boolean).join(", "),
  });

export const aiRagHelpdesk: Lab = {
  slug: "ai-rag-helpdesk",
  module: 27,
  title: "A RAG help centre",
  product: "Customer support",
  summary: "Answer customers from 20,000 help articles. Chunk and retrieve well enough that the answer is actually in the prompt, pick a vector index, and keep embeddings fresh without slowing down answers.",
  difficulty: "medium",
  minutes: 40,
  tags: ["RAG", "embeddings", "HNSW", "hybrid search", "reranking", "ingestion"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A help centre for a SaaS product with **20,000 articles** that change every day. Customers type a question; the app answers in a few sentences with links to the articles it used.

- Peak: **30 questions/s**. The model is a small self-hosted one (3 replicas).
- Articles are edited constantly and fully re-embedded when the embedding model changes.
- The hard part isn't the model. It's getting **the right passage into the prompt**: if retrieval misses, the model answers confidently from nothing.`,
    },
    {
      type: "quiz",
      title: "RAG or fine-tuning?",
      body: "The articles change daily, answers must link to their sources, and some articles are visible only to customers on certain plans.",
      question: "How should the model learn the help centre's content?",
      options: [
        { text: "Fine-tune the model on all the articles every week", why: "Fine-tuning teaches style and format well, but facts go stale between runs, it can't cite sources, and it can't hide plan-specific articles from other customers." },
        { text: "Retrieve relevant passages at question time and put them in the prompt (RAG)", correct: true, why: "Right. Updates show up as soon as they're re-embedded, every answer can cite the chunks it used, and retrieval can filter by what this customer may see." },
        { text: "Put all 20,000 articles in the context window", why: "That's tens of millions of tokens - far past any context window, and paying for it on every question would be absurd." },
      ],
    },
    {
      type: "sim",
      title: "Get the answer into the prompt",
      body: "Today articles are cut into 2,000-token chunks and the top 3 go into the prompt. On a 3,000-question test set, the passage that answers the question is in the prompt only a few percent of the time. A quarter of questions hinge on an exact term (an error code, a plan name).",
      sim: "rag-retrieval",
      locked: ["keywordPct"],
      goals: [
        { metric: "recall", op: ">=", value: 0.9, label: "Recall@k ≥ 90%" },
        { metric: "contextTokens", op: "<=", value: 2500, label: "≤ 2,500 context tokens per question" },
        { metric: "costPer1k", op: "<=", value: 15, label: "≤ $15 per 1,000 questions" },
      ],
      hints: [
        "Huge chunks dilute the embedding; tiny ones lose context. Try a few hundred tokens.",
        "Add some overlap so passages aren't cut in half at chunk boundaries.",
        "Hybrid search catches exact terms; a reranker orders the top 50 far better than raw vector scores. 400 tokens, 20% overlap, k = 5.",
      ],
      solution: { chunkTokens: 400, overlapPct: 20, topK: 5, hybrid: true, reranker: true },
    },
    {
      type: "sim",
      title: "Pick a vector index",
      body: "You serve many customers' help centres from one index: 10 million chunks of 768 dimensions. Brute-force search is perfectly accurate. Is it fast enough?",
      sim: "ann-index",
      locked: ["vectors", "dims"],
      goals: [
        { metric: "recall", op: ">=", value: 0.95, label: "Recall@10 ≥ 95%" },
        { metric: "latencyMs", op: "<=", value: 2, label: "≤ 2 ms per query per core" },
      ],
      hints: ["Exact search reads all 10 million vectors per query.", "Switch to HNSW. Is the default efSearch enough?", "efSearch around 64-128 with M = 16."],
      solution: { mode: "hnsw", efSearch: 100 },
    },
    {
      type: "design",
      title: "Wire up retrieval",
      body: "Today the API server sends questions straight to the model, so it guesses. Add a **vector database**: the server retrieves context, then calls the model. Stay within $5,500/month.",
      starter: rag({}),
      test: {
        traffic: { reads: 30, writes: 3, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "budget", maxUsd: 5500 },
          { type: "uses", kind: "vectordb", why: "answers must be grounded in retrieved articles" },
        ],
      },
      hints: ["Add a vector database from the palette.", "Wire the API server to it: the server queries it before calling the model.", "One replica handles thousands of queries a second."],
      solution: rag({ vectors: 1 }),
    },
    {
      type: "api",
      title: "The help centre API",
      body: "Design three endpoints: ask a question, add or update an article (it gets chunked and embedded in the background), and send feedback on an answer.",
      baseUrl: "https://help.example",
      expect: [
        { goal: "Ask a question", methods: ["POST"], statuses: [200], why: "A question is a POST (like /answers or /questions) with the text in the body; 200 with the answer and its citations. Stream it with SSE for long answers." },
        { goal: "Add or update an article", methods: ["PUT", "POST"], statuses: [202], needsParam: true, why: "PUT /articles/:id with the content. 202 Accepted: chunking and embedding happen asynchronously, and the new text becomes searchable a few seconds later." },
        { goal: "Rate an answer", methods: ["POST"], statuses: [201, 204], needsParam: true, why: "POST /answers/:id/feedback. Thumbs-down answers feed the eval set." },
      ],
    },
    {
      type: "design",
      title: "Re-embed without slowing answers",
      body: "You switch to a better embedding model, so every chunk must be re-embedded: **1,200 upserts/s** for a few hours, while customers keep asking 30 questions/s. Writes must go through a **queue** to **embedding workers** that write to the database and the vector index. Keep at least 99.9% of requests succeeding and the queue from piling up.",
      test: {
        traffic: { reads: 30, writes: 1200, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.999 },
          { type: "backlog", max: 1000 },
          { type: "uses", kind: "queue" },
          { type: "uses", kind: "worker" },
          { type: "budget", maxUsd: 5500 },
        ],
      },
      hints: [
        "API server → queue → workers; wire the workers to the database and to the vector database.",
        "Each worker process embeds about 400 chunks/s - you need enough to keep up.",
        "Index writes are heavy: one vector replica can't absorb 1,200 upserts/s and answer queries. Add a second replica.",
      ],
      solution: rag({ vectors: 2, ingest: 4 }),
    },
    {
      type: "quiz",
      title: "Did the change help?",
      body: "A teammate swaps the reranker for a cheaper one and says answers \"look fine\" after trying ten questions.",
      question: "How should you decide whether to ship it?",
      options: [
        { text: "Trust the ten spot checks", why: "Ten hand-picked questions say almost nothing; regressions hide in the long tail." },
        { text: "Run a fixed eval set: recall@k and MRR for retrieval, groundedness and correctness for answers", correct: true, why: "Right. A golden set of a few hundred real questions with known source passages measures retrieval and answers separately, so you see which half regressed." },
        { text: "Ship it and watch thumbs-down rates", why: "Useful as a signal later, but slow and noisy - and customers pay for every bad answer while you wait." },
      ],
    },
    {
      type: "quiz",
      title: "Who may see what",
      body: "Some articles are only for Enterprise customers. A Free-plan customer asks a question whose best answer is in one of them.",
      question: "Where must the permission check happen?",
      options: [
        { text: "In the prompt: tell the model not to reveal Enterprise content", why: "Prompts are not access control. Anything in the context can leak, and prompt injection makes it easy." },
        { text: "In retrieval: filter chunks by the customer's plan (metadata filter) before they reach the prompt", correct: true, why: "Right. Store permissions as metadata on each chunk and filter in the vector query. What the model never sees, it can't leak." },
        { text: "After generation: scan answers for Enterprise words", why: "Fragile and too late - paraphrases slip through." },
      ],
    },
  ],
};
