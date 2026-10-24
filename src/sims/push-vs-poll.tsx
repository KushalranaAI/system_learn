import { rng } from "./rng";
import { fmt, type SimDef } from "./types";
import { Note } from "./ui";

type P = {
  users: number;
  updateEverySec: number;
  mode: "poll" | "sse" | "websocket";
  pollEverySec: number;
  connsPerGateway: number;
  gateways: number;
};

interface R {
  requestsPerSec: number;
  messagesPerSec: number;
  avgDelaySec: number;
  wastedPct: number;
  connections: number;
  gatewayLoad: number;
}

/**
 * Users watch a value that changes every `updateEverySec`. Polling costs users / interval requests per second and
 * delivers a change on the next poll (sampled delay). Push keeps one connection per user and sends one message per
 * change, delivered within network time - but every connection must fit on a gateway.
 */
export function runPushVsPoll(p: P): R {
  const r = rng(6);
  if (p.mode === "poll") {
    const rps = p.users / p.pollEverySec;
    let delay = 0;
    const N = 10000;
    for (let i = 0; i < N; i++) delay += r() * p.pollEverySec;
    const useful = Math.min(1, p.pollEverySec / p.updateEverySec);
    return { requestsPerSec: rps, messagesPerSec: rps * useful, avgDelaySec: delay / N, wastedPct: 1 - useful, connections: 0, gatewayLoad: 0 };
  }
  const msgs = p.users / p.updateEverySec;
  return {
    requestsPerSec: 0,
    messagesPerSec: msgs,
    avgDelaySec: 0.05 + r() * 0.02,
    wastedPct: 0,
    connections: p.users,
    gatewayLoad: p.users / (p.gateways * p.connsPerGateway),
  };
}

export const pushVsPoll: SimDef<P, R> = {
  id: "push-vs-poll",
  title: "Polling vs push",
  module: 6,
  lessons: ["6.1", "6.2", "6.6"],
  blurb: "One million fans watch a score. Compare polling with server push: request load, wasted work, delivery delay, and how many gateways the open connections need.",
  params: [
    { key: "users", label: "Concurrent users", type: "number", min: 1000, max: 5000000, log: true },
    { key: "updateEverySec", label: "The value changes every", type: "number", min: 1, max: 300, unit: "s" },
    { key: "mode", label: "Delivery", type: "select", options: [{ value: "poll", label: "Short polling" }, { value: "sse", label: "Server-Sent Events" }, { value: "websocket", label: "WebSockets" }] },
    { key: "pollEverySec", label: "Poll interval", type: "number", min: 1, max: 60, unit: "s" },
    { key: "gateways", label: "Push gateways", type: "number", min: 1, max: 100 },
    { key: "connsPerGateway", label: "Connections per gateway (safe)", type: "number", min: 10000, max: 500000, step: 10000 },
  ],
  defaults: { users: 1_000_000, updateEverySec: 6, mode: "poll", pollEverySec: 2, gateways: 4, connsPerGateway: 100000 },
  run: runPushVsPoll,
  metrics: (r) => ({ requestsPerSec: r.requestsPerSec, avgDelaySec: r.avgDelaySec, gatewayLoad: r.gatewayLoad, wasted: r.wastedPct }),
  metricSpecs: [
    { key: "requestsPerSec", label: "Requests/s to your API", format: fmt.n },
    { key: "avgDelaySec", label: "Avg delay to see a change", format: fmt.s },
    { key: "wasted", label: "Responses with nothing new", format: fmt.pct },
    { key: "gatewayLoad", label: "Gateway fill (connections ÷ capacity)", format: fmt.pct },
  ],
  View: ({ p, r }) => (
    <Note>
      {p.mode === "poll"
        ? `${fmt.n(r.requestsPerSec)} requests/s, ${fmt.pct(r.wastedPct)} of them answer "no change". Fans see updates ${fmt.s(r.avgDelaySec)} late on average.`
        : `${fmt.n(r.connections)} open connections over ${p.gateways} gateway(s) (${fmt.pct(r.gatewayLoad)} full) and ${fmt.n(r.messagesPerSec)} messages/s. ${r.gatewayLoad > 1 ? "The gateways can't hold them all - add gateways." : r.gatewayLoad > 0.8 ? "No headroom to lose a gateway or deploy one." : "Room to lose a gateway."}`}
    </Note>
  ),
};
