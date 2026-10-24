import type { NodeConfig, NodeKind, SimNode } from "./types";

export interface ServerSize {
  id: string;
  label: string;
  cap: number;
  usd: number;
}

export interface DbSize {
  id: string;
  label: string;
  readCap: number;
  writeCap: number;
  usd: number;
}

/**
 * Capacities are round, teaching-friendly numbers in the range commonly
 * reported for a small Go/Node service doing one indexed lookup per request.
 * Replace them with your own measurements from bench/ (see docs).
 * Throughput grows slower than cores: contention, GC and the network stack.
 */
export const SERVER_SIZES: ServerSize[] = [
  { id: "s", label: "2 vCPU · 4 GB", cap: 5_000, usd: 40 },
  { id: "m", label: "4 vCPU · 8 GB", cap: 9_000, usd: 80 },
  { id: "l", label: "8 vCPU · 16 GB", cap: 16_000, usd: 160 },
  { id: "xl", label: "16 vCPU · 32 GB", cap: 26_000, usd: 320 },
  { id: "2xl", label: "32 vCPU · 64 GB", cap: 36_000, usd: 640 },
];

export const DB_SIZES: DbSize[] = [
  { id: "s", label: "2 vCPU · 8 GB", readCap: 8_000, writeCap: 2_000, usd: 90 },
  { id: "m", label: "4 vCPU · 16 GB", readCap: 15_000, writeCap: 4_000, usd: 180 },
  { id: "l", label: "8 vCPU · 32 GB", readCap: 28_000, writeCap: 7_000, usd: 360 },
  { id: "xl", label: "16 vCPU · 64 GB", readCap: 45_000, writeCap: 11_000, usd: 720 },
];

/** Keys never spread perfectly: N shards give a bit less than N× capacity. */
export const SHARD_EFFICIENCY = 0.85;
export const shardFactor = (shards?: number) => {
  const n = Math.max(1, Math.round(shards ?? 1));
  return n === 1 ? 1 : n * SHARD_EFFICIENCY;
};

export const WORKER_CAP = 400; // jobs/s per worker process (reference profile)
export const CACHE_CAP = 80_000; // ops/s for one cache node (reference profile)
export const PARTITION_CAP = 10_000; // events/s one Kafka partition accepts
/** A consumer does lighter per-event work than a background job. */
export const consumerCap = () => workerCap() * 2.5;

/**
 * A capacity profile: the numbers the simulator uses for machines it models.
 * "reference" holds round, cloud-like teaching numbers (labs are designed and tested against it).
 * "measured" is produced by `npm run bench`, which runs real servers on this machine.
 */
export interface CapacityProfile {
  id: "reference" | "measured";
  label: string;
  source: string;
  serverSizes: ServerSize[];
  dbSizes: DbSize[];
  cacheCap: number;
  workerCap: number;
}

export const REFERENCE_PROFILE: CapacityProfile = {
  id: "reference",
  label: "Reference (cloud teaching numbers)",
  source: "Round numbers typical of small cloud machines; labs are tuned to these.",
  serverSizes: SERVER_SIZES,
  dbSizes: DB_SIZES,
  cacheCap: CACHE_CAP,
  workerCap: WORKER_CAP,
};

let active: CapacityProfile = REFERENCE_PROFILE;
export const activeProfile = () => active;
export const setActiveProfile = (p: CapacityProfile) => {
  active = p;
};
/** Run `fn` with a profile active (labs are always checked against the reference profile). */
export function withProfile<T>(p: CapacityProfile, fn: () => T): T {
  const prev = active;
  active = p;
  try {
    return fn();
  } finally {
    active = prev;
  }
}

export const serverSizes = () => active.serverSizes;
export const dbSizes = () => active.dbSizes;
export const workerCap = () => active.workerCap;
export const cacheCap = () => active.cacheCap;
export const serverSize = (id?: string) => active.serverSizes.find((s) => s.id === id) ?? active.serverSizes[0];
export const dbSize = (id?: string) => active.dbSizes.find((s) => s.id === id) ?? active.dbSizes[0];
export const BOT_IPS = 4; // the scraper rotates through a handful of IPs
export const NAT_SHARE = 0.03; // share of real users behind a shared IP (office, carrier NAT)
export const NAT_IP_RPS = 40; // requests/s from one busy shared IP
export const USER_IP_RPS = 2; // requests/s from one ordinary user

export interface KindSpec {
  kind: NodeKind;
  label: string;
  short: string;
  blurb: string;
  /** base service time per request in ms (includes one network hop) */
  ms: number;
  /** fixed capacity in req/s (server/db/worker compute theirs) */
  cap: number;
  usd: number;
  color: string;
  icon: string;
  defaults: NodeConfig;
}

export const KINDS: Record<NodeKind, KindSpec> = {
  client: {
    kind: "client", label: "Client", short: "Client", icon: "📱", color: "#94a3b8",
    blurb: "Users' apps and browsers. Every request starts here.",
    ms: 0, cap: Infinity, usd: 0, defaults: {},
  },
  cdn: {
    kind: "cdn", label: "CDN", short: "CDN", icon: "🌍", color: "#38bdf8",
    blurb: "Edge servers near users. Answers cacheable reads without touching your servers. Writes and bot traffic for random URLs pass through.",
    ms: 4, cap: 1_000_000, usd: 50, defaults: { hitRatio: 0.6 },
  },
  limiter: {
    kind: "limiter", label: "Rate limiter", short: "Limiter", icon: "🚦", color: "#f59e0b",
    blurb: "Counts requests per IP at the edge and rejects the excess with 429. Too strict and it also blocks offices and mobile carriers that share one IP.",
    ms: 0.3, cap: 500_000, usd: 30, defaults: { limitPerIp: 0 },
  },
  lb: {
    kind: "lb", label: "Load balancer", short: "LB", icon: "⚖️", color: "#a78bfa",
    blurb: "Spreads requests evenly across API servers. With health checks on, it stops sending to dead servers.",
    ms: 0.5, cap: 150_000, usd: 25, defaults: { healthChecks: false },
  },
  server: {
    kind: "server", label: "API server", short: "API", icon: "🖥️", color: "#10b981",
    blurb: "Runs your code: reads from the cache, falls back to the database, writes to the primary (or hands writes to a queue).",
    ms: 2, cap: 0, usd: 0, defaults: { size: "s" },
  },
  cache: {
    kind: "cache", label: "Cache (Redis)", short: "Cache", icon: "⚡", color: "#ef4444",
    blurb: "In-memory key-value store. Hits skip the database. Bots asking for random keys always miss.",
    ms: 0.4, cap: 80_000, usd: 60, defaults: { hitRatio: 0.8 },
  },
  db: {
    kind: "db", label: "Database", short: "DB", icon: "🗄️", color: "#3b82f6",
    blurb: "Postgres-style relational database. The primary takes writes; replicas copy every write and add read capacity, a few ms behind.",
    ms: 2, cap: 0, usd: 0, defaults: { size: "s", role: "primary" },
  },
  queue: {
    kind: "queue", label: "Queue", short: "Queue", icon: "📬", color: "#eab308",
    blurb: "Accepts writes instantly and holds them until workers process them. Users get a fast reply; the work happens later.",
    ms: 1, cap: 50_000, usd: 40, defaults: {},
  },
  worker: {
    kind: "worker", label: "Workers", short: "Workers", icon: "⚙️", color: "#14b8a6",
    blurb: `Background processes that pull jobs off the queue and write results to the database. Throughput per process comes from the active capacity profile.`,
    ms: 20, cap: 0, usd: 0, defaults: { workers: 2 },
  },
  kafka: {
    kind: "kafka", label: "Kafka topic", short: "Kafka", icon: "📜", color: "#fb923c",
    blurb: "A partitioned, durable log. Services publish events once; every consumer group reads the whole stream at its own pace. Order is kept only within a partition.",
    ms: 2, cap: 0, usd: 0, defaults: { partitions: 6, hotKeyPct: 0 },
  },
  consumer: {
    kind: "consumer", label: "Consumer group", short: "Consumers", icon: "👥", color: "#22d3ee",
    blurb: "Instances that share a topic's partitions - one consumer per partition at most. If they can't keep up, lag (events behind) grows.",
    ms: 1, cap: 0, usd: 0, defaults: { consumers: 3 },
  },
  saga: {
    kind: "saga", label: "Saga orchestrator", short: "Saga", icon: "🧭", color: "#e879f9",
    blurb: "Runs each order as a sequence of local transactions (reserve stock, charge, confirm) with compensations. Its safeguards decide how many orders end inconsistent.",
    ms: 1, cap: 50_000, usd: 60, defaults: { sagaSteps: 3, compensate: false, queryTimeouts: false, idempotencyKeys: false, outbox: false, dedupeConsumers: false },
  },
};

export const PALETTE: NodeKind[] = ["client", "cdn", "limiter", "lb", "server", "cache", "db", "queue", "worker", "kafka", "consumer", "saga"];

export function nodeMonthlyUsd(n: SimNode): number {
  switch (n.kind) {
    case "server":
      return serverSize(n.config.size).usd;
    case "db":
      return dbSize(n.config.size).usd * Math.max(1, Math.round(n.config.shards ?? 1));
    case "worker":
      return 30 * (n.config.workers ?? 1);
    case "kafka":
      return 50 + 10 * (n.config.partitions ?? 1);
    case "consumer":
      return 30 * (n.config.consumers ?? 1);
    default:
      return KINDS[n.kind].usd;
  }
}

export function nodeTitle(n: SimNode, all: SimNode[]): string {
  const same = all.filter((m) => m.kind === n.kind && (n.kind !== "db" || m.config.role === n.config.role));
  const idx = same.indexOf(n);
  const base =
    n.kind === "db" ? (n.config.role === "replica" ? "Replica" : "Primary DB") : KINDS[n.kind].label;
  return same.length > 1 ? `${base} ${idx + 1}` : base;
}

/** p99 time in one M/M/1 queue: service time × ln(100) / (1 − utilisation). */
export function hopP99(ms: number, util: number): number {
  if (ms === 0) return 0;
  return Math.min(2000, (ms * Math.log(100)) / (1 - Math.min(util, 0.99)));
}
