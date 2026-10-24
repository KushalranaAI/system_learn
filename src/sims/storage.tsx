import { MEASURED } from "../state/profile";
import { lognormal, percentile, rng } from "./rng";
import { fmt, type SimDef } from "./types";
import { Bars, LineChart, Note } from "./ui";

/* ------------------------------------------------------------------ LSM tree vs B-tree */

type LsmP = { keys: number; pattern: "random" | "sequential"; btreeCacheMB: number; memtableMB: number; fanout: number; bloom: boolean };
interface LsmR { btreeWA: number; lsmWA: number; btreeReadIO: number; lsmReadIO: number; files: number; levels: number[] }

const RECORD = 100;
const PAGE = 8192;

export function runLsmBtree(p: LsmP): LsmR {
  const r = rng(8);
  const N = p.keys;
  // ---- B-tree: leaves are 70% full 8 KB pages, cached in an LRU buffer pool; dirty pages are written on eviction.
  const perPage = Math.floor((PAGE / RECORD) * 0.7);
  const leaves = Math.max(1, Math.ceil(N / perPage));
  const cacheSize = Math.max(1, Math.floor((p.btreeCacheMB * 1024 * 1024) / PAGE));
  const lru = new Map<number, boolean>();
  let pageWrites = 0;
  for (let i = 0; i < N; i++) {
    const leaf = p.pattern === "random" ? Math.floor(r() * leaves) : Math.floor(i / perPage);
    if (lru.has(leaf)) lru.delete(leaf);
    lru.set(leaf, true);
    if (lru.size > cacheSize) {
      const oldest = lru.keys().next().value as number;
      lru.delete(oldest);
      pageWrites++;
    }
  }
  pageWrites += lru.size; // checkpoint at the end
  let misses = 0;
  for (let i = 0; i < 2000; i++) if (!lru.has(Math.floor(r() * leaves))) misses++;
  const wal = N * RECORD;
  const btreeWA = (pageWrites * PAGE + wal) / (N * RECORD);

  // ---- LSM: memtable flushes to L0; 4 L0 files compact into L1; level i holds fanout^i memtables; full levels merge down.
  const mem = Math.max(1, Math.floor((p.memtableMB * 1024 * 1024) / RECORD));
  const levels: number[] = [0]; // entries per level (L1..)
  let l0 = 0;
  let written = wal;
  for (let done = 0; done < N; done += mem) {
    const batch = Math.min(mem, N - done);
    written += batch * RECORD; // flush
    l0++;
    if (l0 >= 4) {
      written += (levels[0] + 4 * mem) * RECORD;
      levels[0] += 4 * mem;
      l0 = 0;
      for (let i = 0; i < levels.length; i++) {
        const cap = mem * 4 * Math.pow(p.fanout, i + 1);
        if (levels[i] > cap) {
          if (levels[i + 1] === undefined) levels.push(0);
          written += (levels[i] + levels[i + 1]) * RECORD;
          levels[i + 1] += levels[i];
          levels[i] = 0;
        }
      }
    }
  }
  const files = l0 + levels.filter((x) => x > 0).length;
  const lsmReadIO = p.bloom ? 1 + 0.01 * Math.max(0, files - 1) : (files + 1) / 2;
  return { btreeWA, lsmWA: written / (N * RECORD), btreeReadIO: misses / 2000, lsmReadIO, files, levels: [l0 * mem, ...levels] };
}

export const lsmBtree: SimDef<LsmP, LsmR> = {
  id: "lsm-btree",
  title: "LSM tree vs B-tree",
  module: 19,
  lessons: ["19.8"],
  blurb: "Insert real keys into a B-tree with a buffer pool and into an LSM tree with flushes and compactions. Measure how many bytes each writes per byte of data, and how many disk reads a lookup costs.",
  params: [
    { key: "keys", label: "Keys inserted", type: "number", min: 10000, max: 1000000, log: true },
    { key: "pattern", label: "Key order", type: "select", options: [{ value: "random", label: "Random (UUIDs, hashes)" }, { value: "sequential", label: "Sequential (timestamps, auto-increment)" }] },
    { key: "btreeCacheMB", label: "B-tree buffer pool", type: "number", min: 1, max: 256, log: true, unit: "MB" },
    { key: "memtableMB", label: "LSM memtable", type: "number", min: 1, max: 64, unit: "MB" },
    { key: "fanout", label: "LSM level size ratio", type: "number", min: 2, max: 20 },
    { key: "bloom", label: "Bloom filter on every LSM file", type: "toggle" },
  ],
  defaults: { keys: 1000000, pattern: "random", btreeCacheMB: 8, memtableMB: 1, fanout: 4, bloom: false },
  run: runLsmBtree,
  metrics: (r) => ({ btreeWA: r.btreeWA, lsmWA: r.lsmWA, btreeReadIO: r.btreeReadIO, lsmReadIO: r.lsmReadIO }),
  metricSpecs: [
    { key: "btreeWA", label: "B-tree write amplification", format: fmt.x },
    { key: "lsmWA", label: "LSM write amplification", format: fmt.x },
    { key: "btreeReadIO", label: "B-tree disk reads / lookup", format: (v) => v.toFixed(2) },
    { key: "lsmReadIO", label: "LSM disk reads / lookup", format: (v) => v.toFixed(2) },
  ],
  View: ({ r }) => (
    <>
      <p className="small muted">LSM data per level (L0 → deepest) after all inserts:</p>
      <Bars values={r.levels.map((x) => x / 1000)} labels={r.levels.map((_, i) => `L${i}`)} yFormat={(v) => `${Math.round(v)}k keys`} />
      <Note>
        Write amplification = bytes written to disk ÷ bytes of data. A B-tree rewrites a whole 8 KB page for a 100-byte change when the page isn't in memory;
        an LSM appends in big sequential batches but rewrites data again at each compaction level. Lookups in an LSM may check several files.
      </Note>
    </>
  ),
};

/* ------------------------------------------------------------------ Write-ahead log & group commit */

type WalP = { clients: number; fsyncMs: number; mode: "each" | "group" | "async"; windowMs: number };
interface WalR { commitsPerSec: number; p99: number; lostOnCrash: number; latencies: number[]; batch: number }

export function runWal(p: WalP): WalR {
  const r = rng(13);
  const CPU = 0.02; // ms of CPU per commit
  const issued: number[] = Array(p.clients).fill(0);
  const lat: number[] = [];
  let t = 0;
  let commits = 0;
  let batches = 0;
  if (p.mode === "async") {
    const thr = 1000 / CPU; // CPU-bound: no disk wait at all
    for (let i = 0; i < 4000; i++) lat.push(CPU * (1 + r()));
    return { commitsPerSec: thr, p99: percentile(lat, 0.99), lostOnCrash: thr * 0.1, latencies: lat, batch: 1 };
  }
  const queue = Array.from({ length: p.clients }, (_, i) => i); // clients waiting with a commit ready
  while (t < 1000) {
    if (p.mode === "each") {
      const c = queue.shift()!;
      t += lognormal(r, p.fsyncMs, p.fsyncMs * 3) + CPU;
      lat.push(t - issued[c]);
      issued[c] = t;
      queue.push(c);
      commits++;
      batches++;
    } else {
      t += p.windowMs;
      const batch = queue.splice(0, queue.length);
      t += lognormal(r, p.fsyncMs, p.fsyncMs * 3) + CPU * batch.length;
      for (const c of batch) {
        lat.push(t - issued[c]);
        issued[c] = t;
      }
      queue.push(...batch);
      commits += batch.length;
      batches++;
    }
  }
  return { commitsPerSec: commits / (t / 1000), p99: percentile(lat, 0.99), lostOnCrash: 0, latencies: lat.slice(0, 400), batch: commits / Math.max(1, batches) };
}

const measuredFsync = MEASURED?.raw?.fsync?.p50 ? Math.max(0.05, Math.round(MEASURED.raw.fsync.p50 * 100) / 100) : 2;

export const wal: SimDef<WalP, WalR> = {
  id: "wal",
  title: "Write-ahead log and group commit",
  module: 19,
  lessons: ["19.13", "5.5"],
  blurb: "Clients commit transactions to a write-ahead log on disk. fsync each commit alone, batch many commits into one fsync (group commit), or skip fsync - and see throughput, latency and what a crash would lose.",
  params: [
    { key: "clients", label: "Concurrent clients", type: "number", min: 1, max: 256, log: true },
    { key: "fsyncMs", label: "fsync time (disk)", type: "number", min: 0.05, max: 20, step: 0.05, unit: "ms", hint: MEASURED ? `Your machine measured ${measuredFsync} ms (My machine page).` : "Run the benchmark on the My machine page to use your disk's real number." },
    { key: "mode", label: "Commit strategy", type: "select", options: [{ value: "each", label: "fsync every commit alone" }, { value: "group", label: "Group commit (one fsync per batch)" }, { value: "async", label: "No fsync before acknowledging (async)" }] },
    { key: "windowMs", label: "Group window (wait to collect commits)", type: "number", min: 0, max: 10, step: 0.5, unit: "ms" },
  ],
  defaults: { clients: 64, fsyncMs: measuredFsync, mode: "each", windowMs: 0.5 },
  run: runWal,
  metrics: (r) => ({ commitsPerSec: r.commitsPerSec, p99: r.p99, lostOnCrash: r.lostOnCrash }),
  metricSpecs: [
    { key: "commitsPerSec", label: "Durable commits/s", format: fmt.n },
    { key: "p99", label: "p99 commit latency", format: (v) => `${v.toFixed(v < 10 ? 2 : 0)} ms` },
    { key: "lostOnCrash", label: "Acknowledged commits a crash would lose", format: fmt.n },
  ],
  View: ({ r }) => (
    <>
      <LineChart xLabel="commit #" yLabel="latency (ms)" yFormat={(v) => v.toFixed(1)} series={[{ name: "Commit latency", color: "var(--accent)", values: r.latencies.slice(0, 200) }]} />
      <Note>Average batch: {r.batch.toFixed(1)} commits per fsync. One fsync costs about the same whether it covers 1 commit or 100 - group commit shares it.</Note>
    </>
  ),
};
