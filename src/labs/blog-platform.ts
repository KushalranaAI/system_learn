import { build } from "../presets";
import type { Lab } from "./types";

const servers = [1, 2, 3, 4];
const blog = (dbs: [string, string, "primary" | "replica"][]) =>
  build({
    nodes: [
      ["client", "client"],
      ["lb", "lb", { healthChecks: true }],
      ...servers.map((i) => [`api${i}`, "server", { size: "l" }] as [string, "server", { size: string }]),
      ...dbs.map(([id, size, role]) => [id, "db", { size, role }] as [string, "db", { size: string; role: "primary" | "replica" }]),
    ],
    wires: ["client>lb", ...servers.flatMap((i) => [`lb>api${i}`, ...dbs.map(([id]) => `api${i}>${id}`)])].join(","),
  });

export const blogPlatform: Lab = {
  slug: "blog-platform",
  module: 5,
  title: "Scale a blog platform's database",
  product: "Blogging",
  summary: "40,000 reads a second on one database. Add read replicas, then survive the primary dying.",
  difficulty: "medium",
  minutes: 25,
  tags: ["read replicas", "replication lag", "failover"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A blogging platform. Readers far outnumber writers.

- **40,000 reads/s** and **800 writes/s** at peak.
- Four 8 vCPU API servers behind a load balancer - they have plenty of room.
- One big 16 vCPU Postgres that's nearly flat out.
- Budget: **$1,800/month**.`,
    },
    {
      type: "quiz",
      title: "Where did my post go?",
      body: "You add read replicas. An author publishes a post and immediately reloads their dashboard, which reads from a replica.",
      question: "Sometimes the new post is missing. Why?",
      options: [
        { text: "The write failed", why: "The write succeeded on the primary - the replica just hasn't replayed it yet." },
        { text: "Replication lag: the replica is a few ms behind", correct: true, why: "Right. Async replicas trail the primary. Send a user's reads to the primary for a few seconds after they write (read-your-writes)." },
        { text: "The cache is stale", why: "There's no cache in this design - it's the replica being behind." },
      ],
    },
    {
      type: "design",
      title: "Add read replicas",
      body: "Run the starter: the single database is ~96% busy, so latency explodes. Spread reads over replicas within budget.",
      starter: blog([["db", "xl", "primary"]]),
      test: {
        traffic: { reads: 40_000, writes: 800, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 100 },
          { type: "budget", maxUsd: 1800 },
          { type: "uses", kind: "db", min: 2, why: "spread reads over copies" },
        ],
      },
      hints: [
        "Add a Database and set its role to 'Read replica' in the inspector.",
        "Wire every API server to every database. Reads spread across all of them; writes go to the primary.",
        "Several 8 vCPU databases cost less than two 16 vCPU ones - try one primary and two replicas.",
      ],
      solution: blog([["db", "l", "primary"], ["rep1", "l", "replica"], ["rep2", "l", "replica"]]),
    },
    {
      type: "design",
      title: "The primary dies",
      body: "At t=10s the primary crashes. Reads can continue from replicas, but writes need a new primary. Recover within 20 seconds.",
      test: {
        traffic: { reads: 40_000, writes: 800, bots: 0 },
        incident: { type: "killKind", kind: "db", role: "primary" },
        constraints: [{ type: "recovery", maxSeconds: 20 }, { type: "uses", kind: "db", min: 2 }],
      },
      hints: [
        "Run the test without changes: writes fail forever.",
        "Turn on 'Automatic DB failover' in the timeline bar under the canvas.",
        "Failover takes 15 s to detect the failure and promote a replica. The remaining databases must have room for all reads.",
      ],
      solution: blog([["db", "l", "primary"], ["rep1", "l", "replica"], ["rep2", "l", "replica"]]),
      solutionResilience: { dbFailover: true },
    },
  ],
};
