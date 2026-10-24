import { rng, zipf } from "./rng";
import { fmt, type SimDef } from "./types";
import { LineChart, Note } from "./ui";

type P = {
  rps: number;
  keys: number;
  ttlSec: number;
  jitterPct: number;
  coalesce: boolean;
  staleWhileRevalidate: boolean;
  dbCapacity: number;
  coldRestart: boolean;
};

interface R {
  dbLoad: number[];
  failed: number[];
  peak: number;
  failedPct: number;
  stalePct: number;
}

const T = 300; // seconds
const DT = 0.1; // 100 ms ticks
const RESTART_AT = 150;

/**
 * A cache in front of a database. Every key expires after its TTL (plus random jitter). An expired key needs a
 * database query to refill; until it's refilled, requests for it either all go to the database (no protection),
 * wait for one in-flight query (coalescing), or get the stale value while one query refreshes it (stale-while-
 * revalidate). The database answers up to its capacity per second; queries beyond that fail and are retried.
 */
export function runStampede(p: P): R {
  const r = rng(3);
  const z = zipf(p.keys, 0.9);
  const ttl = () => p.ttlSec * (1 + (p.jitterPct / 100) * (r() * 2 - 1));
  const expires = Array.from({ length: p.keys }, () => ttl());
  const present = new Array(p.keys).fill(true);
  const refillAt = new Array(p.keys).fill(-1); // when an in-flight query completes
  const dbLoad: number[] = [];
  const failedS: number[] = [];
  let failed = 0;
  let total = 0;
  let stale = 0;
  let secLoad = 0;
  let secFail = 0;
  const capPerTick = p.dbCapacity * DT;
  for (let step = 0; step < T / DT; step++) {
    const now = step * DT;
    if (p.coldRestart && Math.abs(now - RESTART_AT) < DT / 2) for (let k = 0; k < p.keys; k++) { present[k] = false; refillAt[k] = -1; }
    let queries = 0;
    const want: { k: number; n: number; staleOk: boolean }[] = [];
    for (let k = 0; k < p.keys; k++) {
      const reqs = p.rps * DT * z.weight(k);
      total += reqs;
      if (refillAt[k] >= 0 && now >= refillAt[k]) {
        present[k] = true;
        expires[k] = now + ttl();
        refillAt[k] = -1;
      }
      const fresh = present[k] && now < expires[k];
      if (fresh) continue;
      const hasStale = present[k];
      if (refillAt[k] >= 0) {
        // a refresh is already in flight
        if (p.staleWhileRevalidate && hasStale) stale += reqs;
        else if (!p.coalesce) want.push({ k, n: reqs, staleOk: false });
        continue;
      }
      if (p.staleWhileRevalidate && hasStale) {
        stale += reqs;
        want.push({ k, n: 1, staleOk: true });
      } else if (p.coalesce) want.push({ k, n: 1, staleOk: false });
      else want.push({ k, n: reqs, staleOk: false });
    }
    queries = want.reduce((a, w) => a + w.n, 0);
    const ok = queries > 0 ? Math.min(1, capPerTick / queries) : 1;
    const latency = 0.02 / (1 - Math.min(0.95, queries / capPerTick)); // seconds to refill
    for (const w of want) {
      if (r() < ok) {
        // only the first successful query starts the refill; duplicates just add load
        if (refillAt[w.k] < 0) refillAt[w.k] = now + latency;
      }
      else if (!w.staleOk) {
        const lost = w.n === 1 ? p.rps * DT * z.weight(w.k) : w.n * (1 - ok);
        failed += lost;
        secFail += lost;
      }
    }
    secLoad += Math.min(queries, capPerTick * 3);
    if ((step + 1) % Math.round(1 / DT) === 0) {
      dbLoad.push(secLoad);
      failedS.push(secFail);
      secLoad = 0;
      secFail = 0;
    }
  }
  return { dbLoad, failed: failedS, peak: Math.max(...dbLoad) / p.dbCapacity, failedPct: failed / total, stalePct: stale / total };
}

export const cacheStampede: SimDef<P, R> = {
  id: "cache-stampede",
  title: "Cache stampedes, TTLs and cold starts",
  module: 3,
  lessons: ["3.6", "3.4", "3.8"],
  blurb: "20,000 reads/s over 1,000 hot keys, cached for 60 s. Watch what the database sees when keys expire together or the cache restarts empty - then fix it with jitter, coalescing and stale-while-revalidate.",
  params: [
    { key: "rps", label: "Reads per second", type: "number", min: 1000, max: 100000, log: true },
    { key: "keys", label: "Hot keys", type: "number", min: 100, max: 5000, log: true },
    { key: "ttlSec", label: "TTL", type: "number", min: 5, max: 300, step: 5, unit: "s" },
    { key: "jitterPct", label: "TTL jitter (±)", type: "number", min: 0, max: 50, unit: "%" },
    { key: "coalesce", label: "Coalesce misses (one query per key)", type: "toggle" },
    { key: "staleWhileRevalidate", label: "Serve stale while refreshing", type: "toggle" },
    { key: "dbCapacity", label: "Database capacity", type: "number", min: 500, max: 20000, step: 500, unit: "queries/s" },
    { key: "coldRestart", label: `Cache restarts empty at t=${RESTART_AT} s`, type: "toggle" },
  ],
  defaults: { rps: 20000, keys: 1000, ttlSec: 60, jitterPct: 0, coalesce: false, staleWhileRevalidate: false, dbCapacity: 3000, coldRestart: false },
  run: runStampede,
  metrics: (r) => ({ peak: r.peak, failedPct: r.failedPct, stalePct: r.stalePct }),
  metricSpecs: [
    { key: "peak", label: "Peak DB load ÷ capacity", format: fmt.x },
    { key: "failedPct", label: "Requests failed", format: fmt.pct2 },
    { key: "stalePct", label: "Served slightly stale", format: fmt.pct2 },
  ],
  View: ({ p, r }) => (
    <>
      <LineChart
        yLabel="queries/s"
        yFormat={fmt.n}
        series={[
          { name: "Database queries", color: "var(--warm)", values: r.dbLoad },
          { name: "Failed requests", color: "var(--bad)", values: r.failed },
        ]}
        hLines={[{ y: p.dbCapacity, label: "DB capacity" }]}
        markers={p.coldRestart ? [{ x: RESTART_AT, label: "cache restart" }] : []}
      />
      <Note>
        Keys cached at the same moment expire at the same moment - every {p.ttlSec} s. Without protection every waiting request becomes a database query (a stampede);
        coalescing turns each key's misses into one query; stale-while-revalidate keeps serving the old value while one query refreshes it.
      </Note>
    </>
  ),
};
