import { expo, rng } from "./rng";
import { fmt, type SimDef } from "./types";
import { LineChart, Note } from "./ui";

type P = {
  rate: number;
  windowSec: number;
  mode: "processing" | "event";
  watermarkSec: number;
  latenessSec: number;
  latePct: number;
  maxLateSec: number;
};

interface R {
  truth: number[];
  first: number[];
  final: number[];
  firstAccuracy: number;
  finalAccuracy: number;
  latency: number;
  dropped: number;
}

const DURATION = 900;

/**
 * Events happen at a varying rate (event time): a slow wave plus a spike. Most arrive within ~0.5 s; `latePct` of them arrive up to
 * `maxLateSec` late (phones offline, partitions lagging). Windows are counted by processing time, or by event
 * time with a watermark (the first result is emitted `watermarkSec` after the window ends) and allowed lateness
 * (late events within that time correct the result; later ones are dropped).
 */
export function runEventWindows(p: P): R {
  const r = rng(17);
  const nWin = Math.floor(DURATION / p.windowSec);
  const truth = new Array(nWin).fill(0);
  const first = new Array(nWin).fill(0);
  const final = new Array(nWin).fill(0);
  let dropped = 0;
  let total = 0;
  // traffic varies: a slow wave plus a 3x spike between 420 s and 480 s
  const rateAt = (sec: number) => p.rate * (1 + 0.6 * Math.sin((2 * Math.PI * sec) / 240)) * (sec >= 420 && sec < 480 ? 3 : 1);
  const times: number[] = [];
  for (let sec = 0; sec < DURATION; sec++) {
    const k = Math.round(rateAt(sec));
    for (let j = 0; j < k; j++) times.push(sec + r());
  }
  for (const et of times) {
    const delay = r() < p.latePct / 100 ? r() * p.maxLateSec : expo(r, 0.5);
    const at = et + delay;
    const w = Math.floor(et / p.windowSec);
    if (w >= nWin) continue;
    truth[w]++;
    total++;
    if (p.mode === "processing") {
      const pw = Math.floor(at / p.windowSec);
      if (pw < nWin) {
        first[pw]++;
        final[pw]++;
      }
      continue;
    }
    const end = (w + 1) * p.windowSec;
    if (at <= end + p.watermarkSec) first[w]++;
    if (at <= end + p.watermarkSec + p.latenessSec) final[w]++;
    else dropped++;
  }
  const acc = (xs: number[]) => {
    let err = 0;
    let sum = 0;
    // ignore the last window (incomplete at the end of the run)
    for (let i = 0; i < nWin - 1; i++) {
      err += Math.abs(xs[i] - truth[i]);
      sum += truth[i];
    }
    return sum ? 1 - err / sum : 1;
  };
  return {
    truth, first, final,
    firstAccuracy: acc(first),
    finalAccuracy: acc(final),
    latency: p.mode === "processing" ? 0 : p.watermarkSec,
    dropped: total ? dropped / total : 0,
  };
}

export const eventWindows: SimDef<P, R> = {
  id: "event-windows",
  title: "Windows, watermarks and late events",
  module: 17,
  lessons: ["17.4", "17.5", "17.6"],
  blurb: "Count events per minute from a stream where 10% arrive up to 2 minutes late. Compare processing time with event time, and tune the watermark and allowed lateness.",
  params: [
    { key: "rate", label: "Events per second", type: "number", min: 10, max: 2000, log: true },
    { key: "windowSec", label: "Window size", type: "number", min: 10, max: 300, step: 10, unit: "s" },
    { key: "mode", label: "Assign events to windows by", type: "select", options: [{ value: "processing", label: "Processing time (when they arrive)" }, { value: "event", label: "Event time (when they happened)" }] },
    { key: "watermarkSec", label: "Watermark delay (first result after window end)", type: "number", min: 0, max: 300, unit: "s" },
    { key: "latenessSec", label: "Allowed lateness (corrections)", type: "number", min: 0, max: 300, step: 5, unit: "s" },
    { key: "latePct", label: "Events that arrive late", type: "number", min: 0, max: 50, unit: "%" },
    { key: "maxLateSec", label: "Latest arrival", type: "number", min: 10, max: 600, step: 10, unit: "s" },
  ],
  defaults: { rate: 200, windowSec: 60, mode: "processing", watermarkSec: 5, latenessSec: 0, latePct: 10, maxLateSec: 120 },
  run: runEventWindows,
  metrics: (r) => ({ finalAccuracy: r.finalAccuracy, firstAccuracy: r.firstAccuracy, latency: r.latency, dropped: r.dropped }),
  metricSpecs: [
    { key: "finalAccuracy", label: "Final accuracy", format: fmt.pct2 },
    { key: "firstAccuracy", label: "First-result accuracy", format: fmt.pct2 },
    { key: "latency", label: "First result after window end", format: fmt.s },
    { key: "dropped", label: "Late events dropped", format: fmt.pct2 },
  ],
  View: ({ r }) => (
    <>
      <LineChart
        xLabel="window #"
        yLabel="events per window"
        yFormat={fmt.n}
        series={[
          { name: "True count (event time)", color: "var(--muted)", values: r.truth.slice(0, -1), dashed: true },
          { name: "First result", color: "var(--warm)", values: r.first.slice(0, -1) },
          { name: "Final result", color: "var(--good)", values: r.final.slice(0, -1) },
        ]}
        yMax={Math.max(...r.truth) * 1.25}
      />
      <Note>
        Processing-time windows are instant but put late events in the wrong window. Event-time windows wait for the watermark; allowed lateness lets late events
        correct the result, at the cost of keeping window state longer.
      </Note>
    </>
  ),
};
