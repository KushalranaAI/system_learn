import { build } from "../presets";
import type { Lab } from "./types";

const ok = { type: "successRate", min: 0.99 } as const;

const scaled = (servers: number, size: string, extra = "", wiresExtra = "", healthChecks = false) =>
  build({
    nodes: [
      ["client", "client"],
      ...(extra.includes("limiter") ? ([["rl", "limiter", { limitPerIp: 100 }]] as const) : []),
      ["lb", "lb", { healthChecks }],
      ...Array.from({ length: servers }, (_, i) => [`api${i + 1}`, "server", { size }] as [string, "server", { size: string }]),
      ["cache", "cache", { hitRatio: 0.8 }],
      ["db", "db", { size: "l" }],
      ...(extra.includes("replica") ? ([["rep", "db", { size: "l", role: "replica" }]] as const) : []),
    ] as never,
    wires: [
      extra.includes("limiter") ? "client>rl, rl>lb" : "client>lb",
      ...Array.from({ length: servers }, (_, i) => `lb>api${i + 1}, api${i + 1}>cache, api${i + 1}>db${extra.includes("replica") ? `, api${i + 1}>rep` : ""}`),
      wiresExtra,
    ].join(","),
  });

export const linkShortener: Lab = {
  module: 10,
  slug: "link-shortener",
  title: "Build a link shortener",
  product: "URL shortener",
  summary: "Short links that redirect in milliseconds - from 300 to 60,000 requests a second, through a scraper attack and two crashes.",
  difficulty: "easy",
  minutes: 50,
  tags: ["API design", "scaling", "caching", "rate limiting", "failover"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A marketing team wants **short links** for campaigns: paste a long URL, get \`https://sho.rt/Ab3xYz\`, share it everywhere.

**Functional requirements**
- Create a short link from a long URL.
- Open a short link and get redirected to the long URL.

**Non-functional requirements**
- Redirects are **fast** (p99 under 100 ms) and **always work**.
- Traffic is **read-heavy**: every link is created once and clicked many times - about **100 redirects per create**.
- Costs stay reasonable as traffic grows.

You'll design the API first, then build the system step by step as traffic grows 200x.`,
    },
    {
      type: "api",
      title: "Design the API",
      body: "Add one endpoint per requirement. Pick the HTTP method, a path, and the status code a success returns.",
      baseUrl: "https://sho.rt",
      expect: [
        { goal: "Create a short link", methods: ["POST"], statuses: [201, 200], why: "Creating something new is a POST, answered with 201 Created (200 is acceptable)." },
        {
          goal: "Redirect a short link",
          methods: ["GET"],
          statuses: [301, 302, 307, 308],
          needsParam: true,
          why: "Following a link is a GET on a path that contains the short code (like /:code), answered with a redirect status (301/302/307/308).",
        },
      ],
    },
    {
      type: "quiz",
      title: "Permanent or temporary redirect?",
      body: "Both 301 and 302 send the browser to the long URL. The difference matters for what you can do later.",
      question: "The team wants a click counter per link. Which redirect status should the GET return?",
      options: [
        { text: "301 Moved Permanently", why: "Browsers cache a 301 and stop asking you - repeat clicks never reach your servers, so you can't count them (or ever change the target)." },
        { text: "302 Found", correct: true, why: "Right. A 302 isn't cached by default, so every click reaches you and can be counted. You pay for it with more traffic - which the next steps are about." },
        { text: "200 OK with the long URL in the body", why: "Browsers won't follow it automatically - users would see a page instead of being redirected." },
      ],
    },
    {
      type: "design",
      title: "Handle 300 requests a second",
      body: "Launch day. Build the smallest system that works: the client calls code that looks up the short code and returns the long URL.",
      starter: build({ nodes: [["client", "client"]], wires: "" }),
      test: { traffic: { reads: 300, writes: 3, bots: 0 }, constraints: [ok, { type: "p99", maxMs: 100 }, { type: "uses", kind: "server" }, { type: "uses", kind: "db" }] },
      hints: [
        "Something has to run your code for each request - that's an API server.",
        "The short-code → long-URL mapping must survive restarts, so it lives in a database.",
        "Wire Client → API server → Database.",
      ],
      solution: build({ nodes: [["client", "client"], ["api", "server"], ["db", "db"]], wires: "client>api, api>db" }),
    },
    {
      type: "design",
      title: "8,000 req/s on a $400 budget",
      body: "A campaign goes viral. Traffic is now 8,000 redirects a second. The cheapest fix doesn't add any boxes.",
      test: {
        traffic: { reads: 8000, writes: 80, bots: 0 },
        constraints: [ok, { type: "p99", maxMs: 80 }, { type: "budget", maxUsd: 400, why: "a bigger machine is cheaper than more machines at this size" }],
      },
      hints: [
        "Run it at 8,000 and look at which card turns red.",
        "Select the API server and the database - each has a machine size.",
        "A server at 90% passes traffic but is slow: past ~85%, queues build. Pick a size that leaves headroom (8 vCPU), and give the database 4 vCPU.",
      ],
      solution: build({ nodes: [["client", "client"], ["api", "server", { size: "l" }], ["db", "db", { size: "m" }]], wires: "client>api, api>db" }),
    },
    {
      type: "design",
      title: "25,000 req/s - beyond one box",
      body: "One huge server could just about take this, but it's expensive and it's a single point of failure. Scale **out** instead.",
      test: {
        traffic: { reads: 25_000, writes: 250, bots: 0 },
        constraints: [ok, { type: "p99", maxMs: 100 }, { type: "budget", maxUsd: 1100 }, { type: "uses", kind: "lb", why: "spread traffic over several servers" }],
      },
      hints: [
        "Add a load balancer between the client and the servers. The client sends to one place - delete the old wire first.",
        "Two 8 vCPU servers cost less than one 32 vCPU server and survive losing one.",
        "Every server needs its own wire to the database. The database needs more read capacity too.",
      ],
      solution: build({
        nodes: [["client", "client"], ["lb", "lb"], ["api1", "server", { size: "l" }], ["api2", "server", { size: "l" }], ["db", "db", { size: "xl" }]],
        wires: "client>lb, lb>api1, lb>api2, api1>db, api2>db",
      }),
    },
    {
      type: "design",
      title: "60,000 reads/s - add a cache",
      body: "Even the biggest database tops out at 45,000 reads a second. But most clicks go to a few hot links - keep those in memory.",
      test: {
        traffic: { reads: 60_000, writes: 600, bots: 0 },
        constraints: [ok, { type: "p99", maxMs: 100 }, { type: "budget", maxUsd: 1500 }, { type: "uses", kind: "cache" }],
      },
      hints: [
        "Add a cache (Redis) and wire every API server to it. Reads check the cache first; misses go to the database.",
        "With an 80% hit ratio the database only sees 1 in 5 reads - so it can shrink, which pays for the cache.",
        "You'll need about 60,000 req/s of server capacity with headroom: e.g. five 8 vCPU servers.",
      ],
      solution: scaled(5, "l"),
    },
    {
      type: "design",
      title: "Stop the scraper",
      body: "Someone is scraping every possible short code - 30,000 requests a second for random codes from a handful of IPs. Random codes miss the cache and hammer the database.",
      test: {
        traffic: { reads: 20_000, writes: 200, bots: 30_000 },
        constraints: [ok, { type: "botsBlocked", minShare: 0.95 }, { type: "p99", maxMs: 100 }],
      },
      hints: [
        "Add a rate limiter at the edge: Client → Rate limiter → Load balancer.",
        "Set a per-IP limit in the inspector. The scraper sends thousands per IP; a normal user sends ~2.",
        "Too strict and you'll block offices and mobile carriers that share one IP (~40 req/s). Something like 100 req/s per IP works.",
      ],
      solution: scaled(5, "l", "limiter"),
    },
    {
      type: "design",
      title: "Survive a server crash",
      body: "At t=10s one API server dies. Real users shouldn't notice. Run the test - it plays the 60-second incident.",
      test: {
        traffic: { reads: 30_000, writes: 300, bots: 0 },
        incident: { type: "killKind", kind: "server" },
        constraints: [ok, { type: "uses", kind: "server", min: 3 }],
      },
      hints: [
        "Run the timeline. A load balancer without health checks keeps sending a share of traffic to the dead server.",
        "Select the load balancer and turn on health checks.",
        "After one server dies, the rest must carry everything - keep enough spare capacity (N+1).",
      ],
      solution: scaled(5, "l", "", "", true),
    },
    {
      type: "design",
      title: "Survive a database crash",
      body: "At t=10s the primary database dies. Writes can't be avoided failing for a moment, but the system must recover on its own - within 20 seconds.",
      test: {
        traffic: { reads: 30_000, writes: 300, bots: 0 },
        incident: { type: "killKind", kind: "db", role: "primary" },
        constraints: [{ type: "recovery", maxSeconds: 20 }, { type: "uses", kind: "db", min: 2, why: "something has to take over" }],
      },
      hints: [
        "Add a second database and set its role to Read replica. Wire every API server to it.",
        "Turn on 'Automatic DB failover' in the timeline bar - it promotes the replica after the primary dies.",
        "Failover takes 15 s to detect and promote. Until then writes fail; reads keep working from the replica.",
      ],
      solution: scaled(5, "l", "replica", "", true),
      solutionResilience: { dbFailover: true },
    },
  ],
};
