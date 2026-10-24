import { build } from "../presets";
import type { Lab } from "./types";

const site = (limit: number | null) =>
  build({
    nodes: [
      ["client", "client"],
      ...(limit !== null ? [["rl", "limiter", { limitPerIp: limit }] as [string, "limiter", object]] : []),
      ["lb", "lb", { healthChecks: true }],
      ["api1", "server", { size: "l" }],
      ["api2", "server", { size: "l" }],
      ["api3", "server", { size: "l" }],
      ["cache", "cache", { hitRatio: 0.85 }],
      ["db", "db", { size: "m" }],
    ] as never,
    wires: [limit !== null ? "client>rl, rl>lb" : "client>lb", ...[1, 2, 3].map((i) => `lb>api${i}, api${i}>cache, api${i}>db`)].join(","),
  });

export const stopAScraper: Lab = {
  slug: "stop-a-scraper",
  module: 8,
  title: "Stop a scraper",
  product: "Product listings API",
  summary: "A scraper sends 50,000 requests a second for random pages. Pick the right key, the right limit and the right place to block it.",
  difficulty: "easy",
  minutes: 20,
  tags: ["rate limiting", "per-IP limits", "NAT", "edge"],
  steps: [
    {
      type: "intro",
      title: "The attack",
      body: `Your product API serves **10,000 real requests/s** with an 85% cache hit ratio.

A scraper starts fetching **random product pages at 50,000 req/s** from about 4 IP addresses. Random pages never hit the
cache - every one reaches Postgres.

Real users: most send ~2 req/s. About 3% sit behind shared IPs (offices, mobile carriers) at ~40 req/s per IP.`,
    },
    {
      type: "quiz",
      title: "What do you count by?",
      body: "You'll put a rate limiter in front. First, choose its key.",
      question: "Which key catches the scraper without hurting real users?",
      options: [
        { text: "Per product page (URL path)", why: "The scraper requests a different page every time, so no single path ever crosses the limit - only your most popular products get throttled." },
        { text: "Per IP address", correct: true, why: "Right. The scraper's traffic is concentrated on a few IPs (~12,500 req/s each), while real users send a few requests per second. Keep the limit generous for shared IPs." },
        { text: "Global: 15,000 req/s total", why: "A global limit can't tell the scraper from your users - once it's hit, real people get 429s too." },
      ],
    },
    {
      type: "design",
      title: "Block the scraper",
      body: "Run the starter design: the servers and database drown. Put a rate limiter at the edge and set its per-IP limit.",
      starter: site(null),
      test: {
        traffic: { reads: 10_000, writes: 100, bots: 50_000 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "botsBlocked", minShare: 0.97 },
          { type: "p99", maxMs: 100 },
          { type: "uses", kind: "limiter" },
        ],
      },
      hints: [
        "Add a Rate limiter and wire Client → Rate limiter → Load balancer (delete the client's old wire first).",
        "Select the limiter and set a per-IP limit. 0 means off.",
        "Too low (under ~40 req/s) and offices sharing an IP get blocked. Something like 100 req/s per IP works.",
      ],
      solution: site(100),
    },
    {
      type: "quiz",
      title: "The limiter's store goes down",
      body: "Your limiter keeps counters in Redis. Redis is unreachable for two minutes.",
      question: "For this public product API, what should the limiter do?",
      options: [
        { text: "Fail closed: reject everything until Redis is back", why: "Then your rate limiter causes a full outage for every real user." },
        { text: "Fail open, with a local per-server fallback limit", correct: true, why: "Right. Keep serving, enforce an approximate limit in each server's memory, and alert. Reserve fail-closed for the most sensitive endpoints like login." },
        { text: "Disable rate limiting permanently", why: "The scraper would be back the moment Redis blinked." },
      ],
    },
  ],
};
