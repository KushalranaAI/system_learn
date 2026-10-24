import { rng } from "./rng";
import { fmt, type SimDef } from "./types";
import { Bars, Note } from "./ui";

/* ------------------------------------------------------------------ Geohash */

const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
export function geohash(lat: number, lng: number, precision: number): string {
  let latLo = -90, latHi = 90, lngLo = -180, lngHi = 180;
  let hash = "";
  let bits = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; lngLo = mid; } else { ch <<= 1; lngHi = mid; }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latLo = mid; } else { ch <<= 1; latHi = mid; }
    }
    even = !even;
    if (++bits === 5) {
      hash += B32[ch];
      bits = 0;
      ch = 0;
    }
  }
  return hash;
}

function cellSize(precision: number) {
  const bits = 5 * precision;
  const lngBits = Math.ceil(bits / 2);
  const latBits = Math.floor(bits / 2);
  return { dLat: 180 / 2 ** latBits, dLng: 360 / 2 ** lngBits };
}

const km = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

type GeoP = { drivers: number; radiusKm: number; precision: number; mode: "scan" | "cell" | "neighbors" };
interface GeoR { recall: number; scanned: number; cellKm: { w: number; h: number }; perQuery: number[] }

const BOX = { lat: [12.85, 13.15], lng: [77.45, 77.75] }; // ~33 × 33 km city

export function runGeo(p: GeoP): GeoR {
  const r = rng(9);
  const pts = Array.from({ length: p.drivers }, () => ({ lat: BOX.lat[0] + r() * (BOX.lat[1] - BOX.lat[0]), lng: BOX.lng[0] + r() * (BOX.lng[1] - BOX.lng[0]) }));
  const index = new Map<string, number[]>();
  pts.forEach((pt, i) => {
    const h = geohash(pt.lat, pt.lng, p.precision);
    (index.get(h) ?? index.set(h, []).get(h)!).push(i);
  });
  const { dLat, dLng } = cellSize(p.precision);
  let found = 0;
  let truth = 0;
  let scanned = 0;
  const perQuery: number[] = [];
  const Q = 200;
  for (let q = 0; q < Q; q++) {
    const lat = BOX.lat[0] + 0.1 * (BOX.lat[1] - BOX.lat[0]) + r() * 0.8 * (BOX.lat[1] - BOX.lat[0]);
    const lng = BOX.lng[0] + 0.1 * (BOX.lng[1] - BOX.lng[0]) + r() * 0.8 * (BOX.lng[1] - BOX.lng[0]);
    let cands: number[];
    if (p.mode === "scan") cands = pts.map((_, i) => i);
    else {
      const cells = new Set<string>([geohash(lat, lng, p.precision)]);
      if (p.mode === "neighbors") for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) cells.add(geohash(lat + a * dLat, lng + b * dLng, p.precision));
      cands = [...cells].flatMap((c) => index.get(c) ?? []);
    }
    scanned += cands.length;
    perQuery.push(cands.length);
    for (const i of cands) if (km(lat, lng, pts[i].lat, pts[i].lng) <= p.radiusKm) found++;
    for (const pt of pts) if (km(lat, lng, pt.lat, pt.lng) <= p.radiusKm) truth++;
  }
  return {
    recall: truth ? found / truth : 1,
    scanned: scanned / (Q * p.drivers),
    cellKm: { w: dLng * 111 * Math.cos((13 * Math.PI) / 180), h: dLat * 111 },
    perQuery,
  };
}

export const geohashSim: SimDef<GeoP, GeoR> = {
  id: "geohash",
  title: "Geohash: find drivers nearby",
  module: 19,
  lessons: ["19.9"],
  blurb: "Thousands of drivers across a city. Find everyone within a radius of 200 random riders - by scanning all drivers, by geohash cell, or by cell plus its 8 neighbours - and measure accuracy vs work.",
  params: [
    { key: "drivers", label: "Drivers in the city", type: "number", min: 1000, max: 50000, log: true },
    { key: "radiusKm", label: "Search radius", type: "number", min: 0.2, max: 5, step: 0.1, unit: "km" },
    { key: "precision", label: "Geohash precision (characters)", type: "number", min: 3, max: 8 },
    { key: "mode", label: "Search", type: "select", options: [{ value: "scan", label: "Scan every driver" }, { value: "cell", label: "Only the rider's cell" }, { value: "neighbors", label: "Cell + 8 neighbours" }] },
  ],
  defaults: { drivers: 20000, radiusKm: 2, precision: 6, mode: "scan" },
  run: runGeo,
  metrics: (r) => ({ recall: r.recall, scanned: r.scanned }),
  metricSpecs: [
    { key: "recall", label: "Nearby drivers found", format: fmt.pct },
    { key: "scanned", label: "Drivers checked per query", format: fmt.pct },
  ],
  View: ({ p, r }) => (
    <>
      <p className="small muted">Drivers checked for the first 40 queries:</p>
      <Bars values={r.perQuery.slice(0, 40)} yFormat={fmt.n} />
      <Note>
        At precision {p.precision} a cell is about {r.cellKm.w.toFixed(2)} × {r.cellKm.h.toFixed(2)} km. A rider near a cell edge has neighbours in the next cell - and if the cell is smaller than the
        search radius, even the 8 neighbours miss some. Pick the precision whose cell is at least as big as the radius, then add neighbours.
      </Note>
    </>
  ),
};

/* ------------------------------------------------------------------ Snowflake IDs */

type SfP = { workers: number; ratePerWorkerK: number; seqBits: number; workerIds: "assigned" | "random"; clockJump: boolean; onBackwards: "ignore" | "wait" };
interface SfR { duplicates: number; avgWaitMs: number; collisionRisk: number; perMsCap: number; generated: number }

export function runSnowflake(p: SfP): SfR {
  const r = rng(21);
  const workerBits = 22 - p.seqBits;
  const space = 2 ** workerBits;
  const ids = p.workerIds === "assigned" ? Array.from({ length: p.workers }, (_, i) => i % space) : Array.from({ length: p.workers }, () => Math.floor(r() * space));
  const cap = 2 ** p.seqBits;
  const perMs = (p.ratePerWorkerK * 1000) / 1000;
  const used = new Map<string, number>();
  let dup = 0;
  let waitMsTotal = 0;
  let generated = 0;
  const MS = 400;
  ids.forEach((wid, w) => {
    let carry = 0;
    for (let ms = 0; ms < MS; ms++) {
      // worker 0's clock jumps back 5 ms at t=200 ms (an NTP correction)
      let clock = ms;
      if (p.clockJump && w === 0 && ms >= 200 && ms < 205) {
        if (p.onBackwards === "wait") {
          carry += perMs;
          waitMsTotal += perMs * (205 - ms);
          continue;
        }
        clock = ms - 5;
      }
      const want = perMs + carry;
      const n = Math.min(want, cap);
      carry = want - n;
      waitMsTotal += carry;
      const key = `${wid}:${clock}`;
      const prev = used.get(key) ?? 0;
      dup += Math.min(prev, n);
      used.set(key, Math.max(prev, n));
      generated += n;
    }
  });
  let noCollision = 1;
  for (let i = 0; i < p.workers; i++) noCollision *= Math.max(0, 1 - i / space);
  return {
    duplicates: Math.round(dup),
    avgWaitMs: generated ? waitMsTotal / generated : 0,
    collisionRisk: p.workerIds === "random" ? 1 - noCollision : 0,
    perMsCap: cap,
    generated,
  };
}

export const snowflake: SimDef<SfP, SfR> = {
  id: "snowflake",
  title: "Snowflake IDs",
  module: 19,
  lessons: ["19.11", "12.6"],
  blurb: "Many servers generate 64-bit IDs (time | worker | sequence) with no coordination. Push the rate, shrink the sequence bits, pick worker ids at random, and make one clock jump backwards - then count duplicate IDs.",
  params: [
    { key: "workers", label: "ID generators (servers)", type: "number", min: 1, max: 128 },
    { key: "ratePerWorkerK", label: "IDs per server", type: "number", min: 1, max: 2000, log: true, unit: "k/s" },
    { key: "seqBits", label: "Sequence bits (IDs per ms per worker = 2^bits)", type: "number", min: 4, max: 16 },
    { key: "workerIds", label: "Worker ids", type: "select", options: [{ value: "assigned", label: "Assigned uniquely (config / lease)" }, { value: "random", label: "Picked at random on boot" }] },
    { key: "clockJump", label: "One server's clock jumps back 5 ms", type: "toggle" },
    { key: "onBackwards", label: "When the clock goes backwards", type: "select", options: [{ value: "ignore", label: "Keep generating" }, { value: "wait", label: "Wait until time passes the last ID" }] },
  ],
  defaults: { workers: 32, ratePerWorkerK: 200, seqBits: 6, workerIds: "random", clockJump: true, onBackwards: "ignore" },
  run: runSnowflake,
  metrics: (r) => ({ duplicates: r.duplicates, avgWaitMs: r.avgWaitMs, collisionRisk: r.collisionRisk }),
  metricSpecs: [
    { key: "duplicates", label: "Duplicate IDs", format: fmt.n },
    { key: "avgWaitMs", label: "Avg wait for an ID", format: (v) => `${v.toFixed(2)} ms` },
    { key: "collisionRisk", label: "Chance two servers share a worker id", format: fmt.pct },
  ],
  View: ({ p, r }) => (
    <Note>
      Layout: 41 bits of milliseconds | {22 - p.seqBits} worker bits ({(2 ** (22 - p.seqBits)).toLocaleString()} worker ids) | {p.seqBits} sequence bits ({r.perMsCap.toLocaleString()} IDs per ms per worker).
      Each server wants {p.ratePerWorkerK} IDs per ms. Duplicates come from two servers sharing a worker id, or from a clock that repeats milliseconds it already used.
    </Note>
  ),
};
