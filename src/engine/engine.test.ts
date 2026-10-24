import { describe, expect, it } from "vitest";
import { hopP99 } from "./catalog";
import { runDesignTest } from "./checks";
import { simulate } from "./solve";
import { runTimeline, summarize } from "./timeline";
import type { Graph, NodeKind, SimNode } from "./types";
import { wireRefusal } from "./wiring";

let seq = 0;
const node = (kind: NodeKind, config: SimNode["config"] = {}, id = `${kind}${++seq}`): SimNode => ({ id, kind, x: 0, y: 0, config });
const wire = (g: Graph, a: SimNode, b: SimNode) => g.edges.push({ id: `${a.id}-${b.id}`, from: a.id, to: b.id });

function basic(size = "s") {
  const c = node("client", {}, "c");
  const s = node("server", { size }, "s");
  const d = node("db", { size: "m", role: "primary" }, "d");
  const g: Graph = { nodes: [c, s, d], edges: [] };
  wire(g, c, s);
  wire(g, s, d);
  return g;
}

describe("latency", () => {
  it("grows sharply with utilisation", () => {
    expect(hopP99(1, 0)).toBeCloseTo(Math.log(100));
    expect(hopP99(1, 0.9)).toBeCloseTo(10 * Math.log(100));
    expect(hopP99(1, 5)).toBeLessThanOrEqual(2000);
  });
});

describe("simulate", () => {
  it("serves light traffic fully and fast", () => {
    const r = simulate(basic(), { reads: 500, writes: 5, bots: 0 });
    expect(r.successRate).toBeCloseTo(1);
    expect(r.p99).toBeLessThan(40);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("drops traffic past a server's capacity", () => {
    const r = simulate(basic("s"), { reads: 10_000, writes: 0, bots: 0 });
    expect(r.nodes.s.util).toBeCloseTo(2);
    expect(r.successRate).toBeLessThan(0.6);
    expect(r.issues.some((i) => i.text.includes("overloaded"))).toBe(true);
  });

  it("a cache takes load off the database", () => {
    const g = basic("xl");
    const cache = node("cache", { hitRatio: 0.9 }, "k");
    g.nodes.push(cache);
    wire(g, g.nodes[1], cache);
    const without = simulate(basic("xl"), { reads: 20_000, writes: 0, bots: 0 });
    const withCache = simulate(g, { reads: 20_000, writes: 0, bots: 0 });
    expect(withCache.nodes.d.load).toBeLessThan(without.nodes.d.load * 0.2);
    expect(withCache.successRate).toBeGreaterThan(without.successRate);
  });

  it("load balancer without health checks sends traffic to a dead server", () => {
    const c = node("client", {}, "c");
    const lb = node("lb", { healthChecks: false }, "lb");
    const s1 = node("server", { size: "m" }, "s1");
    const s2 = node("server", { size: "m" }, "s2");
    const d = node("db", { size: "l", role: "primary" }, "d");
    const g: Graph = { nodes: [c, lb, s1, s2, d], edges: [] };
    wire(g, c, lb); wire(g, lb, s1); wire(g, lb, s2); wire(g, s1, d); wire(g, s2, d);
    const bad = simulate(g, { reads: 4000, writes: 0, bots: 0 }, { down: ["s2"] });
    expect(bad.successRate).toBeCloseTo(0.5, 1);
    lb.config.healthChecks = true;
    const good = simulate(g, { reads: 4000, writes: 0, bots: 0 }, { down: ["s2"] });
    expect(good.successRate).toBeCloseTo(1, 2);
  });

  it("rate limiter blocks bots and too-strict limits hurt real users", () => {
    const c = node("client", {}, "c");
    const rl = node("limiter", { limitPerIp: 50 }, "rl");
    const s = node("server", { size: "xl" }, "s");
    const d = node("db", { size: "l" }, "d");
    const g: Graph = { nodes: [c, rl, s, d], edges: [] };
    wire(g, c, rl); wire(g, rl, s); wire(g, s, d);
    const r = simulate(g, { reads: 5000, writes: 0, bots: 40_000 });
    expect(r.botsBlocked / r.bots).toBeGreaterThan(0.99);
    expect(r.legitLimited).toBe(0);
    rl.config.limitPerIp = 10;
    const strict = simulate(g, { reads: 5000, writes: 0, bots: 40_000 });
    expect(strict.legitLimited).toBeGreaterThan(0);
  });

  it("queue answers writes immediately and workers drain it", () => {
    const c = node("client", {}, "c");
    const s = node("server", { size: "m" }, "s");
    const q = node("queue", {}, "q");
    const w = node("worker", { workers: 1 }, "w");
    const d = node("db", { size: "m" }, "d");
    const g: Graph = { nodes: [c, s, q, w, d], edges: [] };
    wire(g, c, s); wire(g, s, q); wire(g, q, w); wire(g, w, d); wire(g, s, d);
    const r = simulate(g, { reads: 0, writes: 1000, bots: 0 });
    expect(r.successRate).toBeCloseTo(1);
    expect(r.queueIn).toBeCloseTo(1000);
    expect(r.jobsDone).toBeCloseTo(400);
  });
});

describe("wiring", () => {
  it("refuses wires against the request direction", () => {
    const g = basic();
    expect(wireRefusal(g, "d", "s")).toMatch(/Wires follow the requests/);
    expect(wireRefusal(g, "c", "d")).toMatch(/database/);
  });
});

describe("timeline", () => {
  it("failover recovers after the detection delay", () => {
    const c = node("client", {}, "c");
    const s = node("server", { size: "l" }, "s");
    const p = node("db", { size: "l", role: "primary" }, "p");
    const rep = node("db", { size: "l", role: "replica" }, "r");
    const g: Graph = { nodes: [c, s, p, rep], edges: [] };
    wire(g, c, s); wire(g, s, p); wire(g, s, rep);
    const ticks = runTimeline(g, { reads: 3000, writes: 300, bots: 0 }, { type: "nodeDown", nodeId: "p" }, { retries: true, dbFailover: true });
    const sum = summarize(ticks);
    expect(sum.worstSuccess).toBeLessThan(0.95);
    expect(sum.recoverySeconds).not.toBeNull();
    expect(sum.recoverySeconds!).toBeLessThanOrEqual(20);
  });

  it("lab checks report pass and fail lines", () => {
    const rep = runDesignTest(basic(), { traffic: { reads: 500, writes: 5, bots: 0 }, constraints: [{ type: "successRate", min: 0.99 }, { type: "budget", maxUsd: 10 }] }, { retries: true, dbFailover: false });
    expect(rep.lines[0].ok).toBe(true);
    expect(rep.lines[1].ok).toBe(false);
    expect(rep.pass).toBe(false);
  });
});

describe("sharding", () => {
  it("adds write capacity, unlike replicas", () => {
    const g = basic("2xl");
    const t = { reads: 1000, writes: 10_000, bots: 0 };
    const one = simulate(g, t);
    expect(one.nodes.d.util).toBeGreaterThan(1);
    g.nodes[2].config.shards = 4;
    const four = simulate(g, t);
    expect(four.nodes.d.util).toBeLessThan(1);
    expect(four.successRate).toBeCloseTo(1, 2);
    expect(four.monthlyUsd).toBe(640 + 180 * 4);
  });
});

describe("capacity profiles", () => {
  it("measured capacities change the simulation, but lab checks always use the reference profile", async () => {
    const { REFERENCE_PROFILE, setActiveProfile } = await import("./catalog");
    const big = { ...REFERENCE_PROFILE, id: "measured" as const, serverSizes: REFERENCE_PROFILE.serverSizes.map((s) => ({ ...s, cap: s.cap * 10 })) };
    const traffic = { reads: 9000, writes: 0, bots: 0 };
    expect(simulate(basic("s"), traffic).nodes.s.util).toBeGreaterThan(1);
    setActiveProfile(big);
    try {
      expect(simulate(basic("s"), traffic).nodes.s.util).toBeLessThan(0.2);
      const rep = runDesignTest(basic("s"), { traffic, constraints: [{ type: "successRate", min: 0.99 }] }, { retries: true, dbFailover: false });
      expect(rep.pass).toBe(false);
    } finally {
      setActiveProfile(REFERENCE_PROFILE);
    }
  });
});

describe("kafka, consumers and sagas", () => {
  it("consumer groups lag when partitions or consumers are too few, and each group gets the full stream", () => {
    const c = node("client", {}, "c");
    const s = node("server", { size: "l" }, "s");
    const d = node("db", { size: "xl" }, "d");
    const k = node("kafka", { partitions: 4 }, "k");
    const g1 = node("consumer", { consumers: 8 }, "g1");
    const g2 = node("consumer", { consumers: 2 }, "g2");
    const g: Graph = { nodes: [c, s, d, k, g1, g2], edges: [] };
    wire(g, c, s); wire(g, s, d); wire(g, s, k); wire(g, k, g1); wire(g, k, g2);
    const r = simulate(g, { reads: 1000, writes: 3000, bots: 0 });
    expect(r.eventsIn).toBeCloseTo(3000);
    expect(r.nodes.g1.idle).toBe(4); // 8 consumers, 4 partitions
    expect(r.nodes.g1.lagGrowth!).toBeLessThanOrEqual(0); // 4 × 1000 ≥ 3000
    expect(r.nodes.g2.lagGrowth!).toBeCloseTo(1000); // 2 × 1000 < 3000
    k.config.hotKeyPct = 50;
    const hot = simulate(g, { reads: 1000, writes: 3000, bots: 0 });
    expect(hot.nodes.g1.lagGrowth!).toBeGreaterThan(0); // the hot partition overloads one consumer
  });

  it("a saga multiplies database writes and its safeguards remove inconsistencies", () => {
    const c = node("client", {}, "c");
    const s = node("server", { size: "l" }, "s");
    const sg = node("saga", { sagaSteps: 3 }, "sg");
    const d = node("db", { size: "xl" }, "d");
    const g: Graph = { nodes: [c, s, sg, d], edges: [] };
    wire(g, c, s); wire(g, s, d); wire(g, s, sg); wire(g, sg, d);
    const bad = simulate(g, { reads: 0, writes: 1000, bots: 0 });
    expect(bad.nodes.d.writes).toBeCloseTo(3000);
    expect(bad.inconsistent).toBeGreaterThan(100);
    Object.assign(sg.config, { compensate: true, queryTimeouts: true, idempotencyKeys: true, outbox: true, dedupeConsumers: true });
    const good = simulate(g, { reads: 0, writes: 1000, bots: 0 });
    expect(good.inconsistent).toBe(0);
    expect(good.successRate).toBeCloseTo(1);
  });
});

describe("the guide", () => {
  it("explains an overloaded design with a fix, a trade-off and a one-click action", async () => {
    const { explainDesign, explainTimeline } = await import("./explain");
    const { runTimeline } = await import("./timeline");
    const g = basic("s");
    const traffic = { reads: 9000, writes: 50, bots: 0 };
    const res = simulate(g, traffic);
    const guide = explainDesign(g, traffic, res);
    expect(guide.tone).toBe("bad");
    const server = guide.advice.find((a) => a.problem.includes("API server"));
    expect(server?.fix).toMatch(/bigger machine/);
    expect(server?.tradeoff.length).toBeGreaterThan(20);
    expect(server?.action?.kind).toBe("config");
    expect(guide.whatIfs.some((w) => w.scenario === "Traffic doubles")).toBe(true);
    const ticks = runTimeline(g, { reads: 1000, writes: 10, bots: 0 }, { type: "nodeDown", nodeId: "s" }, { retries: true, dbFailover: false });
    const story = explainTimeline(g, traffic, ticks, { type: "nodeDown", nodeId: "s" }, { retries: true, dbFailover: false });
    expect(story.story.join(" ")).toMatch(/died/);
    expect(story.advice[0].problem).toMatch(/single point of failure/);
  });
});
