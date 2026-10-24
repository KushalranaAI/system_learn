import { build } from "../presets";
import type { Lab } from "./types";

const origin = (cdnHit: number, dbSize: string, replica: boolean) =>
  build({
    nodes: [
      ["client", "client"],
      ["cdn", "cdn", { hitRatio: cdnHit }],
      ["lb", "lb", { healthChecks: true }],
      ["api1", "server", { size: "l" }],
      ["api2", "server", { size: "l" }],
      ["api3", "server", { size: "l" }],
      ["cache", "cache", { hitRatio: 0.8 }],
      ["db", "db", { size: dbSize }],
      ...(replica ? [["rep", "db", { size: dbSize, role: "replica" }] as [string, "db", object]] : []),
    ] as never,
    wires: [
      "client>cdn, cdn>lb",
      ...[1, 2, 3].map((i) => `lb>api${i}, api${i}>cache, api${i}>db${replica ? `, api${i}>rep` : ""}`),
    ].join(","),
  });

const noCdn = build({
  nodes: [
    ["client", "client"],
    ["lb", "lb", { healthChecks: true }],
    ["api1", "server", { size: "l" }],
    ["api2", "server", { size: "l" }],
    ["api3", "server", { size: "l" }],
    ["cache", "cache", { hitRatio: 0.8 }],
    ["db", "db", { size: "m" }],
  ],
  wires: "client>lb, lb>api1, lb>api2, lb>api3, api1>cache, api2>cache, api3>cache, api1>db, api2>db, api3>db",
});

export const photoFeed: Lab = {
  module: 3,
  slug: "photo-feed",
  title: "Serve a photo feed at the edge",
  product: "Photo sharing",
  summary: "150,000 requests a second of images and feed pages. Push most of it to a CDN, then survive a cold cache.",
  difficulty: "medium",
  minutes: 35,
  tags: ["CDN", "caching", "cache stampede", "replicas"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A photo-sharing app. Users scroll a feed of images; a few of them post.

- **150,000 reads/s** at peak: image files and public feed pages.
- **300 writes/s**: new posts, likes, comments.
- Images never change once uploaded, and public pages can be a few seconds old.

Your origin (load balancer, three servers, Redis, Postgres) is already built - and it can't take the peak.`,
    },
    {
      type: "quiz",
      title: "Where do image bytes belong?",
      body: "A 300 KB image is requested millions of times a day from all over the world.",
      question: "Where should repeated image requests be answered?",
      options: [
        { text: "From Redis, in front of the database", why: "Redis is in your data centre - every request still crosses the internet to you and uses your servers' bandwidth." },
        { text: "From a CDN edge server near the user", correct: true, why: "Right. Images are immutable, so edges can cache them for a long time. Users get them from a nearby city, and your origin never sees most requests." },
        { text: "From the database, with a good index", why: "Databases are the most expensive place to serve large, repeated, unchanging files." },
      ],
    },
    {
      type: "design",
      title: "Put a CDN in front",
      body: "Run the starter design at peak: everything is overloaded. Add a CDN between the client and the load balancer and tune what it caches.",
      starter: noCdn,
      test: {
        traffic: { reads: 150_000, writes: 300, bots: 0 },
        constraints: [{ type: "successRate", min: 0.99 }, { type: "p99", maxMs: 120 }, { type: "budget", maxUsd: 900 }, { type: "uses", kind: "cdn" }],
      },
      hints: [
        "Add a CDN and wire Client → CDN → Load balancer (delete the old client wire first).",
        "The CDN only helps with what it can cache. Images and logged-out pages are cacheable - raise its hit ratio to 80% or more.",
        "Adding servers instead would blow the budget: the cheapest request is the one that never reaches you.",
      ],
      solution: origin(0.85, "m", false),
    },
    {
      type: "design",
      title: "Survive a cold cache",
      body: "At t=10s Redis restarts empty. Every lookup misses and hits Postgres at once - a stampede. Even the worst second must stay at 99% success.",
      test: {
        traffic: { reads: 150_000, writes: 300, bots: 0 },
        incident: { type: "cacheFlush" },
        constraints: [{ type: "successRate", min: 0.99 }, { type: "budget", maxUsd: 1300 }],
      },
      hints: [
        "Run the timeline and watch the database card when the cache empties.",
        "The cache refills only as fast as the database can answer misses. An overloaded database refills it slowly - and retries make it worse.",
        "Give the database headroom for misses: a bigger primary, or a read replica wired to every server.",
      ],
      solution: origin(0.85, "m", true),
    },
    {
      type: "quiz",
      title: "Where did my post go?",
      body: "A user posts a photo and refreshes their profile. Reads come from a replica that's ~25 ms behind the primary.",
      question: "Sometimes the new post is missing on refresh. What's the usual fix?",
      options: [
        { text: "Make replication synchronous for every write", why: "That works but makes every write wait for every replica - slower writes and an outage when a replica is slow." },
        { text: "Read your own recent writes from the primary", correct: true, why: "Right. For a few seconds after a user writes, send *their* reads to the primary (read-your-writes). Everyone else can still use replicas." },
        { text: "Add more replicas", why: "More replicas add read capacity, not freshness - each one is still behind." },
      ],
    },
  ],
};
