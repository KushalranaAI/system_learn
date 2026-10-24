import { clamp, gauss, rng } from "./rng";
import { fmt, type SimDef } from "./types";
import { LineChart, Note } from "./ui";
import { usd } from "./ai";

/* ------------------------------------------------------------------ RAG retrieval */

type RagP = { chunkTokens: number; overlapPct: number; topK: number; reranker: boolean; hybrid: boolean; keywordPct: number };

interface RagR {
  recall: number;
  contextTokens: number;
  latencyMs: number;
  costPer1k: number;
  recallAtK: number[];
}

const RAG_Q = 3000;
const RERANK_CANDIDATES = 50;
const INPUT_USD_PER_M = 3;
const OUTPUT_USD_PER_M = 15;
const ANSWER_TOKENS = 300;
const RERANK_USD = 0.001; // per query, 50 candidates through a cross-encoder API

/**
 * Each test question has one passage (~50-130 tokens) that answers it.
 * - Chunking: if a chunk boundary cuts the passage (more likely with small chunks and little overlap), retrieval
 *   only finds half the answer - we count that as a miss.
 * - Ranking: the answering chunk's rank among the rest is geometric with a per-step quality q. q peaks around
 *   300-500-token chunks: big chunks dilute the embedding with unrelated text, tiny ones lose context.
 * - Keyword questions (error codes, SKUs, names) are where dense embeddings are weakest; hybrid search (BM25 + vectors)
 *   fixes most of them.
 * - A reranker scores the top 50 candidates with a cross-encoder and is far better at ordering them.
 */
function ragRanks(p: RagP) {
  const r = rng(27);
  const overlap = p.chunkTokens * (p.overlapPct / 100);
  const ranks: number[] = [];
  const dil = Math.log2(p.chunkTokens / 400);
  const qDense = clamp(0.3 - 0.07 * dil * dil, 0.03, 0.9);
  for (let i = 0; i < RAG_Q; i++) {
    const passage = clamp(90 + 25 * gauss(r), 30, 200);
    const cut = Math.max(0, passage - overlap) / Math.max(1, p.chunkTokens - overlap);
    if (r() < Math.min(1, cut)) {
      ranks.push(Infinity);
      continue;
    }
    const keyword = r() < p.keywordPct / 100;
    let q = keyword ? qDense * 0.35 : qDense;
    if (p.hybrid) q = keyword ? Math.max(q, 0.45) : Math.min(0.9, q + 0.05);
    // rank ~ geometric(q)
    const rank = 1 + Math.floor(Math.log(1 - r()) / Math.log(1 - q));
    if (!p.reranker) ranks.push(rank);
    else if (rank > RERANK_CANDIDATES) ranks.push(Infinity);
    else ranks.push(1 + Math.floor(Math.log(1 - r()) / Math.log(1 - 0.8)));
  }
  return ranks;
}

export function runRagRetrieval(p: RagP): RagR {
  const ranks = ragRanks(p);
  const recallAtK = Array.from({ length: 20 }, (_, k) => ranks.filter((x) => x <= k + 1).length / ranks.length);
  const recall = recallAtK[Math.min(19, p.topK - 1)];
  const contextTokens = p.topK * p.chunkTokens;
  const promptTokens = contextTokens + 400; // + instructions and question
  const latencyMs = 25 + 10 + (p.hybrid ? 15 : 0) + (p.reranker ? 120 : 0) + promptTokens * 0.12 + 450 + ANSWER_TOKENS * 12;
  const costPer1k = 1000 * ((promptTokens * INPUT_USD_PER_M + ANSWER_TOKENS * OUTPUT_USD_PER_M) / 1e6 + (p.reranker ? RERANK_USD : 0));
  return { recall, contextTokens, latencyMs, costPer1k, recallAtK };
}

export const ragRetrieval: SimDef<RagP, RagR> = {
  id: "rag-retrieval",
  title: "RAG retrieval: chunks, top-k, hybrid, rerank",
  module: 27,
  lessons: ["27.4", "27.6", "27.5"],
  blurb: "3,000 help-centre questions, each answered by one passage. Tune chunking and retrieval and watch recall@k, the tokens you stuff into the prompt, latency and cost per query.",
  params: [
    { key: "chunkTokens", label: "Chunk size", type: "number", min: 64, max: 4000, log: true, unit: "tokens" },
    { key: "overlapPct", label: "Chunk overlap", type: "number", min: 0, max: 50, step: 5, unit: "%" },
    { key: "topK", label: "Chunks put in the prompt (k)", type: "number", min: 1, max: 20 },
    { key: "hybrid", label: "Hybrid search (BM25 + vectors)", type: "toggle", hint: "Catches exact terms: error codes, product names, SKUs." },
    { key: "reranker", label: "Rerank the top 50 with a cross-encoder", type: "toggle" },
    { key: "keywordPct", label: "Questions that hinge on an exact term", type: "number", min: 0, max: 60, step: 5, unit: "%" },
  ],
  defaults: { chunkTokens: 2000, overlapPct: 0, topK: 3, hybrid: false, reranker: false, keywordPct: 25 },
  run: runRagRetrieval,
  metrics: (r) => ({ recall: r.recall, contextTokens: r.contextTokens, latencyMs: r.latencyMs, costPer1k: r.costPer1k }),
  metricSpecs: [
    { key: "recall", label: "Recall@k (answer is in the prompt)", format: fmt.pct },
    { key: "contextTokens", label: "Context tokens per query", format: fmt.n },
    { key: "latencyMs", label: "Latency to full answer", format: fmt.ms },
    { key: "costPer1k", label: "Cost per 1,000 queries", format: usd },
  ],
  View: ({ p, r }) => (
    <>
      <LineChart
        yLabel="recall@k"
        xLabel="k (chunks retrieved)"
        xFormat={(i) => `${i + 1}`}
        series={[{ name: "Recall@k with these settings", color: "var(--accent)", values: r.recallAtK }]}
        markers={[{ x: p.topK - 1, label: `k = ${p.topK}`, color: "var(--warm)" }]}
        yMax={1}
        yFormat={(v) => `${Math.round(v * 100)}%`}
      />
      <Note>
        The model can only answer from what you retrieve: recall@k is the ceiling on answer quality. Raising k buys recall with tokens ({fmt.n(r.contextTokens)} per query now), and long prompts
        cost money and slow the first token. Better chunking, hybrid search and a reranker raise the curve instead.
      </Note>
    </>
  ),
};

/* ------------------------------------------------------------------ ANN index */

type AnnP = { vectors: number; dims: number; mode: "exact" | "hnsw"; m: number; efSearch: number };

interface AnnR {
  recall: number;
  latencyMs: number;
  memoryGB: number;
  qpsPerCore: number;
  sweep: number[];
  efs: number[];
}

const EFS = [10, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512];

/** A smooth fit to typical HNSW behaviour: recall rises with efSearch and M, falls slowly as the dataset grows. */
function hnswRecall(ef: number, m: number, n: number) {
  const x = (ef * Math.sqrt(m)) / (3.2 * Math.log2(Math.max(2, n)));
  return clamp(1 - Math.exp(-Math.pow(x, 0.85) * 1.1), 0, 0.9995);
}

function hnswMs(ef: number, m: number, n: number, dims: number) {
  // distance computations: candidates explored × neighbours checked, plus the greedy descent through upper layers
  const comps = ef * m * 1.2 + Math.log2(Math.max(2, n)) * m;
  const perCompNs = dims * 0.1 + 120; // SIMD dot product + a cache miss for a random vector
  return (comps * perCompNs) / 1e6 + 0.05;
}

export function runAnnIndex(p: AnnP): AnnR {
  const vecGB = (p.vectors * p.dims * 4) / 1e9;
  const sweep = EFS.map((ef) => hnswRecall(ef, p.m, p.vectors));
  if (p.mode === "exact") {
    const latencyMs = (p.vectors * p.dims * 0.1) / 1e6 + 0.05; // brute force on one core
    return { recall: 1, latencyMs, memoryGB: vecGB, qpsPerCore: 1000 / latencyMs, sweep, efs: EFS };
  }
  const graphGB = (p.vectors * p.m * 2 * 4 * 1.1) / 1e9; // ~2M links per node on layer 0, 4 bytes each
  const latencyMs = hnswMs(p.efSearch, p.m, p.vectors, p.dims);
  return { recall: hnswRecall(p.efSearch, p.m, p.vectors), latencyMs, memoryGB: vecGB + graphGB, qpsPerCore: 1000 / latencyMs, sweep, efs: EFS };
}

export const annIndex: SimDef<AnnP, AnnR> = {
  id: "ann-index",
  title: "Vector search: exact vs HNSW",
  module: 27,
  lessons: ["27.3"],
  blurb: "Exact nearest-neighbour search compares the query with every vector. HNSW walks a graph instead: far faster, slightly less accurate, and it needs extra memory for the links. Tune M and efSearch.",
  params: [
    { key: "vectors", label: "Vectors in the index", type: "number", min: 10000, max: 1_000_000_000, log: true },
    { key: "dims", label: "Dimensions", type: "select", options: [{ value: 384, label: "384" }, { value: 768, label: "768" }, { value: 1024, label: "1024" }, { value: 1536, label: "1536" }, { value: 3072, label: "3072" }] },
    { key: "mode", label: "Search", type: "select", options: [{ value: "exact", label: "Exact (brute force)" }, { value: "hnsw", label: "HNSW (approximate)" }] },
    { key: "m", label: "HNSW M (links per node)", type: "number", min: 4, max: 64, step: 2 },
    { key: "efSearch", label: "HNSW efSearch (candidates per query)", type: "number", min: 10, max: 512, log: true },
  ],
  defaults: { vectors: 10_000_000, dims: 768, mode: "exact", m: 16, efSearch: 40 },
  run: runAnnIndex,
  metrics: (r) => ({ recall: r.recall, latencyMs: r.latencyMs, memoryGB: r.memoryGB, qpsPerCore: r.qpsPerCore }),
  metricSpecs: [
    { key: "recall", label: "Recall@10 vs exact", format: fmt.pct },
    { key: "latencyMs", label: "Query latency (one core)", format: (v) => (v < 10 ? `${v.toFixed(2)} ms` : fmt.ms(v)) },
    { key: "qpsPerCore", label: "Queries/s per core", format: fmt.n },
    { key: "memoryGB", label: "Memory (vectors + graph)", format: (v) => `${v.toFixed(v < 10 ? 2 : 0)} GB` },
  ],
  View: ({ p, r }) => {
    const idx = EFS.findIndex((e) => e >= p.efSearch);
    return (
      <>
        <LineChart
          yLabel="recall@10"
          xLabel="efSearch (candidates explored per query)"
          xFormat={(i) => `${EFS[i]}`}
          series={[
            { name: `HNSW recall, M = ${p.m}`, color: "var(--accent)", values: r.sweep },
            { name: "Exact search", color: "var(--muted)", values: EFS.map(() => 1), dashed: true },
          ]}
          markers={p.mode === "hnsw" ? [{ x: idx < 0 ? EFS.length - 1 : idx, label: `ef ${p.efSearch}`, color: "var(--warm)" }] : []}
          hLines={[{ y: 0.95, label: "95%" }]}
          yMax={1}
          yFormat={(v) => `${Math.round(v * 100)}%`}
        />
        <Note>
          {p.mode === "exact"
            ? `Brute force reads all ${fmt.n(p.vectors)} × ${p.dims} floats per query: perfect recall, ${fmt.ms(r.latencyMs)} on one core. Fine below ~100k vectors, hopeless at scale.`
            : `HNSW checks about ${fmt.n(p.efSearch * p.m * 1.2)} vectors instead of ${fmt.n(p.vectors)}. The graph adds ${((p.vectors * p.m * 8.8) / 1e9).toFixed(1)} GB on top of ${((p.vectors * p.dims * 4) / 1e9).toFixed(1)} GB of vectors - at hundreds of millions of vectors, product quantisation or disk-based indexes (DiskANN) take over.`}
        </Note>
      </>
    );
  },
};
