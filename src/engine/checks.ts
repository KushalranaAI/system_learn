import { KINDS, REFERENCE_PROFILE, withProfile } from "./catalog";
import { fmtRps, simulate } from "./solve";
import { runTimeline, summarize, type Incident, type Resilience } from "./timeline";
import type { Graph, NodeKind, SimResult, Traffic } from "./types";

export type Constraint =
  | { type: "successRate"; min: number }
  | { type: "p99"; maxMs: number }
  | { type: "budget"; maxUsd: number; why?: string }
  | { type: "uses"; kind: NodeKind; min?: number; why?: string }
  | { type: "botsBlocked"; minShare: number }
  | { type: "recovery"; maxSeconds: number }
  | { type: "backlog"; max: number }
  | { type: "consumerLag"; maxGrowth: number }
  | { type: "consistency"; maxPerSec: number };

export type LabIncident = Incident | { type: "killKind"; kind: NodeKind; role?: "primary" | "replica" };

export interface DesignTest {
  traffic: Traffic;
  constraints: Constraint[];
  incident?: LabIncident;
  resilience?: Partial<Resilience>;
}

export interface CheckLine {
  label: string;
  ok: boolean;
  detail: string;
}

export interface TestReport {
  pass: boolean;
  lines: CheckLine[];
  result: SimResult;
}

/** Lab checks always use the reference capacity profile, so every lab stays solvable on any machine. */
export function runDesignTest(graph: Graph, test: DesignTest, resilience: Resilience): TestReport {
  return withProfile(REFERENCE_PROFILE, () => runDesignTestActive(graph, test, resilience));
}

function runDesignTestActive(graph: Graph, test: DesignTest, resilience: Resilience): TestReport {
  const res = { ...resilience, ...test.resilience };
  const timed = test.incident && test.incident.type !== "none";
  const ticks = timed
    ? runTimeline(graph, test.traffic, resolveIncident(graph, test.incident!), res)
    : null;
  const summary = ticks ? summarize(ticks) : null;
  const steady = simulate(graph, test.traffic, { dbFailover: res.dbFailover });
  const lines: CheckLine[] = [];

  for (const c of test.constraints) {
    switch (c.type) {
      case "successRate": {
        const v = summary ? summary.worstSuccess : steady.successRate;
        const pctStr = (x: number) => `${(x * 100).toFixed(x > 0.999 ? 2 : 1)}%`;
        lines.push({
          label: `${summary ? "Worst-second success" : "Success rate"} ≥ ${pctStr(c.min)}`,
          ok: v >= c.min - 1e-9,
          detail: `got ${pctStr(v)}`,
        });
        break;
      }
      case "p99": {
        const v = summary ? summary.worstP99 : steady.p99;
        lines.push({ label: `p99 latency ≤ ${c.maxMs} ms`, ok: v <= c.maxMs && steady.success > 0, detail: `got ${v} ms` });
        break;
      }
      case "budget":
        lines.push({
          label: `Cost ≤ $${c.maxUsd}/month`,
          ok: steady.monthlyUsd <= c.maxUsd,
          detail: `got $${steady.monthlyUsd}${c.why && steady.monthlyUsd > c.maxUsd ? ` - ${c.why}` : ""}`,
        });
        break;
      case "uses": {
        const n = graph.nodes.filter((x) => x.kind === c.kind).length;
        const min = c.min ?? 1;
        lines.push({
          label: `Uses ${min > 1 ? `${min}+ ` : "a "}${KINDS[c.kind].label.toLowerCase()}${min > 1 ? "s" : ""}`,
          ok: n >= min,
          detail: c.why ?? `found ${n}`,
        });
        break;
      }
      case "botsBlocked": {
        const share = steady.bots > 0 ? steady.botsBlocked / steady.bots : 1;
        lines.push({
          label: `Blocks ≥ ${Math.round(c.minShare * 100)}% of bot traffic`,
          ok: share >= c.minShare,
          detail: `blocked ${Math.round(share * 100)}% (${fmtRps(steady.botsBlocked)} req/s)`,
        });
        break;
      }
      case "recovery": {
        const v = summary?.recoverySeconds;
        lines.push({
          label: `Recovers within ${c.maxSeconds} s of the failure`,
          ok: v !== null && v !== undefined && v <= c.maxSeconds,
          detail: v === null || v === undefined ? "never recovered" : `recovered in ${v} s`,
        });
        break;
      }
      case "consumerLag":
        lines.push({
          label: c.maxGrowth <= 0 ? "Every consumer group keeps up (lag doesn't grow)" : `Lag grows ≤ ${fmtRps(c.maxGrowth)} events/s`,
          ok: steady.lagGrowth <= c.maxGrowth + 1e-9 && graph.nodes.some((n) => n.kind === "consumer"),
          detail: steady.lagGrowth > 0 ? `lag grows by ${fmtRps(steady.lagGrowth)} events/s` : "consumers keep up",
        });
        break;
      case "consistency":
        lines.push({
          label: c.maxPerSec <= 0 ? "No order ends inconsistent" : `≤ ${c.maxPerSec} inconsistent orders/s`,
          ok: steady.inconsistent <= c.maxPerSec + 1e-9 && steady.sagaOrders > 0,
          detail: steady.sagaOrders > 0 ? `${fmtRps(steady.inconsistent)} inconsistent orders/s` : "no orders go through a saga",
        });
        break;
      case "backlog": {
        const v = summary ? summary.finalBacklog : Math.max(0, steady.queueIn - steady.jobsDone);
        lines.push({ label: `Queue backlog ≤ ${fmtRps(c.max)} jobs`, ok: v <= c.max, detail: `backlog ${fmtRps(v)}` });
        break;
      }
    }
  }
  return { pass: lines.every((l) => l.ok), lines, result: steady };
}

/** Labs refer to nodes by kind ("the primary db") since learners create their own ids. */
export function resolveIncident(graph: Graph, inc: LabIncident): Incident {
  if (inc.type !== "killKind") return inc;
  const target = graph.nodes.find((n) => n.kind === inc.kind && (!inc.role || (n.config.role ?? "primary") === inc.role));
  return target ? { type: "nodeDown", nodeId: target.id } : { type: "none" };
}
