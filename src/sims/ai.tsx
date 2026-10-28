import { clamp, gauss, rng } from "./rng";
import { fmt, type SimDef } from "./types";
import { Bars, LineChart, Note } from "./ui";

/** Money with sensible precision for cents-to-thousands. */
export const usd = (v: number) =>
  !Number.isFinite(v) ? "-" : v >= 100 ? `$${Math.round(v).toLocaleString()}` : v >= 1 ? `$${v.toFixed(2)}` : v >= 0.01 ? `$${v.toFixed(3)}` : `$${v.toFixed(4)}`;

/* ------------------------------------------------------------------ model shapes */

interface ModelShape {
  label: string;
  /** parameters, billions */
  params: number;
  layers: number;
  kvHeads: number;
  headDim: number;
}

const MODELS: Record<string, ModelShape> = {
  "8b": { label: "8B (Llama-3-8B shape)", params: 8, layers: 32, kvHeads: 8, headDim: 128 },
  "70b": { label: "70B (Llama-3-70B shape)", params: 70, layers: 80, kvHeads: 8, headDim: 128 },
  "70b-mha": { label: "70B without GQA (64 KV heads)", params: 70, layers: 80, kvHeads: 64, headDim: 128 },
};

/** Bytes of KV cache per token: keys and values, every layer, every KV head. */
const kvBytesPerToken = (m: ModelShape, bits: number) => 2 * m.layers * m.kvHeads * m.headDim * (bits / 8);

/* ------------------------------------------------------------------ LLM batching */

const GPU_MEM_GB = 80; // H100-class
const GPU_BW_GBS = 2000; // effective HBM bandwidth (spec ~3,350 GB/s; real kernels reach ~60%)
const GPU_TFLOPS = 400; // effective dense bf16 throughput
const PREFILL_CHUNK = 512; // prompt tokens processed per step alongside decoding (chunked prefill)

type BatchP = { model: string; gpus: number; batch: number; promptTokens: number; outputTokens: number; gpuHourUsd: number };

interface BatchR {
  fits: boolean;
  effBatch: number;
  memLimit: number;
  stepMs: number;
  ttftMs: number;
  userTps: number;
  tokensPerSec: number;
  reqPerSec: number;
  costPerM: number;
  sweep: { batch: number; tokensPerSec: number; userTps: number; ttftMs: number }[];
}

function batchPoint(p: BatchP, batch: number) {
  const m = MODELS[p.model] ?? MODELS["8b"];
  const weightsGB = m.params * 2; // bf16
  const kvPerTok = kvBytesPerToken(m, 16);
  const avgCtx = p.promptTokens + p.outputTokens / 2;
  const freeGB = GPU_MEM_GB * p.gpus * 0.9 - weightsGB;
  const memLimit = freeGB <= 0 ? 0 : Math.floor((freeGB * 1e9) / (kvPerTok * (p.promptTokens + p.outputTokens)));
  const b = Math.max(0, Math.min(batch, memLimit));
  // Tensor parallelism splits the work across GPUs but pays ~10% per extra GPU in communication.
  const tp = p.gpus / (1 + 0.1 * (p.gpus - 1));
  // One decode step: read every weight once (memory-bound), read each sequence's KV cache, and do 2·params FLOPs per sequence.
  const weightMs = (weightsGB / (GPU_BW_GBS * tp)) * 1000;
  const kvMs = ((b * avgCtx * kvPerTok) / (GPU_BW_GBS * 1e9 * tp)) * 1000;
  const computeMs = ((b * 2 * m.params * 1e9) / (GPU_TFLOPS * 1e12 * tp)) * 1000;
  const stepMs = weightMs + kvMs + computeMs + 1;
  const prefillMs = ((p.promptTokens * 2 * m.params * 1e9) / (GPU_TFLOPS * 1e12 * tp)) * 1000;
  // A new request's prompt is fed in chunks between decode steps of everyone else in the batch.
  const ttftMs = prefillMs + Math.ceil(p.promptTokens / PREFILL_CHUNK) * stepMs + stepMs / 2;
  const perReqSec = (ttftMs + p.outputTokens * stepMs) / 1000;
  const reqPerSec = b > 0 ? b / perReqSec : 0;
  const tokensPerSec = reqPerSec * p.outputTokens;
  return { b, memLimit, stepMs, ttftMs, userTps: b > 0 ? 1000 / stepMs : 0, reqPerSec, tokensPerSec };
}

export function runLlmBatching(p: BatchP): BatchR {
  const x = batchPoint(p, p.batch);
  const costPerM = x.tokensPerSec > 0 ? ((p.gpus * p.gpuHourUsd) / (x.tokensPerSec * 3600)) * 1e6 : Infinity;
  const sweep = [1, 2, 4, 8, 16, 32, 64, 128, 256].map((batch) => {
    const s = batchPoint(p, batch);
    return { batch, tokensPerSec: s.tokensPerSec, userTps: s.userTps, ttftMs: s.ttftMs };
  });
  return {
    fits: x.memLimit >= 1,
    effBatch: x.b,
    memLimit: x.memLimit,
    stepMs: x.stepMs,
    ttftMs: x.b > 0 ? x.ttftMs : Infinity,
    userTps: x.userTps,
    tokensPerSec: x.tokensPerSec,
    reqPerSec: x.reqPerSec,
    costPerM,
    sweep,
  };
}

export const llmBatching: SimDef<BatchP, BatchR> = {
  id: "llm-batching",
  title: "LLM batching: throughput vs latency",
  module: 33,
  lessons: ["33.3", "33.2"],
  blurb: "A GPU decodes one token for every sequence in the batch per step. Bigger batches multiply throughput and cut cost per token, but each user's stream slows down and first tokens arrive later.",
  params: [
    { key: "model", label: "Model", type: "select", options: [{ value: "8b", label: "8B" }, { value: "70b", label: "70B" }] },
    { key: "gpus", label: "GPUs per replica (80 GB each)", type: "number", min: 1, max: 8 },
    { key: "batch", label: "Max concurrent sequences (batch)", type: "number", min: 1, max: 256, log: true, hint: "Continuous batching keeps this many sequences decoding together." },
    { key: "promptTokens", label: "Prompt tokens", type: "number", min: 100, max: 16000, log: true },
    { key: "outputTokens", label: "Output tokens", type: "number", min: 20, max: 2000, log: true },
    { key: "gpuHourUsd", label: "GPU rental", type: "number", min: 1, max: 8, step: 0.5, unit: "$/GPU-hour" },
  ],
  defaults: { model: "8b", gpus: 1, batch: 1, promptTokens: 1000, outputTokens: 300, gpuHourUsd: 2.5 },
  run: runLlmBatching,
  metrics: (r) => ({ tokensPerSec: r.tokensPerSec, reqPerSec: r.reqPerSec, ttftMs: r.ttftMs, userTps: r.userTps, costPerM: r.costPerM, fits: r.fits ? 1 : 0 }),
  metricSpecs: [
    { key: "tokensPerSec", label: "Output tokens/s (whole replica)", format: fmt.n },
    { key: "reqPerSec", label: "Requests/s", format: (v) => v.toFixed(2) },
    { key: "ttftMs", label: "Time to first token", format: fmt.ms },
    { key: "userTps", label: "Tokens/s each user sees", format: fmt.n },
    { key: "costPerM", label: "GPU cost per 1M output tokens", format: usd },
  ],
  View: ({ p, r }) => {
    const cur = Math.log2(Math.max(1, Math.min(256, r.effBatch || 1)));
    return (
      <>
        <LineChart
          yLabel="tokens/s"
          xLabel="batch size (sequences decoding together)"
          xFormat={(i) => `${2 ** i}`}
          series={[{ name: "Replica throughput (tokens/s)", color: "var(--accent)", values: r.sweep.map((s) => s.tokensPerSec) }]}
          markers={[{ x: cur, label: `batch ${r.effBatch}`, color: "var(--warm)" }]}
          yFormat={fmt.n}
        />
        <LineChart
          height={140}
          yLabel="tokens/s per user"
          xLabel="batch size"
          xFormat={(i) => `${2 ** i}`}
          series={[{ name: "Speed each user sees (tokens/s)", color: "var(--good)", values: r.sweep.map((s) => s.userTps) }]}
          hLines={[{ y: 20, label: "comfortable reading speed ~20 tok/s" }]}
          markers={[{ x: cur, label: "", color: "var(--warm)" }]}
        />
        <Note>
          {!r.fits
            ? `The ${p.model.toUpperCase()} weights (${MODELS[p.model].params * 2} GB in bf16) don't fit on ${p.gpus} GPU${p.gpus === 1 ? "" : "s"} with room for a KV cache. Add GPUs.`
            : `One decode step takes ${r.stepMs.toFixed(1)} ms and emits a token for each of ${r.effBatch} sequence${r.effBatch === 1 ? "" : "s"}. Memory allows up to ${r.memLimit} sequences of this length${p.batch > r.memLimit ? ` - your batch of ${p.batch} is capped there` : ""}. Small batches waste the GPU: each step reads all the weights from memory to produce just a few tokens.`}
        </Note>
      </>
    );
  },
};

/* ------------------------------------------------------------------ KV cache */

type KvP = { model: string; weightBits: number; kvBits: number; contextTokens: number; avgFillPct: number; gpus: number; gpuMemGB: number; allocation: "contiguous" | "paged"; targetSeqs: number };

interface KvR {
  weightsGB: number;
  usableGB: number;
  freeGB: number;
  kvPerSeqGB: number;
  maxSeqs: number;
  usedKvGB: number;
  wastedKvGB: number;
  waste: number;
  fits: boolean;
}

const PAGE = 16; // tokens per KV block (vLLM's default)

export function runKvCache(p: KvP): KvR {
  const m = MODELS[p.model] ?? MODELS["70b"];
  const weightsGB = (m.params * p.weightBits) / 8;
  const usableGB = p.gpus * p.gpuMemGB * 0.9; // the rest: activations, CUDA context, fragmentation
  const freeGB = Math.max(0, usableGB - weightsGB);
  const perTok = kvBytesPerToken(m, p.kvBits);
  const used = p.contextTokens * (p.avgFillPct / 100);
  // Contiguous allocation reserves the maximum context up front; paged allocation grows in 16-token blocks.
  const reservedTok = p.allocation === "contiguous" ? p.contextTokens : Math.ceil(used / PAGE) * PAGE + PAGE / 2;
  const kvPerSeqGB = (reservedTok * perTok) / 1e9;
  const maxSeqs = weightsGB > usableGB ? 0 : Math.floor(freeGB / kvPerSeqGB);
  const n = Math.min(maxSeqs, p.targetSeqs);
  const usedKvGB = (n * used * perTok) / 1e9;
  const wastedKvGB = n * kvPerSeqGB - usedKvGB;
  return {
    weightsGB,
    usableGB,
    freeGB,
    kvPerSeqGB,
    maxSeqs,
    usedKvGB,
    wastedKvGB,
    waste: n > 0 ? wastedKvGB / (n * kvPerSeqGB) : 0,
    fits: weightsGB <= usableGB && maxSeqs >= p.targetSeqs,
  };
}

export const kvCache: SimDef<KvP, KvR> = {
  id: "kv-cache",
  title: "GPU memory and the KV cache",
  module: 33,
  lessons: ["33.3"],
  blurb: "Weights take a fixed slice of GPU memory; every running conversation needs its own KV cache on top. See how precision, GQA, context length and PagedAttention decide how many users one replica can serve.",
  params: [
    { key: "model", label: "Model", type: "select", options: Object.entries(MODELS).map(([value, m]) => ({ value, label: m.label })) },
    { key: "weightBits", label: "Weight precision", type: "select", options: [{ value: 16, label: "bf16 (16-bit)" }, { value: 8, label: "FP8 / INT8" }, { value: 4, label: "INT4 (AWQ/GPTQ)" }] },
    { key: "kvBits", label: "KV cache precision", type: "select", options: [{ value: 16, label: "16-bit" }, { value: 8, label: "FP8" }] },
    { key: "contextTokens", label: "Max context per sequence", type: "number", min: 1024, max: 131072, log: true, unit: "tokens" },
    { key: "avgFillPct", label: "Context a typical chat actually uses", type: "number", min: 5, max: 100, step: 5, unit: "%" },
    { key: "gpus", label: "GPUs", type: "number", min: 1, max: 8 },
    { key: "gpuMemGB", label: "Memory per GPU", type: "select", options: [{ value: 24, label: "24 GB (L4-class)" }, { value: 48, label: "48 GB (L40S)" }, { value: 80, label: "80 GB (A100/H100)" }, { value: 141, label: "141 GB (H200)" }] },
    { key: "allocation", label: "KV allocation", type: "select", options: [{ value: "contiguous", label: "Contiguous (reserve max context)" }, { value: "paged", label: "PagedAttention (16-token blocks)" }] },
    { key: "targetSeqs", label: "Concurrent sequences you need", type: "number", min: 1, max: 512, log: true },
  ],
  defaults: { model: "70b", weightBits: 16, kvBits: 16, contextTokens: 32768, avgFillPct: 25, gpus: 4, gpuMemGB: 80, allocation: "contiguous", targetSeqs: 64 },
  run: runKvCache,
  metrics: (r) => ({ fits: r.fits ? 1 : 0, maxSeqs: r.maxSeqs, kvPerSeqGB: r.kvPerSeqGB, weightsGB: r.weightsGB, waste: r.waste }),
  metricSpecs: [
    { key: "fits", label: "Fits the target?", format: (v) => (v ? "yes" : "no") },
    { key: "maxSeqs", label: "Max concurrent sequences", format: fmt.n },
    { key: "kvPerSeqGB", label: "KV memory reserved per sequence", format: (v) => `${v.toFixed(2)} GB` },
    { key: "weightsGB", label: "Weights", format: (v) => `${Math.round(v)} GB` },
    { key: "waste", label: "Reserved KV never used", format: fmt.pct },
  ],
  View: ({ p, r }) => {
    const free = Math.max(0, r.usableGB - r.weightsGB - r.usedKvGB - r.wastedKvGB);
    return (
      <>
        <Bars
          values={[r.weightsGB, r.usedKvGB, r.wastedKvGB, free]}
          yLabel="GPU memory across the replica"
          labels={["weights", "KV in use", "KV reserved, unused", "free"]}
          color={(_, i) => ["var(--muted)", "var(--good)", "var(--bad)", "var(--accent)"][i]}
          refLine={r.usableGB}
          refLabel={`usable ${Math.round(r.usableGB)} GB`}
          yFormat={(v) => `${Math.round(v)} GB`}
        />
        <Note>
          {r.weightsGB > r.usableGB
            ? `The weights alone (${Math.round(r.weightsGB)} GB) exceed the ${Math.round(r.usableGB)} GB usable on ${p.gpus} GPU${p.gpus === 1 ? "" : "s"}. Quantise or add GPUs.`
            : `${Math.round(r.freeGB)} GB is left for KV cache. At ${p.contextTokens.toLocaleString()} tokens of max context each sequence ${p.allocation === "contiguous" ? "reserves" : "uses"} ${r.kvPerSeqGB.toFixed(2)} GB, so ${r.maxSeqs} sequences fit (you need ${p.targetSeqs}).${p.allocation === "contiguous" ? " Contiguous allocation reserves the whole context even though a typical chat uses a fraction of it." : ""}`}
        </Note>
      </>
    );
  },
};

/* ------------------------------------------------------------------ Semantic cache */

type SemP = { threshold: number; repeatPct: number; nearMissSpread: number; llmMs: number; llmCostCents: number };

interface SemR {
  hitRate: number;
  wrongRate: number;
  costSaved: number;
  avgLatencyMs: number;
  latencySaved: number;
  sweep: { hit: number[]; wrong: number[] };
}

const SEM_N = 6000;
const LOOKUP_MS = 25; // embed the query + nearest-neighbour lookup
const EMBED_COST_CENTS = 0.002;

function semSamples(p: SemP) {
  const r = rng(26);
  const out: { repeat: boolean; sim: number }[] = [];
  for (let i = 0; i < SEM_N; i++) {
    const repeat = r() < p.repeatPct / 100;
    // A paraphrase of an earlier question sits very close to it; a new question's nearest cached neighbour is usually
    // further away - but some are "near misses": same words, different meaning ("cancel my order" vs "cancel my plan").
    const sim = repeat ? clamp(0.95 + 0.025 * gauss(r), 0, 1) : clamp(0.8 + (p.nearMissSpread / 100) * gauss(r), 0, 1);
    out.push({ repeat, sim });
  }
  return out;
}

function semAt(samples: { repeat: boolean; sim: number }[], t: number) {
  let hits = 0;
  let wrong = 0;
  for (const s of samples)
    if (s.sim >= t) {
      hits++;
      if (!s.repeat) wrong++;
    }
  return { hit: hits / samples.length, wrong: wrong / samples.length };
}

export function runSemanticCache(p: SemP): SemR {
  const samples = semSamples(p);
  const { hit, wrong } = semAt(samples, p.threshold);
  const avgLatencyMs = LOOKUP_MS + (1 - hit) * p.llmMs;
  const costSaved = (hit * p.llmCostCents - EMBED_COST_CENTS) / p.llmCostCents;
  const ts = Array.from({ length: 21 }, (_, i) => 0.8 + i * 0.01);
  const pts = ts.map((t) => semAt(samples, t));
  return { hitRate: hit, wrongRate: wrong, costSaved, avgLatencyMs, latencySaved: 1 - avgLatencyMs / p.llmMs, sweep: { hit: pts.map((x) => x.hit), wrong: pts.map((x) => x.wrong) } };
}

export const semanticCache: SimDef<SemP, SemR> = {
  id: "semantic-cache",
  title: "Semantic cache threshold",
  module: 33,
  lessons: ["33.5"],
  blurb: "Answer a new question with a cached answer when its embedding is close enough to an earlier one. A low threshold saves money and time - and serves wrong answers to questions that only look similar.",
  params: [
    { key: "threshold", label: "Similarity threshold (cosine)", type: "number", min: 0.8, max: 1, step: 0.005 },
    { key: "repeatPct", label: "Questions that repeat an earlier one", type: "number", min: 0, max: 80, step: 5, unit: "%" },
    { key: "nearMissSpread", label: "How similar different questions look", type: "number", min: 2, max: 8, step: 0.5, hint: "Higher = more look-alike questions with different answers (e.g. many product names)." },
    { key: "llmMs", label: "Model latency (full answer)", type: "number", min: 300, max: 8000, step: 100, unit: "ms" },
    { key: "llmCostCents", label: "Model cost per answer", type: "number", min: 0.05, max: 5, step: 0.05, unit: "¢" },
  ],
  defaults: { threshold: 0.85, repeatPct: 40, nearMissSpread: 5, llmMs: 2500, llmCostCents: 0.8 },
  run: runSemanticCache,
  metrics: (r) => ({ hitRate: r.hitRate, wrongRate: r.wrongRate, costSaved: r.costSaved, avgLatencyMs: r.avgLatencyMs }),
  metricSpecs: [
    { key: "hitRate", label: "Cache hit rate", format: fmt.pct },
    { key: "wrongRate", label: "Wrong answers served", format: fmt.pct2 },
    { key: "costSaved", label: "Model cost saved", format: fmt.pct },
    { key: "avgLatencyMs", label: "Average latency", format: fmt.ms },
  ],
  View: ({ p, r }) => (
    <>
      <LineChart
        yLabel="share of questions"
        xLabel="similarity threshold"
        xFormat={(i) => (0.8 + i * 0.01).toFixed(2)}
        series={[
          { name: "Hit rate", color: "var(--good)", values: r.sweep.hit },
          { name: "Wrong answers", color: "var(--bad)", values: r.sweep.wrong },
        ]}
        markers={[{ x: (p.threshold - 0.8) * 100, label: `t = ${p.threshold.toFixed(3)}`, color: "var(--warm)" }]}
        yFormat={(v) => `${Math.round(v * 100)}%`}
      />
      <Note>
        {p.repeatPct}% of questions really are repeats; a perfect cache would hit on exactly those. Every hit above that line is a different question getting someone else's answer.
        Real systems also scope the cache per tenant and language, and never cache answers that depend on the user's own data.
      </Note>
    </>
  ),
};

/* ------------------------------------------------------------------ Model cascade */

type CascadeP = { mode: "large" | "small" | "cascade"; threshold: number; hardPct: number; smallCost: number; largeCost: number; smallMs: number; largeMs: number };

interface CascadeR {
  quality: number;
  costPer1k: number;
  costVsLarge: number;
  avgLatencyMs: number;
  escalated: number;
  sweep: { quality: number[]; cost: number[] };
}

const CASCADE_N = 5000;

function cascadeQueries(hardPct: number) {
  const r = rng(29);
  const qs: { hard: boolean; smallOk: boolean; conf: number; largeOk: boolean }[] = [];
  for (let i = 0; i < CASCADE_N; i++) {
    const hard = r() < hardPct / 100;
    const smallOk = r() < (hard ? 0.45 : 0.95);
    const largeOk = r() < (hard ? 0.88 : 0.98);
    // The small model's confidence is informative but imperfect: right answers tend to score high, wrong ones lower.
    const conf = clamp(smallOk ? 0.86 + 0.08 * gauss(r) : 0.62 + 0.14 * gauss(r), 0, 1);
    qs.push({ hard, smallOk, conf, largeOk });
  }
  return qs;
}

function cascadeAt(qs: ReturnType<typeof cascadeQueries>, p: CascadeP, mode: CascadeP["mode"], t: number) {
  let ok = 0;
  let cost = 0;
  let ms = 0;
  let esc = 0;
  for (const q of qs) {
    if (mode === "large") {
      ok += +q.largeOk;
      cost += p.largeCost;
      ms += p.largeMs;
    } else if (mode === "small") {
      ok += +q.smallOk;
      cost += p.smallCost;
      ms += p.smallMs;
    } else if (q.conf >= t) {
      ok += +q.smallOk;
      cost += p.smallCost;
      ms += p.smallMs;
    } else {
      esc++;
      ok += +q.largeOk;
      cost += p.smallCost + p.largeCost;
      ms += p.smallMs + p.largeMs;
    }
  }
  const n = qs.length;
  return { quality: ok / n, costPer1k: (cost / n) * 1000, avgLatencyMs: ms / n, escalated: esc / n };
}

export function runModelCascade(p: CascadeP): CascadeR {
  const qs = cascadeQueries(p.hardPct);
  const x = cascadeAt(qs, p, p.mode, p.threshold);
  const large = cascadeAt(qs, p, "large", 0);
  const ts = Array.from({ length: 21 }, (_, i) => 0.5 + i * 0.025);
  const pts = ts.map((t) => cascadeAt(qs, p, "cascade", t));
  return { ...x, costVsLarge: x.costPer1k / large.costPer1k, sweep: { quality: pts.map((v) => v.quality), cost: pts.map((v) => v.costPer1k / large.costPer1k) } };
}

export const modelCascade: SimDef<CascadeP, CascadeR> = {
  id: "model-cascade",
  title: "Model cascade: small first, escalate when unsure",
  module: 33,
  lessons: ["33.4", "36.5"],
  blurb: "Send every request to a cheap, fast model and only escalate to the big one when the small model isn't confident. The confidence threshold trades quality against cost and latency.",
  params: [
    { key: "mode", label: "Routing", type: "select", options: [{ value: "large", label: "Large model only" }, { value: "small", label: "Small model only" }, { value: "cascade", label: "Cascade (small → large)" }] },
    { key: "threshold", label: "Accept the small model's answer at confidence ≥", type: "number", min: 0.5, max: 1, step: 0.01 },
    { key: "hardPct", label: "Hard requests", type: "number", min: 5, max: 80, step: 5, unit: "%" },
    { key: "smallCost", label: "Small model cost per request", type: "number", min: 0.0001, max: 0.01, step: 0.0001, unit: "$" },
    { key: "largeCost", label: "Large model cost per request", type: "number", min: 0.001, max: 0.1, step: 0.001, unit: "$" },
    { key: "smallMs", label: "Small model latency", type: "number", min: 100, max: 3000, step: 50, unit: "ms" },
    { key: "largeMs", label: "Large model latency", type: "number", min: 300, max: 10000, step: 100, unit: "ms" },
  ],
  defaults: { mode: "large", threshold: 0.8, hardPct: 30, smallCost: 0.0006, largeCost: 0.012, smallMs: 400, largeMs: 2200 },
  run: runModelCascade,
  metrics: (r) => ({ quality: r.quality, costVsLarge: r.costVsLarge, costPer1k: r.costPer1k, avgLatencyMs: r.avgLatencyMs, escalated: r.escalated }),
  metricSpecs: [
    { key: "quality", label: "Correct answers", format: fmt.pct },
    { key: "costPer1k", label: "Cost per 1,000 requests", format: usd },
    { key: "costVsLarge", label: "Cost vs large-only", format: fmt.pct },
    { key: "avgLatencyMs", label: "Average latency", format: fmt.ms },
    { key: "escalated", label: "Escalated to the large model", format: fmt.pct },
  ],
  View: ({ p, r }) => (
    <>
      <LineChart
        yLabel="share"
        xLabel="confidence threshold for keeping the small model's answer"
        xFormat={(i) => (0.5 + i * 0.025).toFixed(2)}
        series={[
          { name: "Cascade quality", color: "var(--good)", values: r.sweep.quality },
          { name: "Cascade cost ÷ large-only", color: "var(--warm)", values: r.sweep.cost },
        ]}
        markers={p.mode === "cascade" ? [{ x: (p.threshold - 0.5) / 0.025, label: `t = ${p.threshold.toFixed(2)}`, color: "var(--accent)" }] : []}
        yMax={1.2}
        yFormat={(v) => `${Math.round(v * 100)}%`}
      />
      <Note>
        {p.mode === "cascade"
          ? `${fmt.pct(r.escalated)} of requests are escalated and pay for both models (and both latencies). The rest are answered by the small model at a fraction of the cost.`
          : p.mode === "small"
            ? "The small model is cheap and fast but gets most hard requests wrong."
            : "Every request pays for the large model, even the easy majority a small model would get right."}
      </Note>
    </>
  ),
};
