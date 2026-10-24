import { KINDS, nodeTitle, summarize, type Graph, type Guide, type Incident, type Resilience, type SimResult, type Tick, type Traffic, type TestReport } from "../engine";

const r1 = (x: number) => Math.round(x * 10) / 10;

/** A compact, model-friendly description of a canvas design and its simulated result. */
export function designContext(g: Graph, traffic: Traffic, res: SimResult, resilience: Resilience, guide: Guide) {
  const name = (id: string) => {
    const n = g.nodes.find((x) => x.id === id);
    return n ? nodeTitle(n, g.nodes) : id;
  };
  return {
    traffic: { readsPerSec: traffic.reads, writesPerSec: traffic.writes, botRequestsPerSec: traffic.bots },
    resilience: { clientsRetry: resilience.retries, automaticDbFailover: resilience.dbFailover },
    components: g.nodes.map((n) => {
      const r = res.nodes[n.id];
      return {
        name: nodeTitle(n, g.nodes),
        kind: KINDS[n.kind].label,
        settings: n.config,
        busyPercent: r ? Math.round(r.util * 100) : 0,
        loadPerSec: r ? Math.round(r.load) : 0,
        droppedPerSec: r ? Math.round(r.dropped) : 0,
        p99ms: r ? r1(r.p99Ms) : 0,
        down: r?.down ?? false,
        ...(r?.lagGrowth !== undefined ? { consumerLagGrowthPerSec: Math.round(r.lagGrowth) } : {}),
      };
    }),
    wires: g.edges.map((e) => `${name(e.from)} → ${name(e.to)}`),
    result: {
      successRate: r1(res.successRate * 100) + "%",
      p99ms: res.p99,
      monthlyCostUsd: res.monthlyUsd,
      botsBlocked: res.bots ? Math.round((res.botsBlocked / res.bots) * 100) + "%" : undefined,
      realUsersRateLimitedPerSec: Math.round(res.legitLimited),
      replicaLagMs: Math.round(res.lagMs),
      inconsistentOrdersPerSec: res.sagaOrders ? r1(res.inconsistent) : undefined,
      consumerLagGrowthPerSec: res.eventsIn ? Math.round(res.lagGrowth) : undefined,
    },
    simulatorSignals: res.issues.map((i) => i.text),
    builtInAnalysis: { headline: guide.headline, problems: guide.advice.map((a) => a.problem), whatIfs: guide.whatIfs.map((w) => `${w.scenario}: ${Math.round(w.success * 100)}% success - ${w.verdict}`) },
  };
}

/** Adds the incident timeline to a design context. */
export function timelineContext(base: ReturnType<typeof designContext>, ticks: Tick[], incident: Incident, story: string[]) {
  const s = summarize(ticks);
  const every5 = ticks.filter((_, i) => i % 5 === 0).map((k) => ({ t: k.t, successPercent: r1((k.res.success / Math.max(1, k.res.legit)) * 100), p99ms: k.res.p99, offeredPerSec: Math.round(k.res.legit) }));
  return {
    ...base,
    incident: { ...incident, startsAtSecond: 10, durationSeconds: ticks.length },
    timeline: every5,
    summary: { worstSecondSuccess: r1(s.worstSuccess * 100) + "%", recoverySeconds: s.recoverySeconds, failedRequests: Math.round(s.failedTotal), errorBudgetUsed: r1(s.budgetUsed * 100) + "%", queueBacklogAtEnd: Math.round(s.finalBacklog), consumerLagAtEnd: Math.round(s.finalLag) },
    builtInStory: story,
  };
}

export function labContext(labTitle: string, stepTitle: string, stepBody: string, report: TestReport, design: ReturnType<typeof designContext>) {
  return {
    lab: labTitle,
    step: stepTitle,
    task: stepBody,
    passed: report.pass,
    checks: report.lines.map((l) => ({ check: l.label, passed: l.ok, got: l.detail })),
    design,
  };
}

export function simContext(title: string, blurb: string, params: Record<string, unknown>, metrics: Record<string, number>, metricLabels: Record<string, string>, builtIn: { scenario: string; outcome: string }, goals?: { label: string; met: boolean }[]) {
  return {
    simulation: title,
    about: blurb,
    settings: params,
    results: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [metricLabels[k] ?? k, Number.isFinite(v) ? Math.round(v * 10000) / 10000 : "never/infinite"])),
    goals,
    builtInExplanation: builtIn,
  };
}
