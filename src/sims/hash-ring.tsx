import { hash32, zipf } from "./rng";
import { fmt, type SimDef } from "./types";
import { Bars, Note } from "./ui";

type P = { nodes: number; add: number; scheme: "modulo" | "ring" | "rendezvous"; vnodes: number; keys: number; skew: number; saltHot: boolean };

interface R {
  moved: number;
  imbalance: number;
  loads: number[];
}

function placer(scheme: P["scheme"], nodes: number, vnodes: number) {
  if (scheme === "modulo") return (k: string) => hash32(k) % nodes;
  if (scheme === "rendezvous")
    return (k: string) => {
      let best = 0;
      let bestScore = -1;
      for (let n = 0; n < nodes; n++) {
        const s = hash32(`${k}|n${n}`);
        if (s > bestScore) {
          bestScore = s;
          best = n;
        }
      }
      return best;
    };
  const points: { pos: number; node: number }[] = [];
  for (let n = 0; n < nodes; n++) for (let v = 0; v < vnodes; v++) points.push({ pos: hash32(`n${n}#${v}`), node: n });
  points.sort((a, b) => a.pos - b.pos);
  return (k: string) => {
    const h = hash32(k);
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].pos < h) lo = mid + 1;
      else hi = mid;
    }
    return points[lo % points.length].node;
  };
}

/** Real placement of `keys` keys before and after adding nodes; load weighted by Zipf popularity. */
export function runHashRing(p: P): R {
  const before = placer(p.scheme, p.nodes, p.vnodes);
  const after = placer(p.scheme, p.nodes + p.add, p.vnodes);
  const pop = zipf(p.keys, p.skew);
  const loads = new Array(p.nodes + p.add).fill(0);
  let moved = 0;
  const SALT = 16;
  for (let i = 0; i < p.keys; i++) {
    const key = `key:${i}`;
    if (after(key) !== before(key)) moved++;
    const w = pop.weight(i);
    if (p.saltHot && i < 10) for (let s = 0; s < SALT; s++) loads[after(`${key}#${s}`)] += w / SALT;
    else loads[after(key)] += w;
  }
  const avg = 1 / loads.length;
  return { moved: moved / p.keys, imbalance: Math.max(...loads) / avg, loads };
}

export const hashRing: SimDef<P, R> = {
  id: "hash-ring",
  title: "Consistent hashing",
  module: 14,
  lessons: ["14.2", "14.3", "19.1"],
  blurb: "Place real keys on nodes with modulo, a hash ring with virtual nodes, or rendezvous hashing. Add a node, then count moved keys and measure the load per node.",
  params: [
    { key: "nodes", label: "Nodes", type: "number", min: 2, max: 50 },
    { key: "add", label: "Nodes to add", type: "number", min: 0, max: 10 },
    { key: "scheme", label: "Placement", type: "select", options: [{ value: "modulo", label: "hash(key) % N" }, { value: "ring", label: "Consistent-hash ring" }, { value: "rendezvous", label: "Rendezvous (highest random weight)" }] },
    { key: "vnodes", label: "Virtual nodes per node (ring)", type: "number", min: 1, max: 512, log: true },
    { key: "keys", label: "Keys", type: "number", min: 1000, max: 50000, step: 1000 },
    { key: "skew", label: "Popularity skew (Zipf s, 0 = uniform)", type: "number", min: 0, max: 1.5, step: 0.05 },
    { key: "saltHot", label: "Salt the 10 hottest keys (split each over 16 sub-keys)", type: "toggle" },
  ],
  defaults: { nodes: 10, add: 1, scheme: "modulo", vnodes: 1, keys: 20000, skew: 0, saltHot: false },
  run: runHashRing,
  metrics: (r) => ({ moved: r.moved, imbalance: r.imbalance }),
  metricSpecs: [
    { key: "moved", label: "Keys moved", format: fmt.pct },
    { key: "imbalance", label: "Hottest node ÷ average", format: fmt.x },
  ],
  View: ({ p, r }) => (
    <>
      <p className="small muted">Share of traffic per node after adding {p.add} node(s) - new nodes on the right:</p>
      <Bars
        values={r.loads.map((v) => v * 100)}
        labels={r.loads.map((_, i) => (i >= p.nodes ? `+${i + 1}` : `${i + 1}`))}
        refLine={100 / r.loads.length}
        refLabel="fair share"
        yFormat={(v) => `${v.toFixed(1)}%`}
        color={(_, i) => (i >= p.nodes ? "var(--warm)" : "var(--accent)")}
      />
      <Note>
        Ideal movement when adding {p.add} node(s): {fmt.pct(p.add / (p.nodes + p.add))}. Modulo remaps almost every key; a ring or rendezvous hashing moves only the new nodes' share.
        Hashing spreads <i>keys</i> evenly - it can't fix one key being far more popular than the rest.
      </Note>
    </>
  ),
};
