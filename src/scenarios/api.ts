import { build, type Preset } from "../presets";

/** The systems behind well-known APIs, scaled down to the simulator. Each one starts with a problem to find. */
export const API_SCENARIOS: Preset[] = [
  {
    id: "api-public-gateway",
    title: "A public API with no limits",
    source: "API design",
    blurb: "A partner API behind a gateway and load balancer. One partner's runaway sync job sends 20,000 requests a second.",
    lesson: "22.5",
    story: `Public APIs are shared by everyone who calls them. Without limits, one buggy integration can take the API down for every other customer.

**What a gateway does at the edge:** authenticate the caller (API key or OAuth token), enforce **quotas** (per day or month, often per pricing tier) and **rate limits** (per second), and answer **429 Too Many Requests** with a \`Retry-After\` header so well-behaved clients slow down.

**On the canvas:** reads and writes are partner traffic (8,000 and 400 req/s). The "bots" are one partner's sync job stuck in a loop, from a few IPs. The rate limiter is the gateway's limit, currently **off** (0).`,
    tryThis: [
      "Run it: which tier fails first?",
      "Set the limiter's per-IP limit to 100 req/s. Who gets blocked, and who doesn't?",
      "Lower it to 20 req/s. Why do partners behind one shared IP start failing?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["gateway", "limiter", { limitPerIp: 0 }],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "m" }],
        ["api2", "server", { size: "m" }],
        ["cache", "cache", { hitRatio: 0.7 }],
        ["db", "db", { size: "m" }],
      ],
      wires: "client>gateway, gateway>lb, lb>api1, lb>api2, api1>cache, api2>cache, api1>db, api2>db",
    }),
    traffic: { reads: 8_000, writes: 400, bots: 20_000 },
  },
  {
    id: "api-search",
    title: "Search API on campaign day",
    source: "API design",
    blurb: "Search and suggestions over a sharded index. A marketing campaign triples traffic, mostly for the same few queries.",
    lesson: "25.2",
    story: `A search API has two endpoints with very different budgets: **suggestions** (every few keystrokes, under ~100 ms) and **full search** (ranked results, filters, facets, a few hundred ms).

**Why caching works:** search traffic is very skewed. A few hundred queries ("iphone", "sofa") make up a large share of all searches, so caching their results for 30-60 seconds removes most of the load from the index. Clients help too, by debouncing keystrokes.

**On the canvas:** reads are searches (25,000/s). The database is the search index (2 shards). The cache holds results for popular queries; its hit ratio stands for how skewed the traffic is. The preselected incident is a 3x campaign spike.`,
    tryThis: [
      "Run the 3x spike. Is the index or the servers the bottleneck?",
      "Raise the cache hit ratio from 0.5 to 0.8. How much index capacity does that save?",
      "Add a shard to the index instead. Which fix is cheaper?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["api3", "server", { size: "l" }],
        ["cache", "cache", { hitRatio: 0.5 }],
        ["index", "db", { size: "l", shards: 2 }],
      ],
      wires: "client>lb, lb>api1, lb>api2, lb>api3, api1>cache, api2>cache, api3>cache, api1>index, api2>index, api3>index",
    }),
    traffic: { reads: 25_000, writes: 200, bots: 0 },
    incident: { type: "spike", factor: 3 },
  },
  {
    id: "api-file-uploads",
    title: "File uploads with background processing",
    source: "API design",
    blurb: "Uploads complete through the API, then a queue feeds virus-scan and thumbnail workers. The workers can't keep up.",
    lesson: "25.3",
    story: `A file API does as little as possible inside the request:

1. \`POST /uploads\` creates an upload session and returns a **presigned URL**; the bytes go straight to object storage, in resumable chunks.
2. When the upload completes, the API records it and enqueues a job, answering **202 Accepted**.
3. Workers scan, extract metadata and make thumbnails or previews, then mark the file ready. The client polls \`GET /files/:id\` or gets a webhook.

**On the canvas:** reads are downloads and metadata reads (3,000/s), writes are completed uploads (1,200/s). Each write becomes a job. Three workers handle 1,200 jobs/s with no headroom.`,
    tryThis: [
      "Watch the backlog. How many workers keep it at zero with headroom?",
      "Delete the queue and wire the servers straight to the database. What happens to latency?",
      "Kill a worker. Does the API notice?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "m" }],
        ["api2", "server", { size: "m" }],
        ["cache", "cache", { hitRatio: 0.6 }],
        ["db", "db", { size: "m" }],
        ["jobs", "queue"],
        ["workers", "worker", { workers: 3 }],
      ],
      wires: "client>lb, lb>api1, lb>api2, api1>cache, api2>cache, api1>db, api2>db, api1>jobs, api2>jobs, jobs>workers, workers>db",
    }),
    traffic: { reads: 3_000, writes: 1_200, bots: 0 },
  },
  {
    id: "api-webhooks",
    title: "Webhook delivery at scale",
    source: "API design",
    blurb: "Every event becomes a delivery job to a customer's URL. Slow receivers and retries pile up in the queue.",
    lesson: "22.6",
    story: `Webhooks turn your events into HTTP POSTs to your customers' servers. At scale that's a job system:

- Each event is written once, then **fanned out** into one delivery job per subscribed endpoint.
- Workers POST the payload with an **HMAC signature** and a timestamp, and wait (briefly) for a 2xx.
- Failures are retried with **exponential backoff** for hours or days; endpoints that keep failing are disabled and the owner is emailed.
- Customers dedupe by **event id**, because retries mean duplicates.

**On the canvas:** writes are deliveries (2,500/s); reads are customers checking event logs. Four delivery workers handle 1,600 deliveries/s.`,
    tryThis: [
      "How fast is the backlog growing? How many workers do you need?",
      "Run the 3x spike: a big customer re-sends a month of events. Does the queue absorb it?",
      "Why is a queue better here than calling customers' URLs from the API servers?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["api1", "server", { size: "m" }],
        ["db", "db", { size: "m" }],
        ["deliveries", "queue"],
        ["senders", "worker", { workers: 4 }],
      ],
      wires: "client>api1, api1>db, api1>deliveries, deliveries>senders, senders>db",
    }),
    traffic: { reads: 1_000, writes: 2_500, bots: 0 },
    incident: { type: "spike", factor: 3 },
  },
  {
    id: "api-payments",
    title: "Payments API: a payment as a state machine",
    source: "API design",
    blurb: "Confirming a payment reserves stock, charges the card and records the order. Without safeguards, timeouts leave orders half done.",
    lesson: "25.11",
    story: `Payment APIs like Stripe's model a payment as a resource with states (requires_payment_method → requires_confirmation → requires_action → processing → succeeded / canceled) instead of one "charge" call.

**What keeps money correct:**
- **Idempotency keys** on every POST, saved with the result, so merchant retries never double-charge.
- **Webhooks** (\`payment_intent.succeeded\`) for outcomes that arrive later from the card network.
- On the platform side, each payment touches several systems (fraud checks, the card network, the ledger), coordinated as a **saga** with compensations and an **outbox** for events.

**On the canvas:** writes are payment confirmations (900/s). The saga runs 3 steps per payment with no safeguards yet; the Kafka topic carries payment events to the ledger.`,
    tryThis: [
      "Select the saga: how many payments end inconsistent per second?",
      "Turn on idempotency keys and compensation. Which safeguard removes double charges?",
      "Turn on all five safeguards. What does each one protect against?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "m" }],
        ["api2", "server", { size: "m" }],
        ["saga", "saga", { sagaSteps: 3 }],
        ["db", "db", { size: "l" }],
        ["events", "kafka", { partitions: 4 }],
        ["ledger", "consumer", { consumers: 4 }],
      ],
      wires: "client>lb, lb>api1, lb>api2, api1>saga, api2>saga, api1>db, api2>db, saga>db, saga>events, events>ledger, ledger>db",
    }),
    traffic: { reads: 3_000, writes: 900, bots: 0 },
  },
  {
    id: "api-messenger",
    title: "Messenger API: send, fan out, sync",
    source: "API design",
    blurb: "Messages are accepted over the API, published to Kafka and fanned out to recipients. One huge group chat makes a hot partition.",
    lesson: "25.7",
    story: `A messaging API splits into a **write path** and a **delivery path**:

- \`POST /conversations/:id/messages\` with a client-generated message id (so retries don't duplicate), answered as soon as the message is durably stored.
- The message is published to a log partitioned by conversation id, which keeps each conversation in order.
- Delivery services push it to recipients' open WebSocket connections; offline devices catch up with \`GET /sync?since=<sequence>\`.

**On the canvas:** writes are messages (40,000/s), reads are sync and history calls. The Kafka topic is partitioned by conversation; a very large group chat sends 25% of all messages to one partition.`,
    tryThis: [
      "Look at the consumer group: which partition lags?",
      "Lower the hot key share to 0 (spread the big group over sub-partitions). Does lag clear?",
      "Add partitions and consumers. Why doesn't that alone fix a hot key?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["api3", "server", { size: "l" }],
        ["cache", "cache", { hitRatio: 0.8 }],
        ["db", "db", { size: "l", shards: 4 }],
        ["log", "kafka", { partitions: 8, hotKeyPct: 25 }],
        ["delivery", "consumer", { consumers: 8 }],
      ],
      wires: "client>lb, lb>api1, lb>api2, lb>api3, api1>cache, api2>cache, api3>cache, api1>db, api2>db, api3>db, api1>log, api2>log, api3>log, log>delivery, delivery>cache",
    }),
    traffic: { reads: 20_000, writes: 40_000, bots: 0 },
  },
  {
    id: "api-maps-tiles",
    title: "Maps API: tiles from the edge",
    source: "API design",
    blurb: "Map tiles are addressed by zoom/x/y and cached at the edge. A new tile style ships and the CDN starts cold.",
    lesson: "25.8",
    story: `A maps platform is several APIs with very different shapes:

- **Tiles** (\`GET /tiles/{z}/{x}/{y}\`): immutable for a given style and version, so they cache extremely well at CDNs and in apps. This is by far the most traffic.
- **Geocoding** and **places** search: text in, coordinates out; cache popular queries.
- **Directions** and **ETAs**: computed per request on a routing graph with live traffic, the expensive part.

Google Maps Platform bills per call (per SKU), with a free monthly allowance per SKU since March 2025, which is why clients cache tiles and debounce place searches.

**On the canvas:** reads are tile requests (300,000/s); the CDN answers 97%. Behind it, the API servers render or fetch missing tiles.`,
    tryThis: [
      "Drop the CDN hit ratio to 0.8 (a new map style, cold caches). What breaks?",
      "How many servers would you need with no CDN at all?",
      "Why do tile URLs include a version, like /v42/tiles/12/2154/1428?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["edge", "cdn", { hitRatio: 0.97 }],
        ["lb", "lb", { healthChecks: true }],
        ["tiles1", "server", { size: "l" }],
        ["tiles2", "server", { size: "l" }],
        ["cache", "cache", { hitRatio: 0.7 }],
        ["db", "db", { size: "m" }],
      ],
      wires: "client>edge, edge>lb, lb>tiles1, lb>tiles2, tiles1>cache, tiles2>cache, tiles1>db, tiles2>db",
    }),
    traffic: { reads: 300_000, writes: 100, bots: 0 },
  },
  {
    id: "api-code-judge",
    title: "Code judge API during a contest",
    source: "API design",
    blurb: "Submissions return 202 and run in sandboxed judge workers. When a weekly contest starts, submissions jump 4x.",
    lesson: "25.10",
    story: `A coding-practice site (think LeetCode) can't run untrusted code inside its API servers:

1. \`POST /submissions\` validates the code and language, stores it and answers **202 Accepted** with a submission id.
2. The submission is queued; **judge workers** run it in a sandbox (containers or microVMs with CPU, memory and time limits) against the test cases.
3. The client polls \`GET /submissions/:id\` or listens on a WebSocket/SSE channel for the verdict.

Contests are the stress test: everyone submits in the same few minutes, and per-user rate limits stop one person from flooding the judges.

**On the canvas:** writes are submissions (500/s), reads are problem pages and verdict polls. Six judge workers stand for the sandbox fleet. The preselected incident is the contest's 4x surge.`,
    tryThis: [
      "Run the surge. How long would the slowest verdict wait in the backlog?",
      "Add workers until the backlog clears. What would you autoscale on?",
      "Why poll GET /submissions/:id instead of keeping the POST open until the verdict?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "m" }],
        ["api2", "server", { size: "m" }],
        ["cache", "cache", { hitRatio: 0.85 }],
        ["db", "db", { size: "m" }],
        ["submissions", "queue"],
        ["judges", "worker", { workers: 6 }],
      ],
      wires: "client>lb, lb>api1, lb>api2, api1>cache, api2>cache, api1>db, api2>db, api1>submissions, api2>submissions, submissions>judges, judges>db",
    }),
    traffic: { reads: 6_000, writes: 500, bots: 0 },
    incident: { type: "spike", factor: 4 },
  },
  {
    id: "api-price-tracker",
    title: "Price tracker on someone else's API",
    source: "API design",
    blurb: "A price-history site checks millions of products against a retailer's API and alerts users on drops. The checking workers fall behind.",
    lesson: "25.14",
    story: `Price trackers like CamelCamelCamel and Keepa are mostly **API consumers**:

- A scheduler decides how often each product is checked: popular or volatile products every few minutes, the long tail once a day. The upstream API's **quota** sets the total budget.
- Workers call the retailer's API (for Amazon, the Product Advertising API, which Amazon has been replacing with its Creators API in 2026), store each price point, and compare it with users' alert thresholds.
- Alerts go out through a separate notification queue.

When you build on someone else's API, their quotas, outages and migrations become your problem: cache aggressively, back off on 429s, and isolate the integration so you can switch versions.

**On the canvas:** writes are price checks (2,000/s) that become jobs for five workers; reads are users browsing price charts.`,
    tryThis: [
      "Is the backlog growing? How many workers do the checks need?",
      "If the upstream quota only allowed 1,500 checks/s, what would you change instead of adding workers?",
      "Kill the database: which part of the product still works?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["api1", "server", { size: "m" }],
        ["cache", "cache", { hitRatio: 0.9 }],
        ["db", "db", { size: "m" }],
        ["checks", "queue"],
        ["fetchers", "worker", { workers: 4 }],
      ],
      wires: "client>api1, api1>cache, api1>db, api1>checks, checks>fetchers, fetchers>db",
    }),
    traffic: { reads: 4_000, writes: 2_000, bots: 0 },
  },
  {
    id: "api-game-backend",
    title: "Game backend: matchmaking and leaderboards",
    source: "API design",
    blurb: "The REST side of an online game: sign-in, matchmaking tickets, profiles and a global leaderboard. A season launch brings a 3x login spike.",
    lesson: "25.15",
    story: `Online games split their APIs by latency:

- **Real-time gameplay** runs on dedicated game servers over UDP at a fixed tick rate (often 20-60 updates a second), with the server as the authority so clients can't cheat.
- **Everything else** is ordinary request/response APIs: sign-in, inventories, store purchases (idempotent!), **matchmaking tickets** (\`POST /matchmaking/tickets\`, then wait for a match notification) and **leaderboards**, usually sorted sets in Redis.

Season launches and new content cause login storms: everyone opens the game at the same hour.

**On the canvas:** reads are profile, store and leaderboard calls (30,000/s); writes are match results and purchases. The cache stands for Redis leaderboards. The preselected incident is the season-launch spike.`,
    tryThis: [
      "Run the 3x spike. What fails first?",
      "Flush the cache (Redis restarts). How long until leaderboards recover?",
      "How would you queue logins (\"you're in line: 2 minutes\") instead of failing them?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["api3", "server", { size: "l" }],
        ["redis", "cache", { hitRatio: 0.85 }],
        ["db", "db", { size: "l" }],
      ],
      wires: "client>lb, lb>api1, lb>api2, lb>api3, api1>redis, api2>redis, api3>redis, api1>db, api2>db, api3>db",
    }),
    traffic: { reads: 30_000, writes: 1_500, bots: 0 },
    incident: { type: "spike", factor: 3 },
  },
];
