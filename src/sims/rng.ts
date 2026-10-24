/** Small, fast, seeded PRNG (mulberry32): every simulation run is reproducible. */
export function rng(seed = 42): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = () => number;

export const expo = (r: Rand, mean: number) => -Math.log(1 - r()) * mean;

export function gauss(r: Rand): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Lognormal latency described the way engineers talk about it: by p50 and p99. */
export function lognormal(r: Rand, p50: number, p99: number): number {
  const mu = Math.log(p50);
  const sigma = Math.max(1e-6, (Math.log(p99) - mu) / 2.3263);
  return Math.exp(mu + sigma * gauss(r));
}

/** Zipf(s) sampler over n items (index 0 is the most popular). */
export function zipf(n: number, s: number): { sample: (r: Rand) => number; weight: (i: number) => number } {
  const w = Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, s));
  const total = w.reduce((a, b) => a + b, 0);
  const cdf: number[] = [];
  let acc = 0;
  for (const x of w) cdf.push((acc += x / total));
  return {
    weight: (i) => w[i] / total,
    sample: (r) => {
      const u = r();
      let lo = 0;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid] < u) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
  };
}

export function percentile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/** 32-bit string hash (FNV-1a) with a murmur3 finaliser for good bit mixing. */
export function hash32(s: string, seed = 0): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
