import { build, type Preset } from "../presets";

/** LLM serving, retrieval and agents under real load. One read = one chat turn, question or task. */
export const AI_SCENARIOS: Preset[] = [
  {
    id: "ai-chat-serving",
    title: "Chat serving on GPUs",
    source: "AI systems",
    blurb: "A chat product on a 70B model with 8 replicas and a semantic cache. Launch day traffic doesn't fit.",
    lesson: "37.1",
    story: `A chat assistant like ChatGPT is mostly a GPU capacity problem.

**Key numbers:**
- One replica of a 70B model needs about 4 GPUs. With continuous batching it serves only a handful of chat turns per second (500 output tokens each) - here 5/s per replica.
- Turning batching off cuts throughput to a fraction: the GPU decodes one or two sequences at a time.
- A **semantic cache** answers prompts that mean the same as a recent one ("what's the capital of France?") without a model call. Real hit ratios are modest, and a loose similarity threshold returns wrong answers.

**On the canvas:** reads are chat turns (60/s), writes save conversations. The API servers check the semantic cache (20% hits), then call the model: 8 medium replicas = 40 turns/s. Turns that don't fit are dropped - in a real product they'd be queued with a "we're at capacity" message.`,
    tryThis: [
      "How many replicas does the model need for 60 turns/s with headroom?",
      "Switch the model to small: what happens to capacity, cost and latency?",
      "Turn batching off. Why does throughput collapse?",
      "Raise the semantic cache hit ratio to 0.4. What would that cost in wrong answers?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "m" }],
        ["api2", "server", { size: "m" }],
        ["semcache", "cache", { hitRatio: 0.2 }],
        ["llm", "llm", { model: "medium", replicas: 8, batching: true }],
        ["db", "db", { size: "s" }],
      ],
      wires: "client>lb, lb>api1, lb>api2, api1>semcache, api2>semcache, api1>llm, api2>llm, api1>db, api2>db",
    }),
    traffic: { reads: 60, writes: 60, bots: 0 },
  },
  {
    id: "ai-rag-helpdesk",
    title: "RAG help desk",
    source: "AI systems",
    blurb: "Questions retrieve help articles from a vector index before the model answers. Ingestion can't keep up with edits.",
    lesson: "34.4",
    story: `A help-centre assistant answers questions from your own articles with **retrieval-augmented generation**:

1. Embed the question and find the nearest article chunks in a **vector database**.
2. Put those chunks in the prompt and ask the model to answer with citations.

**Ingestion** keeps the index fresh: when an article changes, workers split it into chunks (a few hundred tokens with some overlap), embed each chunk and upsert it. If ingestion falls behind, the assistant answers from old articles.

**On the canvas:** reads are questions (30/s); 30% are answered from the cache. The rest query the vector index, then a small model with 2 replicas (24 answers/s). Writes are chunks to re-embed (1,200/s after a big docs migration); they go through a queue to 2 ingestion workers (800/s) that upsert into the vector index and record metadata in the database.`,
    tryThis: [
      "Watch the ingestion backlog. Add workers until it drains.",
      "Now the vector index is the limit: add index replicas.",
      "The model runs at 88%. Add a replica, or raise the cache hit ratio?",
      "Kill the vector database: what does the assistant do with no context?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["api", "server", { size: "s" }],
        ["cache", "cache", { hitRatio: 0.3 }],
        ["vectors", "vectordb", { replicas: 1 }],
        ["llm", "llm", { model: "small", replicas: 2 }],
        ["db", "db", { size: "s" }],
        ["q", "queue"],
        ["ingest", "worker", { workers: 2 }],
      ],
      wires: "client>api, api>cache, api>vectors, api>llm, api>db, api>q, q>ingest, ingest>vectors, ingest>db",
    }),
    traffic: { reads: 30, writes: 1_200, bots: 0 },
  },
  {
    id: "ai-support-agent",
    title: "Customer support agent",
    source: "AI systems",
    blurb: "An agent looks up orders and help articles in a loop. No step limit, so a few confused tasks burn the GPUs.",
    lesson: "37.4",
    story: `A support agent doesn't just answer: it acts. Each task is a loop - the model thinks, calls a tool (look up the order, search help articles, issue a refund), reads the result, and repeats until done or it hands off to a human.

**Why it's expensive:** every step is a model call. A 5-step task costs 5 model calls and 5x the latency. A few percent of tasks get confused and loop - without a **step limit** they can run 30 steps, and those few tasks eat a large share of the GPUs.

**Reliability compounds:** if each step is right 95% of the time, a 5-step task is right only about 77% of the time. Fewer steps, checks between steps and escalation to humans matter more than a smarter model.

**On the canvas:** reads are support tasks (10/s); writes record outcomes. The agent averages 5 steps on a medium model with 10 replicas (50 calls/s) and queries the help-article index each step. The step limit is off.`,
    tryThis: [
      "Read the agent's line in the Guide, then turn on the step limit. How many model calls/s does it save?",
      "Lower the steps per task to 3 (a better tool design). What happens to latency?",
      "Run a 2x spike. How many replicas would you need with and without the limit?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "s" }],
        ["api2", "server", { size: "s" }],
        ["cache", "cache", { hitRatio: 0.15 }],
        ["agent", "agent", { agentSteps: 5, stepLimit: false }],
        ["llm", "llm", { model: "medium", replicas: 10 }],
        ["articles", "vectordb", { replicas: 1 }],
        ["db", "db", { size: "s" }],
      ],
      wires: "client>lb, lb>api1, lb>api2, api1>cache, api2>cache, api1>agent, api2>agent, agent>llm, agent>articles, api1>db, api2>db",
    }),
    traffic: { reads: 10, writes: 10, bots: 0 },
  },
  {
    id: "ai-code-assistant",
    title: "Code assistant",
    source: "AI systems",
    blurb: "Inline completions on a small fast model with context from a repo index. The latency budget is tight.",
    lesson: "37.2",
    story: `Inline code completion has a brutal latency budget: a suggestion that arrives after the developer has typed on is useless. Products aim for a few hundred milliseconds end to end.

**Shape of the system:**
- A **small, fast model** for completions (bigger models for chat and agent edits).
- **Context from the codebase:** the open file, nearby files, and snippets retrieved from a repo index. Indexing runs in the background whenever files change.
- Caching: a developer pausing in the same spot asks for the same completion; debouncing on the client cuts requests.

**On the canvas:** reads are completion requests (300/s); 25% are answered from the cache. The rest retrieve context from the vector index and call a small model with 20 replicas (240/s). Writes are changed files (500/s) re-indexed by workers through a queue.`,
    tryThis: [
      "The model runs near 94%. Add replicas until p99 stops climbing.",
      "Switch the model to medium. What happens to latency and to the number of replicas needed?",
      "Run a 2x spike (everyone back from lunch). Which part breaks first?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "m" }],
        ["api2", "server", { size: "m" }],
        ["cache", "cache", { hitRatio: 0.25 }],
        ["repo", "vectordb", { replicas: 1 }],
        ["llm", "llm", { model: "small", replicas: 20 }],
        ["db", "db", { size: "s" }],
        ["q", "queue"],
        ["indexer", "worker", { workers: 2 }],
      ],
      wires: "client>lb, lb>api1, lb>api2, api1>cache, api2>cache, api1>repo, api2>repo, api1>llm, api2>llm, api1>db, api2>db, api1>q, api2>q, q>indexer, indexer>repo, indexer>db",
    }),
    traffic: { reads: 300, writes: 500, bots: 0 },
  },
  {
    id: "ai-answer-engine",
    title: "AI answer engine",
    source: "AI systems",
    blurb: "Search the web index, then have a frontier model write a cited answer. The big model can't keep up.",
    lesson: "37.3",
    story: `An answer engine (in the style of Perplexity or AI search results) combines search and a language model:

1. **Plan** the query (rewrite it, maybe split it into sub-queries).
2. **Retrieve** from a web index - keyword and vector search, then rerank.
3. **Generate** an answer from the top passages with **citations** to each source.

A crawler and ingestion pipeline keep the index fresh. The model is the expensive step: a frontier model gives better answers but serves only a couple of requests per second per 8-GPU replica.

**On the canvas:** reads are questions (30/s), 30% answered from the cache of recent answers. The rest query the web index (2 replicas), then a large model with 8 replicas (20 answers/s). Writes are crawled pages (300/s) embedded by workers.`,
    tryThis: [
      "The large model is overloaded. Add replicas - what does that cost per month?",
      "Switch to the medium model instead. Capacity, latency and cost?",
      "Raise the answer cache hit ratio. Which questions are safe to cache, and for how long?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "m" }],
        ["api2", "server", { size: "m" }],
        ["answers", "cache", { hitRatio: 0.3 }],
        ["webindex", "vectordb", { replicas: 2 }],
        ["llm", "llm", { model: "large", replicas: 8 }],
        ["db", "db", { size: "m" }],
        ["crawl", "queue"],
        ["embed", "worker", { workers: 2 }],
      ],
      wires: "client>lb, lb>api1, lb>api2, api1>answers, api2>answers, api1>webindex, api2>webindex, api1>llm, api2>llm, api1>db, api2>db, api1>crawl, api2>crawl, crawl>embed, embed>webindex, embed>db",
    }),
    traffic: { reads: 30, writes: 300, bots: 0 },
  },
  {
    id: "ai-prompt-abuse",
    title: "Bots on a free LLM endpoint",
    source: "AI systems",
    blurb: "Scripts hammer a free chat endpoint with 400 prompts a second. There is no rate limiter, and GPUs are expensive.",
    lesson: "33.4",
    story: `A free AI feature is an attractive target: people script it as a free model API, scrape it, or just flood it. Every prompt costs GPU time, so abuse is a direct bill and it starves real users.

**Defences:**
- **Rate limits** per user or API key - and by tokens, not just requests, since one long prompt can cost as much as fifty short ones.
- Require sign-in for expensive features; per-IP limits alone hurt offices and mobile carriers behind shared IPs.
- Cheaper models for anonymous traffic, and caching for repeated prompts (bots' random prompts never hit it).

**On the canvas:** 50 real chats/s, plus 400 bot prompts/s from a few IPs. Bots miss the cache and go straight to a small model with 10 replicas (120 prompts/s). There is no rate limiter.`,
    tryThis: [
      "Read the Guide: what share of model calls are bots?",
      "Add a rate limiter between the client and the load balancer. Try 20 req/s per IP, then 5. Who else gets blocked?",
      "Instead of more GPUs, what's the cheapest fix that gets real users above 99%?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "s" }],
        ["api2", "server", { size: "s" }],
        ["cache", "cache", { hitRatio: 0.3 }],
        ["llm", "llm", { model: "small", replicas: 10 }],
        ["db", "db", { size: "s" }],
      ],
      wires: "client>lb, lb>api1, lb>api2, api1>cache, api2>cache, api1>llm, api2>llm, api1>db, api2>db",
    }),
    traffic: { reads: 50, writes: 20, bots: 400 },
  },
  {
    id: "ai-recsys",
    title: "Recommendation system",
    source: "AI systems",
    blurb: "Candidates from a vector index, ranked by a model on GPUs, features updated from an event stream that's falling behind.",
    lesson: "37.5",
    story: `A "for you" feed is built in stages:

1. **Candidate generation:** a two-tower model embeds users and items; an approximate nearest-neighbour search pulls a few thousand candidates from millions of items.
2. **Ranking:** a heavier model scores each candidate with fresh features (what you just watched, what's trending).
3. **Re-ranking** for diversity, freshness and business rules.

A **feature store** serves features online; an event stream (views, likes, skips) keeps them fresh. If the stream lags, recommendations ignore what you did a minute ago - the feedback loop slows down.

**On the canvas:** reads are feed requests (1,000/s), 80% served from precomputed recommendations in the cache. Misses query the candidate index, then the ranking model (one LLM node = the GPU ranking service). Writes are engagement events (5,000/s) published to Kafka; the feature group updates the feature store (the cache), but 4 consumers can't keep up with 8 partitions.`,
    tryThis: [
      "Watch the feature group's lag. Add consumers until it stops growing.",
      "Lower the precomputed hit ratio to 0.5 (more real-time ranking). How many ranking replicas do you need?",
      "Run \"Cache restart\": what happens to the GPUs when every feed must be ranked live?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["api3", "server", { size: "l" }],
        ["features", "cache", { hitRatio: 0.8 }],
        ["candidates", "vectordb", { replicas: 2 }],
        ["ranker", "llm", { model: "small", replicas: 20 }],
        ["db", "db", { size: "l" }],
        ["events", "kafka", { partitions: 8 }],
        ["featuregroup", "consumer", { consumers: 4 }],
      ],
      wires:
        "client>lb, lb>api1, lb>api2, lb>api3, api1>features, api2>features, api3>features, api1>candidates, api2>candidates, api3>candidates, api1>ranker, api2>ranker, api3>ranker, api1>db, api2>db, api3>db, api1>events, api2>events, api3>events, events>featuregroup, featuregroup>features",
    }),
    traffic: { reads: 1_000, writes: 5_000, bots: 0 },
  },
];
