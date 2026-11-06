import { nodeTitle } from "./catalog";
import { fmtRps } from "./solve";
import { TIMELINE, type Incident, type Resilience, type Tick } from "./timeline";
import type { Graph } from "./types";

/**
 * Plain-language narration for an incident replay: what is happening at one second, and why.
 * The replay chart shows the numbers; this says what they mean.
 */

/** Past this p99, users notice the wait. */
export const SLOW_MS = 300;
/** Success the replay calls healthy. */
export const GOAL = 0.99;

export type Phase = "before" | "hit" | "failing" | "slow" | "holding" | "recovered" | "steady";

export interface Moment {
  phase: Phase;
  /** short label for the phase pill */
  label: string;
  tone: "good" | "warn" | "bad" | "neutral";
  headline: string;
  /** the causes behind the numbers, most important first */
  why: string[];
}

export const answered = (k: Tick) => (k.res.legit > 0 ? Math.min(1, k.res.success / k.res.legit) : 1);

/** A success share, with a decimal where it matters (98.8% is a failure, "99%" would hide that). */
export const fmtPct = (x: number) => (x >= 0.9995 ? "100%" : `${(x * 100).toFixed(x >= 0.9 ? 1 : 0)}%`);

/** Share of a month's error budget, without rounding a real cost down to "0%". */
export const fmtBudget = (x: number) => (x >= 1 ? "all of it" : x <= 0 ? "0%" : x < 0.001 ? "<0.1%" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);

/** What the incident is, as a learner would say it. */
export function incidentLabel(incident: Incident, g: Graph): string {
  switch (incident.type) {
    case "none":
      return "No incident";
    case "spike":
      return incident.factor >= 10 ? `Viral moment (${incident.factor}× traffic)` : `Traffic spike (${incident.factor}×)`;
    case "cacheFlush":
      return "Cache restart";
    case "nodeDown": {
      const n = g.nodes.find((x) => x.id === incident.nodeId);
      return `${n ? nodeTitle(n, g.nodes) : "A component"} dies`;
    }
  }
}

function hitHeadline(incident: Incident, g: Graph): string {
  switch (incident.type) {
    case "spike":
      return `Traffic jumps ${incident.factor}× right now and stays there.`;
    case "cacheFlush":
      return "The cache restarts empty: every read misses and goes to the database.";
    case "nodeDown": {
      const n = g.nodes.find((x) => x.id === incident.nodeId);
      return `${n ? nodeTitle(n, g.nodes) : "A component"} just died.`;
    }
    default:
      return "Nothing goes wrong: traffic stays steady.";
  }
}

/** Why the numbers look the way they do at second `i`. */
function causes(g: Graph, ticks: Tick[], i: number, incident: Incident, resilience: Resilience): string[] {
  const k = ticks[i];
  const since = k.t - TIMELINE.at;
  const out: string[] = [];
  const title = (id: string) => {
    const n = g.nodes.find((x) => x.id === id);
    return n ? nodeTitle(n, g.nodes) : "a component";
  };

  if (incident.type === "nodeDown" && since >= 0) {
    const dead = g.nodes.find((n) => n.id === incident.nodeId);
    if (dead?.kind === "db" && dead.config.role !== "replica") {
      const replica = g.nodes.some((n) => n.kind === "db" && n.config.role === "replica");
      if (!replica) out.push("There's no replica to take over, so every read and write that needs the database fails.");
      else if (!resilience.dbFailover) out.push("Reads still work from the replica, but writes fail: DB failover is off, so nothing promotes it.");
      else if (since < TIMELINE.failoverSeconds) out.push(`Failover promotes the replica in ${TIMELINE.failoverSeconds - since} s. Until then, writes fail.`);
      else out.push("The replica has been promoted to primary, so writes work again.");
    } else if (answered(k) < GOAL) out.push(`${title(incident.nodeId)} is down, and the rest of the design can't make up for it.`);
  }
  if (incident.type === "cacheFlush" && since >= 0 && k.cacheWarm < 0.97)
    out.push(`The cache is only ${Math.round(k.cacheWarm * 100)}% warm again, so extra reads miss and land on the database.`);

  const hottest = g.nodes
    .filter((n) => n.kind !== "client" && n.kind !== "consumer" && k.res.nodes[n.id] && !k.res.nodes[n.id].down)
    .sort((a, b) => k.res.nodes[b.id].util - k.res.nodes[a.id].util)[0];
  const r = hottest && k.res.nodes[hottest.id];
  if (r && r.util > 1) out.push(`${title(hottest.id)} is overloaded (${Math.round(r.util * 100)}% busy), so it drops ${fmtRps(r.dropped)} requests/s.`);
  else if (r && r.util > 0.85) out.push(`${title(hottest.id)} is running hot (${Math.round(r.util * 100)}% busy): requests queue, so waits grow.`);

  const factor = incident.type === "spike" && since >= 0 ? incident.factor : 1;
  const extra = k.res.legit - (ticks[0]?.res.legit ?? 0) * factor;
  if (resilience.retries && extra > Math.max(1, k.res.legit * 0.02))
    out.push(`Clients retry their failed requests, adding ${fmtRps(extra)} requests/s on top.`);
  if (k.backlog > 0.5) out.push(`${fmtRps(k.backlog)} jobs are waiting in the queue to be processed.`);
  if (k.lag > 0.5) out.push(`Consumers are ${fmtRps(k.lag)} events behind.`);
  return out;
}

/** The story of one second of the replay. */
export function describeSecond(g: Graph, ticks: Tick[], i: number, incident: Incident, resilience: Resilience): Moment {
  const k = ticks[i];
  const rate = answered(k);
  const since = k.t - TIMELINE.at;
  const numbers = `${fmtPct(rate)} of ${fmtRps(k.res.legit)} requests/s answered; the slowest 1% wait ${k.res.p99} ms.`;
  const why = causes(g, ticks, i, incident, resilience);

  if (incident.type === "none")
    return rate >= GOAL
      ? { phase: "steady", label: "Steady", tone: "good", headline: "Steady traffic, nothing fails.", why: [numbers, ...why] }
      : { phase: "failing", label: "Failing", tone: "bad", headline: `Users get errors even with nothing broken: only ${fmtPct(rate)} answered.`, why };
  if (since < 0)
    return { phase: "before", label: "Before", tone: "neutral", headline: `Normal traffic. Coming at ${TIMELINE.at} s: ${incidentLabel(incident, g)}.`, why: [numbers] };
  if (since === 0) return { phase: "hit", label: "Incident", tone: "bad", headline: hitHeadline(incident, g), why };
  if (rate < GOAL) return { phase: "failing", label: "Failing", tone: "bad", headline: `Users are getting errors: only ${fmtPct(rate)} of requests answered.`, why };
  if (k.res.p99 > SLOW_MS) return { phase: "slow", label: "Slow", tone: "warn", headline: `Requests get through, but slowly: the slowest 1% wait ${k.res.p99} ms.`, why };
  const dipped = ticks.slice(TIMELINE.at, i).some((x) => answered(x) < GOAL);
  return dipped
    ? { phase: "recovered", label: "Recovered", tone: "good", headline: `Recovered: ${fmtPct(rate)} of requests answered again.`, why }
    : { phase: "holding", label: "Holding up", tone: "good", headline: `Holding up: ${fmtPct(rate)} of requests answered.`, why };
}

/** The seconds worth pointing at on the chart. */
export function keyMoments(ticks: Tick[]): { worst: number | null; recovered: number | null } {
  let worst = 0;
  ticks.forEach((k, i) => answered(k) < answered(ticks[worst]) && (worst = i));
  if (answered(ticks[worst]) >= GOAL) return { worst: null, recovered: null };
  let recovered: number | null = null;
  for (let i = ticks.length - 1; i > worst; i--) {
    if (answered(ticks[i]) < GOAL) break;
    recovered = i;
  }
  return { worst, recovered };
}
