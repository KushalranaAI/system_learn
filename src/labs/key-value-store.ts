import { build } from "../presets";
import type { Lab } from "./types";

const kv = (shards: number) =>
  build({
    nodes: [
      ["client", "client"],
      ["lb", "lb", { healthChecks: true }],
      ...[1, 2, 3, 4, 5].map((i) => [`api${i}`, "server", { size: "xl" }] as [string, "server", { size: string }]),
      ["db", "db", { size: "l", shards, role: "primary" }],
    ],
    wires: ["client>lb", ...[1, 2, 3, 4, 5].map((i) => `lb>api${i}, api${i}>db`)].join(","),
  });

export const keyValueStore: Lab = {
  slug: "key-value-store",
  module: 14,
  title: "Design a key-value store",
  product: "Shopping carts",
  summary: "90,000 operations a second, always writable, carts never lost. Partition with consistent hashing, pick quorums, and merge conflicts.",
  difficulty: "hard",
  minutes: 30,
  tags: ["consistent hashing", "sharding", "quorums", "CRDTs", "gossip"],
  steps: [
    {
      type: "intro",
      title: "The requirements",
      body: `A shopping-cart service for a big e-commerce site.

- **60,000 reads/s** and **30,000 writes/s** at peak.
- Carts must **always accept writes**, even when nodes fail. A lost "add to cart" is lost revenue.
- Concurrent edits from phone and laptop must not lose items.

On the canvas, the "database" stands in for the key-value cluster; its **Shards** setting is the number of
partitions spread across nodes.`,
    },
    {
      type: "design",
      title: "Scale writes with partitions",
      body: "One node can't take 30,000 writes a second. Partition the store: raise the database's Shards until the cluster holds the load with headroom.",
      starter: kv(1),
      test: {
        traffic: { reads: 60_000, writes: 30_000, bots: 0 },
        constraints: [{ type: "successRate", min: 0.99 }, { type: "p99", maxMs: 100 }],
      },
      hints: [
        "Select the database: the card is far past 100%.",
        "Raise Shards. Each shard is a full 8 vCPU node; capacity grows about 85% per shard.",
        "Aim for the database to sit around 70% - roughly 10-12 shards.",
      ],
      solution: kv(11),
    },
    {
      type: "quiz",
      title: "Placing keys",
      body: "The cluster grows from 11 to 12 nodes during a sale.",
      question: "Which placement scheme moves the fewest carts?",
      options: [
        { text: "node = hash(cart_id) % N", why: "Changing N from 11 to 12 remaps roughly 11/12 of all keys - a migration storm mid-sale." },
        { text: "Consistent hashing with virtual nodes", correct: true, why: "Right. Only about 1/12 of the keys move, taken evenly from all nodes thanks to virtual nodes." },
        { text: "Range partitioning by cart_id", why: "Sequential cart ids would make the newest range a write hot spot." },
      ],
    },
    {
      type: "quiz",
      title: "Quorums",
      body: "Each cart lives on N=3 replicas. Writes must succeed with one replica down, and reads should see the latest acknowledged write.",
      question: "Choose W and R.",
      options: [
        { text: "W=3, R=1", why: "Any single replica being down blocks every write - violating 'always writable'." },
        { text: "W=2, R=2", correct: true, why: "Right. One replica can be down for writes, and 2 + 2 > 3 means read and write sets always overlap. Hinted handoff and read repair heal the lagging replica." },
        { text: "W=1, R=1", why: "Most available, but reads can miss the latest write (1 + 1 is not > 3)." },
      ],
    },
    {
      type: "quiz",
      title: "Concurrent cart edits",
      body: "Phone (offline) adds 'shoes'. Laptop adds 'socks' and removes 'hat'. Both sync.",
      question: "How should the store merge the two versions?",
      options: [
        { text: "Last-write-wins on the whole cart", why: "One device's changes would vanish - lost items, lost sales." },
        { text: "An OR-Set of items, detected via version vectors", correct: true, why: "Right. Version vectors show the edits were concurrent; the OR-Set merge keeps both adds and applies the remove: {shoes, socks}." },
        { text: "Reject the second write", why: "That breaks 'always writable' and frustrates the user." },
      ],
    },
    {
      type: "quiz",
      title: "Knowing who's alive",
      body: "Nodes need to know cluster membership and which nodes are down, without a central coordinator on the request path.",
      question: "What's the usual approach in Dynamo-style stores?",
      options: [
        { text: "Every node pings every other node every second", why: "That's N² messages - fine for 5 nodes, heavy for hundreds." },
        { text: "Gossip membership + a phi-accrual failure detector; ring changes are explicit operator actions", correct: true, why: "Right. Gossip spreads state in O(log N) rounds; the detector adapts to network jitter; and a flapping node doesn't trigger data movement." },
        { text: "A single master node tracks everything", why: "It becomes a bottleneck and a single point of failure on every request." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: placing 20,000 keys",
      body: "The cluster grows from 10 to 11 nodes. With hash % N, almost every key moves. Choose a placement that moves at most 12% of keys and keeps the busiest node within 20% of average.",
      sim: "hash-ring",
      locked: ["nodes", "add", "keys", "skew"],
      goals: [
        { metric: "moved", op: "<=", value: 0.12, label: "≤ 12% of keys move" },
        { metric: "imbalance", op: "<=", value: 1.2, label: "Busiest node ≤ 1.2x average" },
      ],
      hints: ["Switch from modulo to a consistent-hash ring.", "One position per node gives very uneven arcs - add virtual nodes (try 256)."],
      solution: { scheme: "ring", vnodes: 256 },
    },
    {
      type: "sim",
      title: "Measure it: the celebrity key",
      body: "Popularity is now skewed (Zipf s = 1): the top key alone is about 10% of traffic. Get the busiest node under 1.3x average.",
      sim: "hash-ring",
      params: { scheme: "ring", vnodes: 256, skew: 1 },
      locked: ["nodes", "add", "keys", "skew"],
      goals: [{ metric: "imbalance", op: "<=", value: 1.3, label: "Busiest node ≤ 1.3x average" }],
      hints: ["More virtual nodes won't help - one key always lands on one node.", "Split the hottest keys into sub-keys spread over several nodes."],
      solution: { saltHot: true },
    },
  ],
};
