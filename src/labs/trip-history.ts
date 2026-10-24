import { build } from "../presets";
import type { Lab } from "./types";

const rides = (db: { size: string; shards?: number }, replica = false) =>
  build({
    nodes: [
      ["client", "client"],
      ["lb", "lb", { healthChecks: true }],
      ["api1", "server", { size: "l" }],
      ["api2", "server", { size: "l" }],
      ["api3", "server", { size: "l" }],
      ["db", "db", { ...db, role: "primary" }],
      ...(replica ? [["rep", "db", { size: db.size, role: "replica" }] as [string, "db", object]] : []),
    ] as never,
    wires: ["client>lb", ...[1, 2, 3].map((i) => `lb>api${i}, api${i}>db${replica ? `, api${i}>rep` : ""}`)].join(","),
  });

export const tripHistory: Lab = {
  slug: "trip-history",
  module: 9,
  title: "Shard a trip history",
  product: "Ride hailing",
  summary: "20,000 trip events written every second - more than the biggest database can take. Replicas won't help; shards will.",
  difficulty: "medium",
  minutes: 25,
  tags: ["sharding", "shard keys", "write scaling", "partitioning"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A ride-hailing app stores every trip event: requested, accepted, started, checkpoints, ended, rated.

- **20,000 writes/s** and **5,000 reads/s** ("my trips") at peak.
- The biggest single database handles about **11,000 writes/s**.
- Budget: **$2,400/month**.`,
    },
    {
      type: "design",
      title: "Will a replica help?",
      body: "A teammate says: 'Add a read replica to take the load off the primary.' Their design is loaded - run it.",
      starter: rides({ size: "xl" }, true),
      test: {
        traffic: { reads: 5000, writes: 20_000, bots: 0 },
        constraints: [{ type: "successRate", min: 0.99 }, { type: "p99", maxMs: 100 }, { type: "budget", maxUsd: 2400 }],
      },
      hints: [
        "Run it and look at both database cards: the replica is just as busy as the primary. Why?",
        "Replicas replay every write. Delete the replica - you need more *write* capacity.",
        "Select the primary and raise its Shards. Five 8 vCPU shards fit the budget with headroom.",
      ],
      solution: rides({ size: "l", shards: 5 }),
    },
    {
      type: "quiz",
      title: "Choosing the shard key",
      body: "Most reads are 'show my trips' for a rider. Writes are trip events.",
      question: "Which shard key fits best?",
      options: [
        { text: "trip_id (hashed)", why: "Writes spread evenly, but 'my trips' would scatter across every shard - every read becomes scatter-gather." },
        { text: "rider_id (hashed)", correct: true, why: "Right. All of a rider's trips live on one shard, so 'my trips' is a single-shard query, and riders are numerous enough to spread load evenly. Drivers get a second copy keyed by driver_id." },
        { text: "created_at (by month)", why: "All new writes land on the newest shard - exactly the hot spot sharding should avoid." },
      ],
    },
    {
      type: "quiz",
      title: "Adding a sixth shard",
      body: "You shard by hash(rider_id) % 5. Next year you need a sixth server.",
      question: "How should you have set things up so this is cheap?",
      options: [
        { text: "hash % N is fine - just change 5 to 6", why: "That remaps about 5/6 of all riders - you'd move nearly the whole dataset." },
        { text: "Hash into many logical shards (e.g. 1,024) mapped onto servers", correct: true, why: "Right. Adding a server means reassigning some logical shards to it (copy → catch up → cut over), with no re-hashing. Consistent hashing gets a similar effect." },
        { text: "Never reshard - buy bigger shards instead", why: "That works until the biggest machine, which is exactly where you started." },
      ],
    },
  ],
};
