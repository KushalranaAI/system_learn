import { percentile, rng } from "./rng";
import { fmt, type SimDef } from "./types";
import { Bars, Note } from "./ui";

type AgentP = {
  steps: number;
  stepSuccess: number;
  verify: boolean;
  retries: number;
  stepLimit: number;
  loopPct: number;
  callCents: number;
  callMs: number;
};

interface AgentR {
  success: number;
  silentWrong: number;
  handedOff: number;
  aborted: number;
  avgCalls: number;
  p99Calls: number;
  costPerTask: number;
  latencySec: number;
  callHist: number[];
}

const TASKS = 4000;
const DETECT = 0.85; // a verification step catches 85% of bad step results
const VERIFY_COST = 0.3; // a check is a short call (often a smaller model): ~30% of a step's cost
const RECOVER = 0.08; // chance per extra step that a confused agent gets back on track

/**
 * Monte Carlo over 4,000 tasks. Each task needs `steps` correct steps (model call + tool call).
 * - A step succeeds with `stepSuccess`. Without verification a bad result goes unnoticed and the task ends wrong
 *   (the worst outcome: the agent reports success).
 * - With verification a bad result is caught 85% of the time and retried (up to `retries`); if retries run out,
 *   the task is handed to a human.
 * - Sometimes the agent gets confused and loops (repeats tool calls without progress) until it recovers.
 * - The step limit stops a task once it has taken that many steps: it fails, but cost is bounded.
 */
export function runAgentReliability(p: AgentP): AgentR {
  const r = rng(28);
  let ok = 0;
  let silent = 0;
  let handed = 0;
  let aborted = 0;
  const calls: number[] = [];
  let cost = 0;
  for (let t = 0; t < TASKS; t++) {
    let n = 0;
    let checks = 0;
    let outcome: "ok" | "silent" | "handed" | "aborted" = "ok";
    let wrong = false;
    task: for (let s = 0; s < p.steps; s++) {
      if (r() < p.loopPct / 100) {
        do {
          n++;
          if (n >= p.stepLimit) {
            outcome = "aborted";
            break task;
          }
        } while (r() > RECOVER);
      }
      for (let attempt = 0; ; attempt++) {
        n++;
        const good = r() < p.stepSuccess;
        if (p.verify) checks++;
        if (n >= p.stepLimit && (s < p.steps - 1 || !good)) {
          outcome = "aborted";
          break task;
        }
        if (good) break;
        if (p.verify && r() < DETECT) {
          if (attempt < p.retries) continue;
          outcome = "handed";
          break task;
        }
        wrong = true; // unnoticed: the agent carries on with a bad intermediate result
        break;
      }
    }
    if (outcome === "ok" && wrong) outcome = "silent";
    if (outcome === "ok") ok++;
    else if (outcome === "silent") silent++;
    else if (outcome === "handed") handed++;
    else aborted++;
    calls.push(n);
    cost += (n + checks * VERIFY_COST) * p.callCents;
  }
  const avgCalls = calls.reduce((a, b) => a + b, 0) / TASKS;
  const hist = new Array(12).fill(0);
  for (const c of calls) hist[Math.min(11, Math.floor(c / 5))]++;
  const verifyFactor = p.verify ? 1 + VERIFY_COST : 1;
  return {
    success: ok / TASKS,
    silentWrong: silent / TASKS,
    handedOff: handed / TASKS,
    aborted: aborted / TASKS,
    avgCalls,
    p99Calls: percentile(calls, 0.99),
    costPerTask: cost / TASKS / 100,
    latencySec: (avgCalls * p.callMs * verifyFactor) / 1000,
    callHist: hist.map((h) => h / TASKS),
  };
}

export const agentReliability: SimDef<AgentP, AgentR> = {
  id: "agent-reliability",
  title: "Agent reliability math",
  module: 35,
  lessons: ["35.8", "35.2"],
  blurb: "A task needs every step to go right, so per-step errors compound: 95% per step over 10 steps is 60% per task. Add verification, retries and a step limit and watch success, cost and the long tail of runaway runs.",
  params: [
    { key: "steps", label: "Steps a task needs", type: "number", min: 1, max: 30 },
    { key: "stepSuccess", label: "Per-step success", type: "number", min: 0.8, max: 0.999, step: 0.001 },
    { key: "verify", label: "Verify each step's result", type: "toggle", hint: "A check (tests, a schema, a second model) catches ~85% of bad results." },
    { key: "retries", label: "Retries per step after a failed check", type: "number", min: 0, max: 3 },
    { key: "stepLimit", label: "Step limit per task", type: "number", min: 5, max: 100, hint: "100 ≈ no limit." },
    { key: "loopPct", label: "Chance per step the agent loops", type: "number", min: 0, max: 10, step: 0.5, unit: "%" },
    { key: "callCents", label: "Cost per model call", type: "number", min: 0.1, max: 10, step: 0.1, unit: "¢" },
    { key: "callMs", label: "Latency per step", type: "number", min: 200, max: 10000, step: 100, unit: "ms" },
  ],
  defaults: { steps: 10, stepSuccess: 0.95, verify: false, retries: 0, stepLimit: 100, loopPct: 3, callCents: 2, callMs: 2500 },
  run: runAgentReliability,
  metrics: (r) => ({ success: r.success, silentWrong: r.silentWrong, handedOff: r.handedOff, aborted: r.aborted, avgCalls: r.avgCalls, p99Calls: r.p99Calls, costPerTask: r.costPerTask, latencySec: r.latencySec }),
  metricSpecs: [
    { key: "success", label: "Tasks done correctly", format: fmt.pct },
    { key: "silentWrong", label: "Reported done but wrong", format: fmt.pct },
    { key: "handedOff", label: "Handed to a human", format: fmt.pct },
    { key: "aborted", label: "Stopped by the step limit", format: fmt.pct },
    { key: "avgCalls", label: "Steps per task (avg)", format: (v) => v.toFixed(1) },
    { key: "p99Calls", label: "Steps per task (p99)", format: fmt.n },
    { key: "costPerTask", label: "Cost per task", format: (v) => `$${v.toFixed(3)}` },
    { key: "latencySec", label: "Time per task (avg)", format: fmt.s },
  ],
  View: ({ p, r }) => (
    <>
      <Bars
        values={r.callHist}
        yLabel="share of tasks"
        xLabel="model calls per task (buckets of 5; red = past the step limit)"
        labels={r.callHist.map((_, i) => (i === 11 ? "55+" : `${i * 5}`))}
        color={(_, i) => (i * 5 >= p.stepLimit ? "var(--bad)" : "var(--accent)")}
        yFormat={(v) => `${Math.round(v * 100)}%`}
      />
      <Note>
        Steps per task (buckets of 5). Without verification, {fmt.pct(Math.pow(p.stepSuccess, p.steps))} of tasks would succeed ({p.stepSuccess} ^ {p.steps}) and every failure is
        silent. The long right tail is runaway loops: a step limit cuts it off, so a confused run fails fast instead of burning money.
      </Note>
    </>
  ),
};
