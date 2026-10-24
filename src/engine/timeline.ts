import { workerCap } from "./catalog";
import { simulate } from "./solve";
import type { Graph, SimResult, Traffic } from "./types";

export type Incident =
  | { type: "none" }
  | { type: "nodeDown"; nodeId: string }
  | { type: "cacheFlush" }
  | { type: "spike"; factor: number };

export interface Resilience {
  /** clients retry failed requests the next second */
  retries: boolean;
  /** automatic database failover (promotes a replica after a detection delay) */
  dbFailover: boolean;
}

export const TIMELINE = {
  seconds: 60,
  at: 10,
  retryShare: 0.7,
  failoverSeconds: 15,
  refillPerSecond: 0.2,
  slo: 0.999,
};

export interface Tick {
  t: number;
  res: SimResult;
  cacheWarm: number;
  backlog: number;
  /** total consumer lag (events) */
  lag: number;
}

export function runTimeline(graph: Graph, base: Traffic, incident: Incident, resilience: Resilience): Tick[] {
  const { seconds, at, retryShare, failoverSeconds, refillPerSecond } = TIMELINE;
  const ticks: Tick[] = [];
  let warm = 1;
  let backlog = 0;
  const lag: Record<string, number> = {};
  let retryReads = 0;
  let retryWrites = 0;
  for (let t = 0; t < seconds; t++) {
    const after = t >= at;
    const since = t - at;
    if (incident.type === "cacheFlush" && since === 0) warm = 0;
    const spike = incident.type === "spike" && after ? incident.factor : 1;
    const traffic: Traffic = {
      reads: base.reads * spike + retryReads,
      writes: base.writes * spike + retryWrites,
      bots: base.bots,
    };
    const down = incident.type === "nodeDown" && after ? [incident.nodeId] : [];
    const drainCap = graph.nodes
      .filter((n) => n.kind === "worker")
      .reduce((a, n) => a + workerCap() * (n.config.workers ?? 1), 0);
    const res = simulate(graph, traffic, {
      down,
      cacheWarm: warm,
      dbFailover: resilience.dbFailover,
      promoted: resilience.dbFailover && since >= failoverSeconds,
      backlogDrain: Math.min(backlog, drainCap),
      lagDrain: { ...lag },
    });
    ticks.push({ t, res, cacheWarm: warm, backlog, lag: Object.values(lag).reduce((a, b) => a + b, 0) });
    for (const n of graph.nodes)
      if (n.kind === "consumer") lag[n.id] = Math.max(0, (lag[n.id] ?? 0) + (res.nodes[n.id]?.lagGrowth ?? 0));

    // Backlog: jobs accepted but not yet processed.
    backlog = Math.max(0, backlog + res.queueIn - res.jobsDone);

    // Retries: a share of failed requests come back next second.
    const failed = Math.max(0, res.legit - res.success - res.legitLimited);
    const wShare = res.legit > 0 ? traffic.writes / res.legit : 0;
    retryReads = resilience.retries ? failed * retryShare * (1 - wShare) : 0;
    retryWrites = resilience.retries ? failed * retryShare * wShare : 0;

    // A cold cache refills as fast as the database can answer misses.
    const dbUtil = Math.max(0, ...graph.nodes.filter((n) => n.kind === "db").map((n) => res.nodes[n.id]?.util ?? 0));
    const headroom = dbUtil > 0 ? Math.min(1, 1 / dbUtil) : 1;
    warm += (1 - warm) * refillPerSecond * headroom;
  }
  return ticks;
}

export interface TimelineSummary {
  worstSuccess: number;
  /** seconds after the incident until success stays >= 99%; null = never recovered */
  recoverySeconds: number | null;
  failedTotal: number;
  /** share of a month's 99.9% error budget burned by this incident */
  budgetUsed: number;
  worstP99: number;
  finalBacklog: number;
  finalLag: number;
}

export function summarize(ticks: Tick[], threshold = 0.99): TimelineSummary {
  const rate = (k: Tick) => (k.res.legit > 0 ? Math.min(1, k.res.success / k.res.legit) : 1);
  const worstSuccess = Math.min(...ticks.map(rate));
  let recoverySeconds: number | null = 0;
  for (let i = ticks.length - 1; i >= 0; i--) {
    if (rate(ticks[i]) < threshold) {
      recoverySeconds = i === ticks.length - 1 ? null : Math.max(0, i + 1 - TIMELINE.at);
      break;
    }
  }
  // Count unique failed user requests (retries are the same user trying again).
  const failedTotal = ticks.reduce(
    (a, k) => a + Math.max(0, k.res.legit - k.res.success) / (1 + TIMELINE.retryShare),
    0,
  );
  const baseRps = ticks[0]?.res.legit ?? 0;
  const budget = baseRps * 30 * 86_400 * (1 - TIMELINE.slo);
  return {
    worstSuccess,
    recoverySeconds,
    failedTotal,
    budgetUsed: budget > 0 ? failedTotal / budget : 0,
    worstP99: Math.max(...ticks.map((k) => k.res.p99)),
    finalBacklog: ticks[ticks.length - 1]?.backlog ?? 0,
    finalLag: ticks[ticks.length - 1]?.lag ?? 0,
  };
}
