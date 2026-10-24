export type NodeKind =
  | "client"
  | "cdn"
  | "limiter"
  | "lb"
  | "server"
  | "cache"
  | "db"
  | "queue"
  | "worker"
  | "kafka"
  | "consumer"
  | "saga";

export interface NodeConfig {
  /** server / db machine size id */
  size?: string;
  /** cache & cdn: share of reads answered without going further (0..0.95) */
  hitRatio?: number;
  /** limiter: allowed requests per second per IP (0 = off) */
  limitPerIp?: number;
  /** lb: skip dead servers */
  healthChecks?: boolean;
  /** db: split the data across N shards (each a full machine of `size`) */
  shards?: number;
  /** db: primary takes writes, replicas only serve reads */
  role?: "primary" | "replica";
  /** worker: number of worker processes */
  workers?: number;
  /** kafka: number of partitions */
  partitions?: number;
  /** kafka: share of events (%) carrying one hot key - they all land in one partition */
  hotKeyPct?: number;
  /** consumer: consumer instances in the group */
  consumers?: number;
  /** saga: local transactions per order */
  sagaSteps?: number;
  /** saga safeguards */
  compensate?: boolean;
  queryTimeouts?: boolean;
  idempotencyKeys?: boolean;
  outbox?: boolean;
  dedupeConsumers?: boolean;
}

export interface SimNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  config: NodeConfig;
}

export interface SimEdge {
  id: string;
  from: string;
  to: string;
}

export interface Graph {
  nodes: SimNode[];
  edges: SimEdge[];
}

/** Requests per second the client sends, by class. */
export interface Traffic {
  reads: number;
  writes: number;
  /** abusive traffic (scraper / bot) that asks for random URLs from a few IPs */
  bots: number;
}

/** Things that change during an incident timeline. */
export interface Conditions {
  down: string[];
  /** 0 = cold cache, 1 = fully warm */
  cacheWarm: number;
  /** when the primary DB is down: has a replica been promoted yet? */
  promoted: boolean;
  /** route around dead databases (driver-level health checks + automatic failover) */
  dbFailover: boolean;
  /** extra queued jobs workers may drain this second (backlog) */
  backlogDrain: number;
  /** per consumer group: events waiting from earlier seconds (lag) */
  lagDrain: Record<string, number>;
}

export interface NodeResult {
  load: number;
  util: number;
  served: number;
  dropped: number;
  p99Ms: number;
  down: boolean;
  /** db only */
  reads?: number;
  writes?: number;
  /** consumer only: how fast lag grows (events/s; negative = draining) */
  lagGrowth?: number;
  /** consumer only: instances with no partition to read */
  idle?: number;
}

export interface EdgeResult {
  rps: number;
  /** 0..1 share of this edge's traffic dropped at its target */
  dropShare: number;
}

export type Severity = "error" | "warn" | "info";

export interface Issue {
  severity: Severity;
  text: string;
  nodeId?: string;
}

export interface SimResult {
  /** legit requests per second offered (reads + writes) */
  legit: number;
  /** legit requests per second answered correctly */
  success: number;
  successRate: number;
  failed: number;
  /** legit requests rejected by the rate limiter */
  legitLimited: number;
  bots: number;
  botsBlocked: number;
  botsServed: number;
  /** approximate p99 latency of successful requests, ms */
  p99: number;
  /** replica lag, ms (0 when no replicas) */
  lagMs: number;
  /** reads per second that return stale data from a lagging replica */
  stale: number;
  /** async jobs accepted / completed per second */
  queueIn: number;
  jobsDone: number;
  /** events published to Kafka per second */
  eventsIn: number;
  /** sum over consumer groups of positive lag growth (events/s) */
  lagGrowth: number;
  /** orders per second that end inconsistent (sagas) */
  inconsistent: number;
  /** orders per second handled by sagas */
  sagaOrders: number;
  monthlyUsd: number;
  nodes: Record<string, NodeResult>;
  edges: Record<string, EdgeResult>;
  issues: Issue[];
}
