import { expo, rng } from "./rng";
import { fmt, type SimDef } from "./types";
import { Bars, Note } from "./ui";

type P = { n: number; w: number; r: number; down: number; lagMs: number; readAfterMs: number };

interface R {
  stale: number;
  writeAvail: number;
  readAvail: number;
  freshnessByDelay: number[];
}

const TRIALS = 20_000;

/**
 * Leaderless replication with N replicas. A write is acknowledged once W live replicas have it; the other live
 * replicas receive it after an exponential replication delay. A read, `readAfterMs` later, asks R random live
 * replicas and returns the newest version it sees - stale if none of them has the write yet.
 */
export function runQuorum(p: P): R {
  const rand = rng(13);
  const alive = Math.max(0, p.n - p.down);
  let writes = 0;
  let writeOk = 0;
  let reads = 0;
  let readOk = 0;
  let stale = 0;
  const delays = [0, 5, 10, 25, 50, 100, 200];
  const freshByDelay = delays.map(() => 0);
  const freshTotal = delays.map(() => 0);
  for (let i = 0; i < TRIALS; i++) {
    writes++;
    if (alive < p.w) continue;
    writeOk++;
    // arrival time of the write at each live replica (0 for the W that acknowledged)
    const idx = Array.from({ length: alive }, (_, k) => k).sort(() => rand() - 0.5);
    const arrival = new Array(alive).fill(0).map((_, k) => (k < p.w ? 0 : expo(rand, p.lagMs)));
    const at = idx.map((k) => arrival[k]);
    reads++;
    if (alive < p.r) continue;
    readOk++;
    const picks = Array.from({ length: alive }, (_, k) => k).sort(() => rand() - 0.5).slice(0, p.r);
    if (!picks.some((k) => at[k] <= p.readAfterMs)) stale++;
    delays.forEach((d, j) => {
      freshTotal[j]++;
      if (picks.some((k) => at[k] <= d)) freshByDelay[j]++;
    });
  }
  return {
    stale: readOk ? stale / readOk : 1,
    writeAvail: writes ? writeOk / writes : 0,
    readAvail: reads ? readOk / reads : 0,
    freshnessByDelay: freshByDelay.map((f, j) => (freshTotal[j] ? 1 - f / freshTotal[j] : 1)),
  };
}

export const quorum: SimDef<P, R> = {
  id: "quorum",
  title: "Quorum reads and writes",
  module: 13,
  lessons: ["13.5", "13.6", "14.6"],
  blurb: "N replicas, W write acks, R read replies, some nodes down, async replication lag. Measure stale reads and availability over 20,000 trials.",
  params: [
    { key: "n", label: "Replicas (N)", type: "number", min: 1, max: 7 },
    { key: "w", label: "Write quorum (W)", type: "number", min: 1, max: 7 },
    { key: "r", label: "Read quorum (R)", type: "number", min: 1, max: 7 },
    { key: "down", label: "Replicas down", type: "number", min: 0, max: 4 },
    { key: "lagMs", label: "Replication lag (mean)", type: "number", min: 1, max: 500, unit: "ms" },
    { key: "readAfterMs", label: "Read happens after the write", type: "number", min: 0, max: 500, unit: "ms" },
  ],
  defaults: { n: 3, w: 1, r: 1, down: 0, lagMs: 50, readAfterMs: 10 },
  run: runQuorum,
  metrics: (r) => ({ stale: r.stale, writeAvail: r.writeAvail, readAvail: r.readAvail }),
  metricSpecs: [
    { key: "stale", label: "Stale reads", format: fmt.pct2 },
    { key: "writeAvail", label: "Write availability", format: fmt.pct },
    { key: "readAvail", label: "Read availability", format: fmt.pct },
  ],
  View: ({ p, r }) => (
    <>
      <div className="chain">
        {Array.from({ length: p.n }, (_, i) => (
          <span key={i} className={`svc${i >= p.n - p.down ? " off" : " crit"}`}>{i >= p.n - p.down ? "✕ down" : `replica ${i + 1}`}</span>
        ))}
      </div>
      <p className="small muted">Stale-read rate if the read happens this long after the write:</p>
      <Bars values={r.freshnessByDelay.map((v) => v * 100)} labels={["0ms", "5ms", "10ms", "25ms", "50ms", "100ms", "200ms"]} yFormat={(v) => `${v.toFixed(0)}%`} color={(v) => (v < 0.1 ? "var(--good)" : v < 5 ? "var(--warm)" : "var(--bad)")} />
      <Note>
        W + R = {p.w + p.r} {p.w + p.r > p.n ? ">" : "≤"} N = {p.n}: {p.w + p.r > p.n ? "every read set overlaps every write set, so reads see the latest acknowledged write." : "read and write sets may not overlap, so reads can miss recent writes."}
        {" "}Writes need {p.w} and reads need {p.r} of the {p.n - p.down} live replicas.
      </Note>
    </>
  ),
};
