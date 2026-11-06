import { describe, expect, it } from "vitest";
import { describeSecond, keyMoments, answered } from "./replay";
import { TIMELINE, runTimeline, type Incident, type Resilience } from "./timeline";
import type { Graph, NodeKind, SimNode } from "./types";

const node = (kind: NodeKind, id: string, config: SimNode["config"] = {}): SimNode => ({ id, kind, x: 0, y: 0, config });
const failoverDesign = (): Graph => ({
  nodes: [node("client", "c"), node("server", "s", { size: "l" }), node("db", "p", { size: "l", role: "primary" }), node("db", "r", { size: "l", role: "replica" })],
  edges: [{ id: "1", from: "c", to: "s" }, { id: "2", from: "s", to: "p" }, { id: "3", from: "s", to: "r" }],
});
const traffic = { reads: 3000, writes: 300, bots: 0 };

function replay(g: Graph, incident: Incident, resilience: Resilience) {
  const ticks = runTimeline(g, traffic, incident, resilience);
  return { ticks, at: (i: number) => describeSecond(g, ticks, i, incident, resilience) };
}

describe("replay narration", () => {
  const kill: Incident = { type: "nodeDown", nodeId: "p" };

  it("walks through before, the hit, the failover window and recovery", () => {
    const { ticks, at } = replay(failoverDesign(), kill, { retries: true, dbFailover: true });
    expect(at(0)).toMatchObject({ phase: "before", tone: "neutral" });
    expect(at(0).headline).toMatch(/Primary DB dies/);
    expect(at(TIMELINE.at)).toMatchObject({ phase: "hit" });
    expect(at(TIMELINE.at).headline).toMatch(/just died/);
    const during = at(TIMELINE.at + 3);
    expect(during.phase).toBe("failing");
    expect(during.why.join(" ")).toMatch(/Failover promotes the replica in 12 s/);
    expect(during.why.join(" ")).toMatch(/retry/);
    const end = at(ticks.length - 1);
    expect(end.phase).toBe("recovered");
  });

  it("says why writes fail when failover is off", () => {
    const { ticks, at } = replay(failoverDesign(), kill, { retries: false, dbFailover: false });
    expect(at(ticks.length - 1).why.join(" ")).toMatch(/failover is off/);
  });

  it("marks the worst second and when it recovered", () => {
    const { ticks } = replay(failoverDesign(), kill, { retries: true, dbFailover: true });
    const m = keyMoments(ticks);
    expect(m.worst).not.toBeNull();
    expect(m.worst!).toBeGreaterThanOrEqual(TIMELINE.at);
    expect(m.recovered!).toBeGreaterThan(m.worst!);
    expect(answered(ticks[m.recovered!])).toBeGreaterThanOrEqual(0.99);
  });

  it("has no markers when nothing goes wrong", () => {
    const { ticks, at } = replay(failoverDesign(), { type: "none" }, { retries: true, dbFailover: true });
    expect(keyMoments(ticks)).toEqual({ worst: null, recovered: null });
    expect(at(30).phase).toBe("steady");
  });
});
