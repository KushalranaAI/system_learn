import { expo, percentile, rng } from "./rng";
import { fmt, type SimDef } from "./types";
import { Bars, LineChart, Note } from "./ui";

/* ------------------------------------------------------------------ Gossip */

type GossipP = { nodes: number; fanout: number; lossPct: number; mode: "push" | "pushpull" };
interface GossipR { informed: number[]; rounds: number; msgsPerNodeRound: number }

export function runGossip(p: GossipP): GossipR {
  const r = rng(61);
  const informed = new Uint8Array(p.nodes);
  informed[0] = 1;
  let count = 1;
  const curve = [1 / p.nodes];
  let rounds = Infinity;
  for (let round = 1; round <= 60; round++) {
    const snapshot = informed.slice();
    for (let i = 0; i < p.nodes; i++) {
      for (let f = 0; f < p.fanout; f++) {
        const peer = Math.floor(r() * p.nodes);
        if (r() < p.lossPct / 100) continue;
        if (snapshot[i] && !informed[peer]) {
          informed[peer] = 1;
          count++;
        } else if (p.mode === "pushpull" && !snapshot[i] && snapshot[peer] && !informed[i]) {
          informed[i] = 1;
          count++;
        }
      }
    }
    curve.push(count / p.nodes);
    if (count === p.nodes) {
      rounds = round;
      break;
    }
  }
  return { informed: curve, rounds, msgsPerNodeRound: p.fanout };
}

export const gossip: SimDef<GossipP, GossipR> = {
  id: "gossip",
  title: "Gossip protocol",
  module: 26,
  lessons: ["26.6", "14.6"],
  blurb: "One node learns a fact. Every round, each node talks to a few random peers over a lossy network. How many rounds until all of them know?",
  params: [
    { key: "nodes", label: "Nodes", type: "number", min: 10, max: 20000, log: true },
    { key: "fanout", label: "Peers contacted per round", type: "number", min: 1, max: 8 },
    { key: "lossPct", label: "Message loss", type: "number", min: 0, max: 60, unit: "%" },
    { key: "mode", label: "Exchange", type: "select", options: [{ value: "push", label: "Push (informed nodes tell peers)" }, { value: "pushpull", label: "Push-pull (everyone asks too)" }] },
  ],
  defaults: { nodes: 1000, fanout: 1, lossPct: 20, mode: "push" },
  run: runGossip,
  metrics: (r) => ({ rounds: r.rounds, msgs: r.msgsPerNodeRound }),
  metricSpecs: [
    { key: "rounds", label: "Rounds until everyone knows", format: (v) => (Number.isFinite(v) ? `${v}` : "> 60") },
    { key: "msgs", label: "Messages per node per round", format: fmt.n },
  ],
  View: ({ p, r }) => (
    <>
      <LineChart xLabel="round" yLabel="informed" yMax={1} yFormat={(v) => `${Math.round(v * 100)}%`} series={[{ name: "Nodes informed", color: "var(--good)", values: r.informed }]} />
      <Note>log₂({p.nodes}) ≈ {Math.log2(p.nodes).toFixed(1)}. Spread is exponential at first; the last few nodes are slow with pure push, because informed nodes keep picking peers who already know.</Note>
    </>
  ),
};

/* ------------------------------------------------------------------ Raft leader election */

type RaftP = { nodes: number; failed: number; baseMs: number; spreadMs: number; netMs: number };
interface RaftR { times: number[]; avg: number; p99: number; failedPct: number; splitPct: number; terms: number[] }

/**
 * Event-driven Raft election. The leader has just died (plus `failed` other nodes). Every live node has an election
 * timer of base + uniform(0, spread). When it fires, the node becomes a candidate for a new term, votes for itself and
 * sends RequestVote to everyone; messages take ~netMs. A follower grants its vote to the first candidate it hears from
 * in a term. A candidate with a majority (of all nodes) wins. If nobody can win, timers restart for a new term.
 */
function electOnce(p: RaftP, r: () => number): { time: number; terms: number } {
  const alive = Array.from({ length: p.nodes - 1 - p.failed }, (_, i) => i);
  const majority = Math.floor(p.nodes / 2) + 1;
  let now = 0;
  for (let term = 1; term <= 30; term++) {
    type Ev = { t: number; kind: "timeout" | "request" | "vote"; to: number; from: number };
    const evs: Ev[] = alive.map((n) => ({ t: now + p.baseMs + r() * p.spreadMs, kind: "timeout" as const, to: n, from: n }));
    const votedFor = new Map<number, number>();
    const votes = new Map<number, number>();
    let leader = -1;
    let leaderAt = 0;
    while (evs.length) {
      evs.sort((a, b) => a.t - b.t);
      const e = evs.shift()!;
      if (e.kind === "timeout") {
        if (votedFor.has(e.to)) continue; // already voted for someone this term - timer was reset
        votedFor.set(e.to, e.to);
        votes.set(e.to, 1);
        for (const n of alive) if (n !== e.to) evs.push({ t: e.t + 1 + expo(r, p.netMs), kind: "request", to: n, from: e.to });
      } else if (e.kind === "request") {
        if (!votedFor.has(e.to)) {
          votedFor.set(e.to, e.from);
          evs.push({ t: e.t + 1 + expo(r, p.netMs), kind: "vote", to: e.from, from: e.to });
        }
      } else {
        const v = (votes.get(e.to) ?? 0) + 1;
        votes.set(e.to, v);
        if (v >= majority && leader < 0) {
          leader = e.to;
          leaderAt = e.t;
          break;
        }
      }
      now = e.t;
    }
    if (leader >= 0) return { time: leaderAt, terms: term };
    if (alive.length < majority) return { time: Infinity, terms: term };
    if (now > 3000) break;
  }
  return { time: Infinity, terms: 30 };
}

export function runRaft(p: RaftP): RaftR {
  const r = rng(73);
  const times: number[] = [];
  const terms: number[] = [];
  let failed = 0;
  let split = 0;
  const TRIALS = 400;
  for (let i = 0; i < TRIALS; i++) {
    const res = electOnce(p, r);
    if (!Number.isFinite(res.time) || res.time > 3000) failed++;
    else times.push(res.time);
    if (res.terms > 1) split++;
    terms.push(res.terms);
  }
  return {
    times,
    avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : Infinity,
    p99: times.length ? percentile(times, 0.99) : Infinity,
    failedPct: failed / TRIALS,
    splitPct: split / TRIALS,
    terms,
  };
}

export const raft: SimDef<RaftP, RaftR> = {
  id: "raft",
  title: "Raft leader election",
  module: 26,
  lessons: ["26.7", "13.3", "5.4"],
  blurb: "The leader of a Raft cluster dies. Run 400 elections with real timers, vote requests and network delays, and see how randomised timeouts prevent split votes.",
  params: [
    { key: "nodes", label: "Cluster size", type: "number", min: 3, max: 9, step: 2 },
    { key: "failed", label: "Other failed nodes", type: "number", min: 0, max: 4 },
    { key: "baseMs", label: "Election timeout (minimum)", type: "number", min: 50, max: 500, step: 10, unit: "ms" },
    { key: "spreadMs", label: "Random extra timeout (0 = all equal)", type: "number", min: 0, max: 500, step: 5, unit: "ms" },
    { key: "netMs", label: "Network delay (mean)", type: "number", min: 1, max: 100, unit: "ms" },
  ],
  defaults: { nodes: 5, failed: 0, baseMs: 150, spreadMs: 0, netMs: 5 },
  run: runRaft,
  metrics: (r) => ({ avg: r.avg, p99: r.p99, failedPct: r.failedPct, splitPct: r.splitPct }),
  metricSpecs: [
    { key: "avg", label: "Avg time to new leader", format: fmt.ms },
    { key: "p99", label: "p99 time to new leader", format: fmt.ms },
    { key: "splitPct", label: "Elections with a split vote", format: fmt.pct },
    { key: "failedPct", label: "No leader within 3 s", format: fmt.pct },
  ],
  View: ({ p, r }) => {
    const hist = [1, 2, 3, 4, 5].map((t) => r.terms.filter((x) => (t < 5 ? x === t : x >= 5)).length);
    return (
      <>
        <p className="small muted">Terms needed to elect a leader (out of 400 elections):</p>
        <Bars values={hist} labels={["1", "2", "3", "4", "5+"]} color={(_, i) => (i === 0 ? "var(--good)" : "var(--warm)")} />
        <Note>
          {p.nodes - 1 - p.failed} of {p.nodes} nodes are alive; a leader needs {Math.floor(p.nodes / 2) + 1} votes. With equal timeouts every node becomes a candidate at once, votes for itself,
          and nobody wins - forever. A little randomness lets one node start first and collect the votes.
        </Note>
      </>
    );
  },
};
