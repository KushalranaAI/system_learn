import { build } from "../presets";
import type { Lab } from "./types";

export const rideDispatch: Lab = {
  slug: "ride-dispatch",
  module: 26,
  title: "Ride dispatch",
  product: "Maps",
  summary: "Tens of thousands of drivers report where they are every few seconds; riders want a car in seconds. Index locations by cell, stream updates through a log, and never offer one driver to two riders.",
  difficulty: "hard",
  minutes: 30,
  tags: ["geo indexes", "geohash", "streams", "Kafka", "leases"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A ride-hailing app in one large city.

- **50,000 drivers** online at peak, each sending a GPS location **every 4 seconds**: **12,500 location updates/s**.
- Riders open the app about **15,000 times/s** across the evening to see cars nearby, and request about **300 rides/s**.
- A request should be matched with a nearby available driver within **a few seconds**.
- A location more than a few seconds old is useless: the car has moved 50 metres.`,
    },
    {
      type: "quiz",
      title: "Indexing locations",
      body: "The first version stores driver positions in a Postgres table with B-tree indexes on lat and on lng, and finds nearby drivers with `WHERE lat BETWEEN … AND lng BETWEEN …`.",
      question: "Why does that struggle, and what's better?",
      options: [
        { text: "It's fine - B-trees are fast", why: "A B-tree on lat finds a horizontal strip across the whole city; the database then filters it by lng. Each query reads far more rows than it returns, while 12,500 updates/s churn both indexes." },
        { text: "Index by cell: encode each position as a geohash (or H3/S2 cell) and look up the rider's cell and its neighbours, in memory", correct: true, why: "Right. Nearby points share a cell prefix, so \"near me\" becomes a few key lookups. Keep the live index in memory (e.g. Redis GEO, or a sharded in-memory service) - it's rebuilt every few seconds anyway." },
        { text: "Scan all drivers in application memory for every request", why: "50,000 distance calculations per query × thousands of queries per second. Works in a prototype, not at peak." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: downtown, 500 m",
      body: "50,000 drivers. In dense downtown you only want cars within **500 m**. Find at least 99% of them, checking no more than 2% of all drivers per query.",
      sim: "geohash",
      params: { drivers: 50000, radiusKm: 0.5 },
      locked: ["drivers", "radiusKm"],
      goals: [
        { metric: "recall", op: ">=", value: 0.99, label: "Find ≥ 99% of nearby drivers" },
        { metric: "scanned", op: "<=", value: 0.02, label: "Check ≤ 2% of drivers per query" },
      ],
      hints: [
        "Scanning finds everyone but checks every driver.",
        "Looking only in the rider's own cell misses drivers just across a cell edge.",
        "Search the cell plus its 8 neighbours, with cells a bit bigger than the radius: precision 6 cells are about 1.2 × 0.6 km here.",
      ],
      solution: { mode: "neighbors", precision: 6 },
    },
    {
      type: "quiz",
      title: "12,500 updates a second",
      body: "Location updates feed the live index, ETA estimates, surge pricing and trip history. Each consumer works at its own pace.",
      question: "How should updates flow?",
      options: [
        { text: "Each update is an HTTP call from the driver gateway to every one of those services", why: "Four services × 12,500 calls/s, and a slow surge service would slow the gateway down." },
        { text: "Publish each update to a log (Kafka) keyed by driver_id; each service reads it in its own consumer group", correct: true, why: "Right. One write per update; per-driver order is kept within a partition; the index consumer can skip stale points while trip history keeps every one. A slow consumer only falls behind itself." },
        { text: "Write every update to Postgres and have services poll it", why: "12,500 writes/s of data that's stale in seconds, and every service polling adds load and delay." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: keep locations fresh",
      body: "The index consumers read 13,000 updates/s; each handles about 2,000/s. The topic has 8 partitions and 8 consumers. At t=40 s a consumer crashes. A location more than 4 s old is useless - stay fresh.",
      sim: "kafka-log",
      params: { producerRps: 13000, partitions: 8, consumers: 8, perConsumerRps: 2000, crash: true, rebalance: "eager" },
      locked: ["producerRps", "perConsumerRps", "crash", "hotKeyPct"],
      goals: [
        { metric: "maxLagAge", op: "<=", value: 4, label: "Never more than 4 s behind" },
        { metric: "finalLag", op: "<=", value: 1000, label: "Lag at the end ≤ 1,000" },
      ],
      hints: [
        "After the crash, 7 consumers share 8 partitions: one gets two (3,250 updates/s) and falls behind forever.",
        "More, smaller partitions spread the work of a dead consumer more evenly. Try 16 partitions and 16 consumers.",
        "An eager rebalance stops every consumer for ~10 s. Switch to cooperative.",
      ],
      solution: { partitions: 16, consumers: 16, rebalance: "cooperative" },
    },
    {
      type: "quiz",
      title: "One driver, two riders",
      body: "Two matchers, handling two riders 200 m apart, both pick driver D-77 as the best match at the same moment.",
      question: "How do you make sure D-77 gets only one offer?",
      options: [
        { text: "Whichever offer reaches the phone first wins", why: "The driver sees two offers, accepts one, and the other rider waits for a car that isn't coming." },
        { text: "Claim the driver atomically before offering: available → offered (with a 15 s lease), e.g. SET driver:D-77 offer:R-1 NX EX 15", correct: true, why: "Right. One matcher's claim succeeds and the other's fails, so it picks the next driver. If the driver doesn't answer, the lease expires and they're available again." },
        { text: "Only run one matcher for the whole city", why: "It avoids the race but is a single point of failure and a throughput ceiling. Shard matching by area and still claim drivers atomically - riders near a border can see drivers in two shards." },
      ],
    },
    {
      type: "api",
      title: "The dispatch API",
      body: "Design the endpoints: a driver reports a location, a rider requests a ride, and a driver accepts an offer (which may already be gone).",
      baseUrl: "https://rides.example",
      expect: [
        { goal: "Report a driver's location", methods: ["PUT", "POST"], statuses: [204, 202], needsParam: true, why: "PUT /drivers/:id/location with lat, lng, heading and a timestamp. Nothing to return - 204 (or 202, since it's processed asynchronously). In production this usually rides a persistent connection." },
        { goal: "Request a ride", methods: ["POST"], statuses: [201, 202], why: "POST /rides creates the request and returns its id. Matching happens asynchronously; the app listens for 'driver assigned'." },
        { goal: "Accept an offer", methods: ["POST"], statuses: [200, 409], needsParam: true, why: "POST /rides/:id/accept. 200 when the lease is still yours; 409 Conflict when it expired or the rider cancelled." },
      ],
    },
    {
      type: "design",
      title: "Build it on the canvas: the location pipeline",
      body: "Peak: **15,000 nearby-driver reads/s** and **5,000 location writes/s** (gateways batch and drop redundant points). Answer reads from an in-memory **geo index** (a Redis cache, ~90% hits), keep every point for trip history in the database, and publish each update to a **Kafka topic** that an **index consumer group** reads to update the geo index - without falling behind. Budget: **$1,600/month**.",
      starter: build({
        nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "m" }], ["api2", "server", { size: "m" }], ["db", "db", { size: "l" }]],
        wires: "client>lb, lb>api1, lb>api2, api1>db, api2>db",
      }),
      test: {
        traffic: { reads: 15_000, writes: 5_000, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 80 },
          { type: "uses", kind: "cache", why: "the live geo index" },
          { type: "uses", kind: "kafka", why: "the location stream" },
          { type: "consumerLag", maxGrowth: 0 },
          { type: "budget", maxUsd: 1600 },
        ],
      },
      hints: [
        "20,000 req/s overloads two 4 vCPU servers - use 8 vCPU servers.",
        "Add a Redis cache for nearby lookups, a Kafka topic every server publishes to, and a consumer group reading the topic that writes into the cache.",
        "5,000 writes/s is most of an 8 vCPU database's write capacity - give it room. 5,000 events/s with ~1,000 per consumer: 8 partitions, 8 consumers.",
      ],
      solution: build({
        nodes: [
          ["client", "client"],
          ["lb", "lb", { healthChecks: true }],
          ["api1", "server", { size: "l" }],
          ["api2", "server", { size: "l" }],
          ["geo", "cache", { hitRatio: 0.9 }],
          ["db", "db", { size: "xl" }],
          ["locations", "kafka", { partitions: 8 }],
          ["indexer", "consumer", { consumers: 8 }],
        ],
        wires: "client>lb, lb>api1, lb>api2, api1>geo, api2>geo, api1>db, api2>db, api1>locations, api2>locations, locations>indexer, indexer>geo",
      }),
    },
    {
      type: "quiz",
      title: "The airport",
      body: "Your geo index is sharded by cell. At 11 pm, 2,000 drivers wait at the airport and hundreds of riders land at once - one cell, one shard, red hot.",
      question: "What helps most?",
      options: [
        { text: "Make every cell bigger", why: "Bigger cells make every query in the city scan more drivers - you'd slow everything to help one place." },
        { text: "Treat hotspots specially: split hot cells to a finer resolution (or adaptively, like a quadtree) and replicate the hot shard for reads", correct: true, why: "Right. Density varies by orders of magnitude across a city. Adaptive cells keep each one's driver count bounded; read replicas spread the query load. Many airports also use a FIFO driver queue instead of nearest-driver." },
        { text: "Rate-limit riders at the airport", why: "Those riders are your busiest customers of the night." },
      ],
    },
  ],
};
