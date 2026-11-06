import { describe, expect, it } from "vitest";
import { simulate } from "./solve";
import type { Graph, LbAlgo, NodeKind, SimNode } from "./types";

const node = (kind: NodeKind, id: string, config: SimNode["config"] = {}): SimNode => ({ id, kind, x: 0, y: 0, config });
/** client → LB → a big (16k/s) and a small (5k/s) API server → database */
function fleet(lbAlgo: LbAlgo, healthChecks = false): Graph {
  return {
    nodes: [node("client", "c"), node("lb", "lb", { lbAlgo, healthChecks }), node("server", "big", { size: "l" }), node("server", "small", { size: "s" }), node("db", "d", { size: "xl", role: "primary" })],
    edges: [["c", "lb"], ["lb", "big"], ["lb", "small"], ["big", "d"], ["small", "d"]].map(([from, to]) => ({ id: `${from}-${to}`, from, to })),
  };
}
const traffic = { reads: 12_000, writes: 0, bots: 0 };
const load = (g: Graph, id: string, down: string[] = []) => simulate(g, traffic, { down }).nodes[id];

describe("load-balancing algorithms", () => {
  it("round robin splits evenly, so the small server overloads in a mixed fleet", () => {
    const g = fleet("round-robin");
    expect(load(g, "big").load).toBeCloseTo(load(g, "small").load);
    expect(load(g, "small").util).toBeGreaterThan(1);
    expect(simulate(g, traffic).issues.some((i) => /Round robin gives every API server the same share/.test(i.text))).toBe(true);
  });

  it("weighted round robin and least connections split by capacity", () => {
    for (const algo of ["weighted", "least-conn"] as const) {
      const g = fleet(algo);
      expect(load(g, "big").load / load(g, "small").load).toBeCloseTo(16_000 / 5_000);
      expect(load(g, "small").util).toBeLessThan(1);
      expect(simulate(g, traffic).successRate).toBeGreaterThan(0.999);
    }
  });

  it("least connections without health checks pulls traffic into a dead server", () => {
    const rr = simulate(fleet("round-robin"), traffic, { down: ["small"] });
    const lc = simulate(fleet("least-conn"), traffic, { down: ["small"] });
    expect(lc.successRate).toBeLessThan(rr.successRate);
    expect(lc.issues.some((i) => /looks idle/.test(i.text))).toBe(true);
    // health checks fix it for every algorithm
    expect(simulate(fleet("least-conn", true), traffic, { down: ["small"] }).successRate).toBeGreaterThan(0.999);
  });

  it("IP hash is uneven: one server gets about 30% more", () => {
    const g = fleet("ip-hash");
    expect(load(g, "big").load / load(g, "small").load).toBeCloseTo(1.3);
  });

  it("keeps the even split when no algorithm is set (existing designs and labs)", () => {
    const g = fleet("round-robin");
    delete g.nodes[1].config.lbAlgo;
    expect(load(g, "big").load).toBeCloseTo(load(g, "small").load);
  });
});
