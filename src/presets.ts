import type { Graph, Incident, NodeConfig, NodeKind, Resilience, Traffic } from "./engine";
import { autoLayout } from "./state/layout";

/** Tiny builder so presets and labs read like the diagram they describe. */
export function build(spec: { nodes: [string, NodeKind, NodeConfig?][]; wires: string }): Graph {
  const nodes = spec.nodes.map(([id, kind, config]) => ({ id, kind, x: 0, y: 0, config: { ...defaults(kind), ...config } }));
  const edges = spec.wires
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => {
      const [from, to] = w.split(">").map((x) => x.trim());
      return { id: `${from}-${to}`, from, to };
    });
  return autoLayout({ nodes, edges });
}

function defaults(kind: NodeKind): NodeConfig {
  switch (kind) {
    case "server":
      return { size: "s" };
    case "db":
      return { size: "s", role: "primary" };
    case "cache":
      return { hitRatio: 0.8 };
    case "cdn":
      return { hitRatio: 0.6 };
    case "limiter":
      return { limitPerIp: 0 };
    case "lb":
      return { healthChecks: false };
    case "worker":
      return { workers: 2 };
    default:
      return {};
  }
}

export type PresetCategory = "basics" | "interview" | "case-study" | "outage" | "ai";

export const PRESET_CATEGORIES: { id: PresetCategory; title: string; blurb: string }[] = [
  { id: "basics", title: "The basics", blurb: "Small designs to learn the canvas." },
  { id: "interview", title: "Interview classics", blurb: "The most-asked design questions, as a starting design to explain and improve." },
  { id: "case-study", title: "How the big ones scale", blurb: "Real architectures from companies serving millions." },
  { id: "outage", title: "Famous outages", blurb: "Replay what broke, then change the design so it wouldn't." },
  { id: "ai", title: "AI systems", blurb: "LLM serving, retrieval and agents under real load." },
];

export interface Preset {
  id: string;
  title: string;
  blurb: string;
  /** things to try, shown in the sandbox */
  tryThis: string[];
  graph: Graph;
  traffic: Traffic;
  /** where it's listed in the sandbox (default "basics") */
  category?: PresetCategory;
  /** who and when, for case studies and outages, e.g. "Cloudflare · Nov 2025" */
  source?: string;
  /** Markdown: what happened or how it works, and what the design on the canvas stands for */
  story?: string;
  /** lesson id with the full write-up, e.g. "24.2" */
  lesson?: string;
  /** preselected in the timeline, so pressing Run replays the failure */
  incident?: Incident;
  resilience?: Resilience;
}

export const PRESETS: Preset[] = [
  {
    id: "empty",
    title: "Blank canvas",
    blurb: "Just a client. Build anything.",
    tryThis: ["Add an API server and a database, wire Client → API → DB.", "Raise the reads in the Traffic tab until something turns red."],
    graph: build({ nodes: [["client", "client"]], wires: "" }),
    traffic: { reads: 500, writes: 10, bots: 0 },
  },
  {
    id: "single",
    title: "One server, one database",
    blurb: "Where every app starts. Push the reads up until something turns red.",
    tryThis: ["Press ×2 in the Traffic tab twice - which card turns red first?", "Use the Guide's one-click fix, or select the server and pick a bigger machine.", "Run \"Kill: API server\" in the timeline - a single server is a single point of failure."],
    graph: build({ nodes: [["client", "client"], ["api", "server"], ["db", "db"]], wires: "client>api, api>db" }),
    traffic: { reads: 2000, writes: 20, bots: 0 },
  },
  {
    id: "scaled",
    title: "Load balanced",
    blurb: "Three API servers behind a load balancer. Kill one with and without health checks.",
    tryThis: ["Run \"Kill: API server 1\" - a third of requests fail. Why?", "Turn on health checks on the load balancer and run it again.", "Push traffic up: is there still room for one server to die (N+1)?"],
    graph: build({
      nodes: [["client", "client"], ["lb", "lb"], ["api1", "server", { size: "m" }], ["api2", "server", { size: "m" }], ["api3", "server", { size: "m" }], ["db", "db", { size: "l" }]],
      wires: "client>lb, lb>api1, lb>api2, lb>api3, api1>db, api2>db, api3>db",
    }),
    traffic: { reads: 16_000, writes: 100, bots: 0 },
  },
  {
    id: "cached",
    title: "Cache + replicas",
    blurb: "Redis in front of a primary and a read replica. Try a cold cache restart.",
    tryThis: ["Drag the cache hit ratio down and watch the databases.", "Run \"Cache restart\" - can the databases survive the stampede?", "Kill the primary DB with and without automatic failover."],
    graph: build({
      nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "l" }], ["api2", "server", { size: "l" }], ["cache", "cache", { hitRatio: 0.85 }], ["db", "db", { size: "m" }], ["rep", "db", { size: "m", role: "replica" }]],
      wires: "client>lb, lb>api1, lb>api2, api1>cache, api2>cache, api1>db, api2>db, api1>rep, api2>rep",
    }),
    traffic: { reads: 25_000, writes: 300, bots: 0 },
  },
  {
    id: "edge",
    title: "Edge: CDN + rate limiter",
    blurb: "A scraper sends 30k req/s. Watch the limiter save the database.",
    tryThis: ["Set the limiter to 0 (off) - what happens to the database?", "Set it to 10 req/s per IP - who gets blocked now?", "Lower the CDN hit ratio: the origin takes the difference."],
    graph: build({
      nodes: [["client", "client"], ["cdn", "cdn", { hitRatio: 0.7 }], ["rl", "limiter", { limitPerIp: 100 }], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "l" }], ["api2", "server", { size: "l" }], ["cache", "cache"], ["db", "db", { size: "m" }]],
      wires: "client>cdn, cdn>rl, rl>lb, lb>api1, lb>api2, api1>cache, api2>cache, api1>db, api2>db",
    }),
    traffic: { reads: 40_000, writes: 200, bots: 30_000 },
  },
  {
    id: "pipeline",
    title: "Queue + workers",
    blurb: "Writes go to a queue; workers process them. Run a 3x spike and watch the backlog.",
    tryThis: ["Run a 3× traffic spike and watch the queue backlog grow, then drain.", "Add workers - when does the database become the limit?", "Delete the queue: what happens to writes during the spike?"],
    graph: build({
      nodes: [["client", "client"], ["api", "server", { size: "m" }], ["q", "queue"], ["w", "worker", { workers: 8 }], ["db", "db", { size: "m" }]],
      wires: "client>api, api>q, q>w, w>db, api>db",
    }),
    traffic: { reads: 1000, writes: 2000, bots: 0 },
  },
  {
    id: "events",
    title: "Event backbone (Kafka)",
    blurb: "Every write is published to a Kafka topic; two consumer groups (search indexer and email) read the full stream.",
    tryThis: [
      "The email group has 2 consumers for 4,000 events/s - watch its lag. Add consumers.",
      "Give the search group more consumers than partitions - what does the Guide say?",
      "Set the topic's hot key share to 30% - why don't more consumers help?",
    ],
    graph: build({
      nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "l" }], ["api2", "server", { size: "l" }], ["db", "db", { size: "xl" }], ["topic", "kafka", { partitions: 8 }], ["search", "consumer", { consumers: 8 }], ["email", "consumer", { consumers: 2 }]],
      wires: "client>lb, lb>api1, lb>api2, api1>db, api2>db, api1>topic, api2>topic, topic>search, topic>email",
    }),
    traffic: { reads: 6000, writes: 4000, bots: 0 },
  },
  {
    id: "checkout",
    title: "Checkout saga",
    blurb: "Orders run as a saga (reserve stock → charge → confirm) against the database, publishing OrderConfirmed to Kafka. No safeguards yet.",
    tryThis: [
      "Read the saga's line in the Guide: which inconsistency is worst?",
      "Select the saga and turn on safeguards one at a time until 'Inconsistent orders' is none.",
      "Raise the steps per order: what happens to the database?",
    ],
    graph: build({
      nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "l" }], ["api2", "server", { size: "l" }], ["saga", "saga"], ["db", "db", { size: "xl" }], ["topic", "kafka", { partitions: 6 }], ["ship", "consumer", { consumers: 4 }]],
      wires: "client>lb, lb>api1, lb>api2, api1>db, api2>db, api1>saga, api2>saga, saga>db, saga>topic, topic>ship",
    }),
    traffic: { reads: 3000, writes: 1500, bots: 0 },
  },
];
