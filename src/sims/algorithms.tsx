import { hash32, rng, zipf } from "./rng";
import { fmt, type SimDef } from "./types";
import { Bars, LineChart, Note } from "./ui";

/* ------------------------------------------------------------------ Bloom filter */

type BloomP = { n: number; bitsPerItem: number; k: number };
interface BloomR { fp: number; theory: number; memoryKB: number; fill: number }

export function runBloom(p: BloomP): BloomR {
  const m = Math.max(8, Math.round(p.n * p.bitsPerItem));
  const bits = new Uint8Array(Math.ceil(m / 8));
  const idx = (x: string, i: number) => (hash32(x, 1) + i * ((hash32(x, 2) | 1) >>> 0)) % m;
  for (let i = 0; i < p.n; i++) {
    const x = `item:${i}`;
    for (let j = 0; j < p.k; j++) {
      const b = idx(x, j);
      bits[b >> 3] |= 1 << (b & 7);
    }
  }
  const TESTS = 20000;
  let fp = 0;
  for (let t = 0; t < TESTS; t++) {
    const x = `other:${t}`;
    let all = true;
    for (let j = 0; j < p.k && all; j++) {
      const b = idx(x, j);
      if (!(bits[b >> 3] & (1 << (b & 7)))) all = false;
    }
    if (all) fp++;
  }
  let set = 0;
  for (const byte of bits) for (let b = 0; b < 8; b++) if (byte & (1 << b)) set++;
  return { fp: fp / TESTS, theory: Math.pow(1 - Math.exp((-p.k * p.n) / m), p.k), memoryKB: m / 8 / 1024, fill: set / m };
}

export const bloom: SimDef<BloomP, BloomR> = {
  id: "bloom",
  title: "Bloom filter",
  module: 19,
  lessons: ["19.2"],
  blurb: "Insert real items into a bit array with k hash functions, then test 20,000 items that were never inserted and count the false positives.",
  params: [
    { key: "n", label: "Items inserted", type: "number", min: 1000, max: 200000, log: true },
    { key: "bitsPerItem", label: "Bits per item", type: "number", min: 1, max: 24 },
    { key: "k", label: "Hash functions (k)", type: "number", min: 1, max: 16 },
  ],
  defaults: { n: 10000, bitsPerItem: 4, k: 1 },
  run: runBloom,
  metrics: (r) => ({ fp: r.fp, memoryKB: r.memoryKB, theory: r.theory }),
  metricSpecs: [
    { key: "fp", label: "Measured false positives", format: fmt.pct2 },
    { key: "theory", label: "Theory (1 − e^(−kn/m))^k", format: fmt.pct2 },
    { key: "memoryKB", label: "Memory", format: fmt.kb },
  ],
  View: ({ p, r }) => (
    <Note>
      {fmt.pct(r.fill)} of the {Math.round(p.n * p.bitsPerItem).toLocaleString()} bits are set. Best k for {p.bitsPerItem} bits per item is about {Math.max(1, Math.round(p.bitsPerItem * Math.LN2))}.
      Storing the {p.n.toLocaleString()} items themselves (~20 bytes each) would take {fmt.kb((p.n * 20) / 1024)}.
    </Note>
  ),
};

/* ------------------------------------------------------------------ HyperLogLog */

type HllP = { p: number; distinct: number; repeats: number };
interface HllR { estimate: number; error: number; memoryKB: number; trials: number[] }

function hll(pBits: number, items: (add: (h: number) => void) => void): number {
  const m = 1 << pBits;
  const reg = new Uint8Array(m);
  items((h) => {
    const j = h >>> (32 - pBits);
    const w = (h << pBits) >>> 0;
    const rank = Math.min(32 - pBits + 1, Math.clz32(w) + 1);
    if (rank > reg[j]) reg[j] = rank;
  });
  let sum = 0;
  let zeros = 0;
  for (const v of reg) {
    sum += Math.pow(2, -v);
    if (!v) zeros++;
  }
  const alpha = m === 16 ? 0.673 : m === 32 ? 0.697 : m === 64 ? 0.709 : 0.7213 / (1 + 1.079 / m);
  let e = (alpha * m * m) / sum;
  if (e <= 2.5 * m && zeros) e = m * Math.log(m / zeros);
  return e;
}

export function runHll(p: HllP): HllR {
  const run = (seed: number) =>
    hll(p.p, (add) => {
      for (let rep = 0; rep < p.repeats; rep++) for (let i = 0; i < p.distinct; i++) add(hash32(`user:${i}`, seed));
    });
  const estimate = run(7);
  const trials = [11, 23, 31, 47, 59].map((s) => Math.abs(run(s) - p.distinct) / p.distinct);
  return { estimate, error: Math.abs(estimate - p.distinct) / p.distinct, memoryKB: ((1 << p.p) * 6) / 8 / 1024, trials };
}

export const hyperloglog: SimDef<HllP, HllR> = {
  id: "hyperloglog",
  title: "HyperLogLog",
  module: 19,
  lessons: ["19.4", "12.8", "17.6"],
  blurb: "Count distinct users in a stream with duplicates using 2^p tiny registers, and compare with the exact answer.",
  params: [
    { key: "p", label: "Precision p (2^p registers)", type: "number", min: 4, max: 16 },
    { key: "distinct", label: "Distinct users", type: "number", min: 1000, max: 500000, log: true },
    { key: "repeats", label: "Times each user appears", type: "number", min: 1, max: 5 },
  ],
  defaults: { p: 4, distinct: 100000, repeats: 3 },
  run: runHll,
  metrics: (r) => ({ error: r.error, memoryKB: r.memoryKB, estimate: r.estimate }),
  metricSpecs: [
    { key: "estimate", label: "Estimated distinct", format: fmt.n },
    { key: "error", label: "Error", format: fmt.pct2 },
    { key: "memoryKB", label: "Memory", format: fmt.kb },
  ],
  View: ({ p, r }) => (
    <>
      <p className="small muted">Error with 5 other hash seeds (theory ≈ {fmt.pct(1.04 / Math.sqrt(1 << p.p))}):</p>
      <Bars values={r.trials.map((t) => t * 100)} labels={r.trials.map((_, i) => `seed ${i + 1}`)} yFormat={(v) => `${v.toFixed(1)}%`} color={(v) => (v < 2 ? "var(--good)" : "var(--warm)")} />
      <Note>An exact set of {p.distinct.toLocaleString()} 8-byte ids needs ~{fmt.kb((p.distinct * 8) / 1024)}; this sketch uses {fmt.kb(r.memoryKB)}, and duplicates never change it.</Note>
    </>
  ),
};

/* ------------------------------------------------------------------ Count-min sketch */

type CmsP = { width: number; depth: number; keys: number; stream: number; skew: number };
interface CmsR { topError: number; tailError: number; memoryKB: number; top: { exact: number; est: number }[] }

export function runCms(p: CmsP): CmsR {
  const z = zipf(p.keys, p.skew);
  const r = rng(19);
  const grid = Array.from({ length: p.depth }, () => new Uint32Array(p.width));
  const exact = new Uint32Array(p.keys);
  for (let i = 0; i < p.stream; i++) {
    const k = z.sample(r);
    exact[k]++;
    for (let d = 0; d < p.depth; d++) grid[d][hash32(`k${k}`, d + 1) % p.width]++;
  }
  const est = (k: number) => Math.min(...grid.map((row, d) => row[hash32(`k${k}`, d + 1) % p.width]));
  const rel = (k: number) => (exact[k] ? (est(k) - exact[k]) / exact[k] : 0);
  const top = Array.from({ length: 10 }, (_, k) => ({ exact: exact[k], est: est(k) }));
  const tailKeys = Array.from({ length: 50 }, (_, i) => 100 + i * 7).filter((k) => k < p.keys);
  return {
    topError: top.reduce((a, _, k) => a + rel(k), 0) / 10,
    tailError: tailKeys.reduce((a, k) => a + rel(k), 0) / Math.max(1, tailKeys.length),
    memoryKB: (p.width * p.depth * 4) / 1024,
    top,
  };
}

export const countMin: SimDef<CmsP, CmsR> = {
  id: "count-min",
  title: "Count-min sketch",
  module: 19,
  lessons: ["19.3", "14.3"],
  blurb: "Estimate how often each key appears in a 200,000-event skewed stream with a small grid of counters, and find the heavy hitters.",
  params: [
    { key: "width", label: "Width (counters per row)", type: "number", min: 16, max: 16384, log: true },
    { key: "depth", label: "Depth (rows / hash functions)", type: "number", min: 1, max: 8 },
    { key: "keys", label: "Distinct keys", type: "number", min: 1000, max: 100000, log: true },
    { key: "stream", label: "Events in the stream", type: "number", min: 10000, max: 1000000, log: true },
    { key: "skew", label: "Skew (Zipf s)", type: "number", min: 0.5, max: 1.5, step: 0.05 },
  ],
  defaults: { width: 64, depth: 1, keys: 10000, stream: 200000, skew: 1.1 },
  run: runCms,
  metrics: (r) => ({ topError: r.topError, tailError: r.tailError, memoryKB: r.memoryKB }),
  metricSpecs: [
    { key: "topError", label: "Overestimate, top 10 keys", format: fmt.pct2 },
    { key: "tailError", label: "Overestimate, rare keys", format: fmt.pct },
    { key: "memoryKB", label: "Memory", format: fmt.kb },
  ],
  View: ({ r }) => (
    <>
      <p className="small muted">Top 10 keys - exact count (bar) vs estimate (line):</p>
      <LineChart xLabel="key rank (1 = most frequent)" xFormat={(i) => `${i + 1}`} yLabel="count" yFormat={fmt.n} series={[{ name: "exact", color: "var(--muted)", values: r.top.map((t) => t.exact), dashed: true }, { name: "estimate", color: "var(--warm)", values: r.top.map((t) => t.est) }]} />
      <Note>Collisions only ever add, so estimates never undercount. Heavy hitters dwarf the collision noise; rare keys are where the sketch is least accurate.</Note>
    </>
  ),
};

/* ------------------------------------------------------------------ Merkle tree */

type MerkleP = { keys: number; leavesPow: number; diffs: number };
interface MerkleR { comparisons: number; transferred: number; total: number; diffLeaves: number }

export function runMerkle(p: MerkleP): MerkleR {
  const leaves = 1 << p.leavesPow;
  const r = rng(5);
  const changed = new Set<number>();
  while (changed.size < Math.min(p.diffs, p.keys)) changed.add(Math.floor(r() * p.keys));
  const leafOf = (i: number) => Math.floor((i * leaves) / p.keys);
  const build = (variant: boolean) => {
    const leafHash = new Uint32Array(leaves);
    for (let i = 0; i < p.keys; i++) {
      const v = hash32(`v${i}${variant && changed.has(i) ? "'" : ""}`);
      const l = leafOf(i);
      leafHash[l] = hash32(`${leafHash[l]}:${v}`);
    }
    const levels: Uint32Array[] = [leafHash];
    while (levels[levels.length - 1].length > 1) {
      const prev = levels[levels.length - 1];
      const next = new Uint32Array(prev.length / 2);
      for (let i = 0; i < next.length; i++) next[i] = hash32(`${prev[2 * i]}|${prev[2 * i + 1]}`);
      levels.push(next);
    }
    return levels;
  };
  const a = build(false);
  const b = build(true);
  let comparisons = 0;
  const diffLeaves: number[] = [];
  const walk = (level: number, i: number) => {
    comparisons++;
    if (a[level][i] === b[level][i]) return;
    if (level === 0) return void diffLeaves.push(i);
    walk(level - 1, 2 * i);
    walk(level - 1, 2 * i + 1);
  };
  walk(a.length - 1, 0);
  const transferred = diffLeaves.length * Math.ceil(p.keys / leaves);
  return { comparisons, transferred, total: comparisons + transferred, diffLeaves: diffLeaves.length };
}

export const merkle: SimDef<MerkleP, MerkleR> = {
  id: "merkle",
  title: "Merkle tree repair",
  module: 19,
  lessons: ["19.5", "13.5"],
  blurb: "Two replicas of 100,000 keys differ in a few of them. Build real Merkle trees, walk only the mismatched branches, and count the hashes compared and keys sent.",
  params: [
    { key: "keys", label: "Keys per replica", type: "number", min: 1000, max: 500000, log: true },
    { key: "leavesPow", label: "Leaf ranges (2^x)", type: "number", min: 1, max: 16 },
    { key: "diffs", label: "Keys that differ", type: "number", min: 0, max: 1000, log: false },
  ],
  defaults: { keys: 100000, leavesPow: 2, diffs: 10 },
  run: runMerkle,
  metrics: (r) => ({ total: r.total, comparisons: r.comparisons, transferred: r.transferred }),
  metricSpecs: [
    { key: "comparisons", label: "Hashes compared", format: fmt.n },
    { key: "transferred", label: "Keys sent to repair", format: fmt.n },
    { key: "total", label: "Total work", format: fmt.n },
  ],
  View: ({ p, r }) => (
    <Note>
      {1 << p.leavesPow} leaf ranges of ~{Math.ceil(p.keys / (1 << p.leavesPow))} keys; {r.diffLeaves} ranges differ. Without a tree, finding the differences means exchanging all {p.keys.toLocaleString()} keys.
      More leaves mean less data sent but more hashes compared and stored - the sweet spot depends on how many keys usually differ.
    </Note>
  ),
};

/* ------------------------------------------------------------------ Token bucket */

type TbP = { capacity: number; refill: number; burst: number; abusiveRps: number };
interface TbR { legit: number; abusive: number; tokens: number[] }

export function runTokenBucket(p: TbP): TbR {
  const allow = (b: { tokens: number; last: number }, t: number) => {
    b.tokens = Math.min(p.capacity, b.tokens + (t - b.last) * p.refill);
    b.last = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    return false;
  };
  const events: { t: number; who: "legit" | "abuse" }[] = [];
  for (let s = 0; s < 60; s += 10) for (let i = 0; i < p.burst; i++) events.push({ t: s + i * 0.005, who: "legit" });
  for (let t = 0.5; t < 60; t += 1) events.push({ t, who: "legit" });
  for (let i = 0; i < 60 * p.abusiveRps; i++) events.push({ t: i / p.abusiveRps, who: "abuse" });
  events.sort((a, b) => a.t - b.t);
  const L = { tokens: p.capacity, last: 0 };
  const A = { tokens: p.capacity, last: 0 };
  let lOk = 0, lN = 0, aOk = 0, aN = 0;
  const tokens: number[] = [];
  let nextSample = 0;
  for (const e of events) {
    while (e.t >= nextSample && nextSample < 60) {
      tokens.push(Math.min(p.capacity, L.tokens + (nextSample - L.last) * p.refill));
      nextSample += 0.5;
    }
    if (e.who === "legit") {
      lN++;
      if (allow(L, e.t)) lOk++;
    } else {
      aN++;
      if (allow(A, e.t)) aOk++;
    }
  }
  return { legit: lN ? lOk / lN : 1, abusive: aN ? aOk / aN : 0, tokens };
}

export const tokenBucket: SimDef<TbP, TbR> = {
  id: "token-bucket",
  title: "Token bucket rate limiter",
  module: 19,
  lessons: ["19.10", "8.2", "8.3"],
  blurb: "A real app sends bursts of 20 requests every 10 s plus 1 per second; an abusive client sends 30 per second. Tune capacity and refill so the app always gets through and the abuser doesn't.",
  params: [
    { key: "capacity", label: "Bucket capacity (burst)", type: "number", min: 1, max: 60 },
    { key: "refill", label: "Refill rate", type: "number", min: 0.5, max: 40, step: 0.5, unit: "tokens/s" },
    { key: "burst", label: "App burst size", type: "number", min: 1, max: 50 },
    { key: "abusiveRps", label: "Abusive client rate", type: "number", min: 1, max: 100, unit: "req/s" },
  ],
  defaults: { capacity: 5, refill: 10, burst: 20, abusiveRps: 30 },
  run: runTokenBucket,
  metrics: (r) => ({ legit: r.legit, abusive: r.abusive }),
  metricSpecs: [
    { key: "legit", label: "App requests allowed", format: fmt.pct },
    { key: "abusive", label: "Abusive requests allowed", format: fmt.pct },
  ],
  View: ({ p, r }) => (
    <>
      <LineChart xStep={0.5} yLabel="tokens" series={[{ name: "App's bucket", color: "var(--accent)", values: r.tokens }]} yMax={p.capacity * 1.1} hLines={[{ y: p.burst, label: "burst size" }]} />
      <Note>Capacity sets how big a burst passes; the refill rate sets the long-run average. Each client has its own bucket, so the abuser can never get more than capacity + refill × time.</Note>
    </>
  ),
};

/* ------------------------------------------------------------------ Skip list */

type SlP = { n: number; prob: number };
interface SlR { avgSteps: number; levels: number; pointersPerNode: number; log2n: number }

export function runSkipList(p: SlP): SlR {
  const MAX = 32;
  const r = rng(12);
  const keys: number[] = [];
  const next: Int32Array[] = [];
  const head = new Int32Array(MAX).fill(-1);
  let level = 1;
  let pointers = 0;
  // build from keys inserted in random order
  const order = Array.from({ length: p.n }, (_, i) => i * 2);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const nxt = (node: number, l: number) => (node < 0 ? head[l] : next[node][l]);
  const setNxt = (node: number, l: number, v: number) => (node < 0 ? (head[l] = v) : (next[node][l] = v));
  for (const k of order) {
    let h = 1;
    while (h < MAX && r() < p.prob) h++;
    const id = keys.length;
    keys.push(k);
    next.push(new Int32Array(h).fill(-1));
    pointers += h;
    level = Math.max(level, h);
    let x = -1;
    for (let l = level - 1; l >= 0; l--) {
      while (nxt(x, l) >= 0 && keys[nxt(x, l)] < k) x = nxt(x, l);
      if (l < h) {
        setNxt(id, l, nxt(x, l));
        setNxt(x, l, id);
      }
    }
  }
  let steps = 0;
  const S = 2000;
  for (let s = 0; s < S; s++) {
    const target = Math.floor(r() * p.n) * 2;
    let x = -1;
    for (let l = level - 1; l >= 0; l--) {
      while (nxt(x, l) >= 0 && keys[nxt(x, l)] < target) {
        x = nxt(x, l);
        steps++;
      }
      steps++;
    }
  }
  return { avgSteps: steps / S, levels: level, pointersPerNode: pointers / p.n, log2n: Math.log2(p.n) };
}

export const skipList: SimDef<SlP, SlR> = {
  id: "skip-list",
  title: "Skip list",
  module: 19,
  lessons: ["19.12"],
  blurb: "Build a real skip list with coin-flip levels and measure how many steps a search takes as the list grows - the structure behind Redis sorted sets.",
  params: [
    { key: "n", label: "Elements", type: "number", min: 100, max: 500000, log: true },
    { key: "prob", label: "Promotion probability", type: "select", options: [{ value: 0.5, label: "1/2" }, { value: 0.25, label: "1/4 (Redis)" }] },
  ],
  defaults: { n: 100000, prob: 0.25 },
  run: runSkipList,
  metrics: (r) => ({ avgSteps: r.avgSteps, levels: r.levels, pointersPerNode: r.pointersPerNode }),
  metricSpecs: [
    { key: "avgSteps", label: "Steps per search", format: fmt.n },
    { key: "levels", label: "Levels", format: fmt.n },
    { key: "pointersPerNode", label: "Pointers per element", format: (v) => v.toFixed(2) },
  ],
  View: ({ p, r }) => (
    <Note>
      log₂({p.n.toLocaleString()}) = {r.log2n.toFixed(1)}. A linked list would need ~{fmt.n(p.n / 2)} steps per search; the skip list needs {fmt.n(r.avgSteps)} - and no rebalancing, just coin flips.
    </Note>
  ),
};
