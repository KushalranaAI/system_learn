import { build } from "../presets";
import type { Lab } from "./types";

const store = (dbSize: string, cache: boolean) =>
  build({
    nodes: [
      ["client", "client"],
      ["lb", "lb", { healthChecks: true }],
      ["api1", "server", { size: "l" }],
      ["api2", "server", { size: "l" }],
      ...(cache ? [["cache", "cache", { hitRatio: 0.85 }] as [string, "cache", object]] : []),
      ["db", "db", { size: dbSize }],
    ] as never,
    wires: `client>lb, lb>api1, lb>api2, api1>db, api2>db${cache ? ", api1>cache, api2>cache" : ""}`,
  });

export const productCatalogue: Lab = {
  slug: "product-catalogue",
  module: 3,
  title: "Speed up a product catalogue",
  product: "Online store",
  summary: "20,000 product reads a second against a database that tops out at 15,000. Add a cache, then survive it restarting empty.",
  difficulty: "easy",
  minutes: 25,
  tags: ["cache-aside", "hit ratio", "cold cache"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `An online store. Shoppers browse product pages; sellers occasionally edit prices and stock.

- **20,000 reads/s** at peak, **200 writes/s**.
- Traffic is skewed: a few thousand popular products get most views.
- A price change should show up within a minute; checkout always uses the real price.

The current design sends every read to Postgres.`,
    },
    {
      type: "quiz",
      title: "Keeping the cache honest",
      body: "With cache-aside, the app updates the database when a seller edits a product.",
      question: "What should it do with the cached copy?",
      options: [
        { text: "Write the new product into the cache", why: "Two edits racing can leave the older value in the cache. Writes can arrive at the cache in a different order than at the database." },
        { text: "Delete the cache key", correct: true, why: "Right. Deleting is order-independent: the next read loads the current value from the database. Keep a TTL as a safety net for rare races." },
        { text: "Nothing: the TTL will fix it", why: "Then a price change takes up to a whole TTL to appear. TTLs are the safety net, not the plan." },
      ],
    },
    {
      type: "design",
      title: "Add a cache",
      body: "Run the starter design at peak: the database is overloaded. Add Redis so popular products are served from memory.",
      starter: store("m", false),
      test: {
        traffic: { reads: 20_000, writes: 200, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 100 },
          { type: "budget", maxUsd: 700, why: "a database big enough without a cache costs more" },
          { type: "uses", kind: "cache" },
        ],
      },
      hints: [
        "Add a Cache and wire both API servers to it.",
        "Reads check the cache first; only misses reach the database.",
        "Popular products are cached most of the time: an 80-90% hit ratio is realistic here.",
      ],
      solution: store("m", true),
    },
    {
      type: "design",
      title: "Survive a cache restart",
      body: "At t=10s Redis restarts empty and every read misses. Keep even the worst second at 99% success.",
      test: {
        traffic: { reads: 20_000, writes: 200, bots: 0 },
        incident: { type: "cacheFlush" },
        constraints: [{ type: "successRate", min: 0.99 }, { type: "budget", maxUsd: 900 }],
      },
      hints: [
        "Run the test and watch the database card the moment the cache empties.",
        "For a while, the database sees all 20,000 reads per second.",
        "Give the database headroom for warm-up: a bigger primary, or a read replica wired to both servers.",
      ],
      solution: store("l", true),
    },
    {
      type: "sim",
      title: "Measure it: keys that expire together",
      body: "All 1,000 hot products were cached at the same moment with a 60 s TTL - so they all expire at the same moment. Keep the database under its 3,000 queries/s and failures under 0.1%.",
      sim: "cache-stampede",
      locked: ["rps", "keys", "dbCapacity", "coldRestart", "ttlSec"],
      goals: [
        { metric: "peak", op: "<=", value: 1, label: "Database never above capacity" },
        { metric: "failedPct", op: "<=", value: 0.001, label: "≤ 0.1% of requests fail" },
      ],
      hints: ["Look at the spikes every 60 seconds.", "Add TTL jitter so keys expire at different times."],
      solution: { jitterPct: 20 },
    },
    {
      type: "sim",
      title: "Measure it: the cache restarts empty",
      body: "Now the cache restarts at t=150 s and every key is missing at once. Jitter alone can't help here. Keep the database under capacity and failures under 0.1%.",
      sim: "cache-stampede",
      params: { coldRestart: true },
      locked: ["rps", "keys", "dbCapacity", "coldRestart", "ttlSec"],
      goals: [
        { metric: "peak", op: "<=", value: 1, label: "Database never above capacity" },
        { metric: "failedPct", op: "<=", value: 0.001, label: "≤ 0.1% of requests fail" },
      ],
      hints: ["After a restart there's no stale value to serve.", "Coalescing turns all the misses for a key into one database query.", "Combine jitter, coalescing and stale-while-revalidate."],
      solution: { jitterPct: 20, coalesce: true, staleWhileRevalidate: true },
    },
  ],
};
