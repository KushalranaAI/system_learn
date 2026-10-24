import { describe, expect, it } from "vitest";
import { CAN_SEND_TO, runTimeline, simulate, summarize } from "../engine";
import { lessonById } from "../content/lessons";
import { SCENARIOS } from "./index";

describe("every sandbox scenario", () => {
  it("has a unique id", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  for (const s of SCENARIOS)
    describe(s.id, () => {
      it("is wired by the canvas rules and runs", () => {
        const kinds = new Map(s.graph.nodes.map((n) => [n.id, n.kind]));
        expect(s.graph.nodes.filter((n) => n.kind === "client")).toHaveLength(1);
        for (const e of s.graph.edges) {
          expect(kinds.has(e.from) && kinds.has(e.to), `${e.id} points at a missing node`).toBe(true);
          expect(CAN_SEND_TO[kinds.get(e.from)!], `${e.id} isn't an allowed wire`).toContain(kinds.get(e.to));
        }
        const r = simulate(s.graph, s.traffic);
        if (s.id !== "empty") expect(r.issues.filter((i) => i.text.includes("isn't wired to"))).toEqual([]);
        expect(s.tryThis.length).toBeGreaterThan(0);
      });

      if (s.lesson) it(`links to a written lesson (${s.lesson})`, () => expect(lessonById(s.lesson!)).toBeTruthy());

      if (s.category === "outage")
        it("replays a visible failure when its incident runs", () => {
          expect(s.incident && s.incident.type !== "none").toBe(true);
          if (s.incident?.type === "nodeDown") expect(s.graph.nodes.some((n) => n.id === (s.incident as { nodeId: string }).nodeId)).toBe(true);
          const ticks = runTimeline(s.graph, s.traffic, s.incident!, s.resilience ?? { retries: true, dbFailover: false });
          expect(summarize(ticks).worstSuccess).toBeLessThan(0.99);
        });
    });
});
