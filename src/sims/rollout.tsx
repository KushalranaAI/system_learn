import { fmt, type SimDef } from "./types";
import { LineChart, Note } from "./ui";

type RolloutP = {
  strategy: "global" | "canary" | "waves";
  canaryPct: number;
  waves: number;
  bakeMin: number;
  detectMin: number;
  autoRollback: boolean;
  manualMin: number;
  bricks: boolean;
};

interface RolloutR {
  exposed: number[];
  affected: number[];
  stages: { t: number; pct: number }[];
  detectedAt: number;
  rolledBackAt: number;
  peakAffected: number;
  impactHours: number;
  mitigatedMin: number;
}

const T = 360; // minutes shown
const PUSH_MIN = 2; // a global config push reaches every host in about two minutes
const AUTO_ROLLBACK_MIN = 3;
const REPAIR_HOURS = 24; // bricked hosts are fixed by hand, a slice of the fleet at a time

/**
 * A bad change (it breaks every host that gets it) is released to a fleet. Health signals notice it `detectMin` after
 * the first hosts get it; the rollout then halts, and the change is rolled back automatically (in minutes) or by a
 * human (after `manualMin`). If the change bricks hosts (a kernel driver crash-looping on boot), rolling back stops
 * the spread but every affected host still needs hands-on repair.
 */
export function runStagedRollout(p: RolloutP): RolloutR {
  const canary = p.canaryPct / 100;
  let stages: { t: number; pct: number }[];
  if (p.strategy === "global") stages = [{ t: 0, pct: 1 }];
  else if (p.strategy === "canary") stages = [{ t: 0, pct: canary }, { t: p.bakeMin, pct: 1 }];
  else {
    const n = Math.max(2, p.waves);
    stages = Array.from({ length: n }, (_, i) => ({ t: i * p.bakeMin, pct: canary * Math.pow(1 / canary, i / (n - 1)) }));
  }
  const detectedAt = p.detectMin;
  const rolledBackAt = detectedAt + (p.autoRollback ? AUTO_ROLLBACK_MIN : p.manualMin);
  const exposed: number[] = [];
  const affected: number[] = [];
  let reached = 0;
  let atRollback = 0;
  for (let t = 0; t <= T; t++) {
    // stages started before detection go out (each takes PUSH_MIN to reach its hosts); later ones are halted
    let target = 0;
    let prev = 0;
    for (const s of stages) {
      if (s.t > detectedAt || s.t > t) break;
      const ramp = Math.min(1, (t - s.t + 1) / PUSH_MIN);
      const startAt = Math.max(prev, 0);
      target = startAt + (s.pct - startAt) * ramp;
      prev = s.pct;
    }
    if (t < rolledBackAt) reached = Math.max(reached, target);
    if (t === rolledBackAt) atRollback = reached;
    let a: number;
    if (t < rolledBackAt) a = reached;
    else if (!p.bricks) a = Math.max(0, atRollback * (1 - (t - rolledBackAt) / 5));
    else a = Math.max(0, atRollback * (1 - (t - rolledBackAt) / (REPAIR_HOURS * 60)));
    exposed.push(reached);
    affected.push(a);
  }
  const peakAffected = Math.max(...affected);
  const impactHours = affected.reduce((s, v) => s + v, 0) / 60;
  const back = affected.findIndex((v, t) => t >= rolledBackAt && v < 0.001);
  return { exposed, affected, stages, detectedAt, rolledBackAt, peakAffected, impactHours, mitigatedMin: back < 0 ? Infinity : back };
}

export const stagedRollout: SimDef<RolloutP, RolloutR> = {
  id: "staged-rollout",
  title: "Global push vs staged rollout",
  module: 24,
  lessons: ["24.4", "24.2", "24.15"],
  blurb: "A bad change goes out to the fleet. Push it everywhere at once and every host breaks before anyone notices; release it in canaries and waves with automatic rollback and the blast radius stays small.",
  params: [
    { key: "strategy", label: "Release strategy", type: "select", options: [{ value: "global", label: "Global push (everyone in ~2 min)" }, { value: "canary", label: "Canary, then everyone" }, { value: "waves", label: "Staged waves" }] },
    { key: "canaryPct", label: "First stage (canary)", type: "number", min: 0.1, max: 20, step: 0.1, unit: "% of fleet" },
    { key: "waves", label: "Waves (staged)", type: "number", min: 2, max: 10 },
    { key: "bakeMin", label: "Bake time between stages", type: "number", min: 5, max: 240, step: 5, unit: "min" },
    { key: "detectMin", label: "Time to detect a bad change", type: "number", min: 1, max: 120, unit: "min", hint: "Health checks, crash rates, error SLOs." },
    { key: "autoRollback", label: "Automatic rollback on detection", type: "toggle" },
    { key: "manualMin", label: "Manual rollback takes", type: "number", min: 10, max: 240, step: 5, unit: "min" },
    { key: "bricks", label: "The bad change bricks hosts (needs hands-on repair)", type: "toggle", hint: "Like a kernel driver that crashes on every boot." },
  ],
  defaults: { strategy: "global", canaryPct: 1, waves: 4, bakeMin: 30, detectMin: 10, autoRollback: false, manualMin: 60, bricks: false },
  run: runStagedRollout,
  metrics: (r) => ({ peakAffected: r.peakAffected, impactHours: r.impactHours, mitigatedMin: r.mitigatedMin }),
  metricSpecs: [
    { key: "peakAffected", label: "Peak share of fleet broken", format: fmt.pct },
    { key: "impactHours", label: "Fleet-hours of impact (6 h)", format: (v) => v.toFixed(2) },
    { key: "mitigatedMin", label: "Fully recovered after", format: (v) => (Number.isFinite(v) ? `${Math.round(v)} min` : "> 6 h") },
  ],
  View: ({ p, r }) => (
    <>
      <LineChart
        yLabel="% of fleet"
        xLabel="minutes"
        series={[
          { name: "Hosts that got the change", color: "var(--warm)", values: r.exposed, dashed: true },
          { name: "Hosts broken", color: "var(--bad)", values: r.affected },
        ]}
        markers={[
          { x: r.detectedAt, label: "detected", color: "var(--warm)" },
          { x: Math.min(T, r.rolledBackAt), label: "rolled back", color: "var(--good)" },
        ]}
        yMax={1}
        yFormat={(v) => `${Math.round(v * 100)}%`}
      />
      <Note>
        {p.strategy === "global"
          ? "A global push reaches every host before the first alert fires - detection speed can't save you, only rollback speed can."
          : `Stages at ${r.stages.map((s) => `${s.t} min → ${s.pct < 0.1 ? (s.pct * 100).toFixed(1) : Math.round(s.pct * 100)}%`).join(", ")}. Stages scheduled after detection never go out.`}
        {p.bricks ? " Bricked hosts don't come back on rollback: each needs hands-on repair, so the blast radius is what decides the cost." : ""}
      </Note>
    </>
  ),
};
