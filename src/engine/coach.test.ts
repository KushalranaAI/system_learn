import { describe, expect, it } from "vitest";
import { PALETTE } from "./catalog";
import { coach, type CoachInput } from "./coach";
import type { Graph, NodeKind, SimNode } from "./types";

const node = (kind: NodeKind, id: string, config: SimNode["config"] = {}): SimNode => ({ id, kind, x: 0, y: 0, config });
const g = (nodes: SimNode[], wires = ""): Graph => ({
  nodes,
  edges: wires.split(",").filter(Boolean).map((w) => {
    const [from, to] = w.split(">");
    return { id: `${from}-${to}`, from, to };
  }),
});
const run = (graph: Graph, extra: Partial<CoachInput> = {}) =>
  coach({ graph, advice: [], incident: { type: "none" }, palette: PALETTE, tour: true, done: {}, ...extra });

const C = node("client", "c");
const S = node("server", "s");
const S2 = node("server", "s2");
const D = node("db", "d", { role: "primary" });
const LB = node("lb", "lb");

describe("coach", () => {
  it("starts with a client, then a server", () => {
    expect(run(g([])).step).toMatchObject({ stage: "build", addKind: "client" });
    expect(run(g([C])).step).toMatchObject({ stage: "build", addKind: "server" });
  });

  it("asks to wire a new component before adding more", () => {
    const s = run(g([C, S])).step!;
    expect(s).toMatchObject({ stage: "wire", wire: { from: "c", to: "s" } });
    expect(s.action).toMatchObject({ type: "rewire", add: [["c", "s"]] });
  });

  it("asks for a database once the path reaches a server", () => {
    expect(run(g([C, S], "c>s")).step).toMatchObject({ addKind: "db" });
    expect(run(g([C, S, D], "c>s")).step).toMatchObject({ stage: "wire", wire: { from: "s", to: "d" } });
  });

  it("moves on to load and break once the design is built and wired", () => {
    const basic = g([C, S, D], "c>s,s>d");
    const r = run(basic);
    expect(r.complete).toMatchObject({ build: true, wire: true, load: false });
    expect(r.step).toMatchObject({ stage: "load" });
    expect(run(basic, { done: { traffic: true } }).step).toMatchObject({ stage: "break", action: { type: "incident" } });
    expect(run(basic, { done: { traffic: true }, incident: { type: "cacheFlush" } }).step).toMatchObject({ action: { type: "run" } });
    expect(run(basic, { done: { traffic: true, ran: true } }).step).toBeNull();
  });

  it("points at the failing design before anything else", () => {
    const advice = [{ severity: "bad" as const, problem: "API server is overloaded (140%).", why: "", fix: "", tradeoff: "" }];
    expect(run(g([C, S, D], "c>s,s>d"), { advice }).step).toMatchObject({ stage: "fix" });
  });

  it("puts a load balancer in between when the client already feeds a server", () => {
    const s = run(g([C, S, D, LB], "c>s,s>d")).step!;
    expect(s.action).toMatchObject({ type: "rewire", remove: ["c-s"], add: [["c", "lb"], ["lb", "s"]] });
  });

  it("suggests a load balancer for a second server the client can't reach", () => {
    expect(run(g([C, S, S2, D], "c>s,s>d,s2>d")).step).toMatchObject({ addKind: "lb" });
    // with the LB in place, the second server gets wired from it
    expect(run(g([C, S, S2, D, LB], "c>lb,lb>s,s>d,s2>d")).step).toMatchObject({ wire: { from: "lb", to: "s2" } });
  });

  it("adds what feeds an orphan component", () => {
    expect(run(g([C, S, D, node("worker", "w")], "c>s,s>d")).step).toMatchObject({ addKind: "queue" });
  });

  it("only gives build and wire steps in labs, and only for components the lab offers", () => {
    expect(run(g([C, S, D], "c>s,s>d"), { tour: false }).step).toBeNull();
    expect(run(g([C, S], "c>s"), { tour: false, palette: ["client", "server"] }).step).toBeNull();
  });

  it("every suggested wire is one the canvas accepts", async () => {
    const { wireRefusal } = await import("./wiring");
    for (const graph of [g([C, S]), g([C, S, D], "c>s"), g([C, S, S2, D, LB], "c>lb,lb>s,s>d,s2>d")]) {
      const w = run(graph).step?.wire;
      if (w) expect(wireRefusal(graph, w.from, w.to)).toBeNull();
    }
  });
});

describe("coach on the built-in starting points", () => {
  it("never nags a finished design to build or wire more", async () => {
    const { SCENARIOS } = await import("../scenarios");
    const nagged = SCENARIOS.filter((p) => p.id !== "empty")
      .filter((p) => ["build", "wire"].includes(run(p.graph).step?.stage ?? ""))
      .map((p) => p.id);
    expect(nagged).toEqual([]);
  });
});
