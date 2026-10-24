import { build } from "../presets";
import type { Lab } from "./types";

const ids = ["api1", "api2", "api3", "api4", "api5"];

export const whosOnline: Lab = {
  slug: "whos-online",
  module: 6,
  title: "Who's online",
  product: "Presence",
  summary: "Green dots for five million people. Detect who's really there with heartbeats, keep the state in memory, push changes only to people who care, and survive the reconnect storm.",
  difficulty: "medium",
  minutes: 25,
  tags: ["heartbeats", "pub/sub", "TTL", "WebSockets", "reconnect storms"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A team chat app shows a **green dot** next to everyone who is online, and "last seen 5 min ago" for everyone else.

- **5 million** people are connected at peak, on laptops and phones.
- A person sees on average **100 contacts** (their teams and recent chats).
- A dot should turn green or grey within **about a minute** of reality - and shouldn't flicker when a phone goes through a tunnel.
- Presence is nice to have: if it's briefly wrong, nobody loses data. Messages must keep working even if presence is down.`,
    },
    {
      type: "quiz",
      title: "Knowing someone left",
      body: "Most people never press \"log out\". Phones lose signal, laptops sleep, and TCP connections can stay half-open for minutes without either side noticing.",
      question: "How do you know someone is gone?",
      options: [
        { text: "When their WebSocket closes", why: "A phone that dies in a tunnel never sends a close. The server can hold a half-open connection for many minutes, showing a ghost green dot." },
        { text: "Heartbeats: the client pings every 30 s; presence expires if nothing arrives for ~75 s", correct: true, why: "Right. Online means \"we heard from you recently\". Each heartbeat refreshes a key with a TTL; when it expires, the user is offline. Closing the socket cleanly can mark them offline sooner." },
        { text: "Ask each client every 5 minutes whether it's still there", why: "That's a heartbeat in the wrong direction and far too slow - a dot stays green 5 minutes after someone left." },
      ],
    },
    {
      type: "quiz",
      title: "Where presence lives",
      body: "5 million users heartbeating every 30 seconds.",
      question: "Where should the online/offline state live?",
      options: [
        { text: "A presence column in Postgres, updated on every heartbeat", why: "5M ÷ 30 s ≈ 167,000 writes/s of data that is worthless a minute later - each one a WAL write, index update and replica copy." },
        { text: "An in-memory store with TTLs (e.g. Redis: SET presence:<user> EX 75), sharded by user id", correct: true, why: "Right. Presence is soft state: if a node restarts, clients re-heartbeat within 30 s and it rebuilds itself. Write \"last seen\" to the database only when someone goes offline - a tiny fraction of the traffic." },
        { text: "In each gateway's memory only", why: "Then finding someone's status means asking every gateway. Keep one shared view (sharded), fed by the gateways." },
      ],
    },
    {
      type: "quiz",
      title: "The flicker",
      body: "A commuter's phone drops off the network for 10 seconds every few minutes on the train.",
      question: "How do you stop their dot flickering grey/green for all 100 contacts?",
      options: [
        { text: "Announce every change immediately - that's what real-time means", why: "Each flicker sends two updates to 100 people. Multiply by millions of commuters and most of your presence traffic is noise." },
        { text: "Debounce: only announce \"offline\" after a grace period (say 30-60 s) without the user coming back", correct: true, why: "Right. Short drops are absorbed silently; a real departure is announced once. \"Online\" can still be announced at once, because a reconnect is real news." },
        { text: "Never show offline - show \"last seen\" only", why: "Some apps do that for privacy, but the product here wants green dots." },
      ],
    },
    {
      type: "quiz",
      title: "Who gets told?",
      body: "Status changes for 5M users, each with 100 contacts. Many contacts aren't looking at the app right now.",
      question: "Who should receive a presence change?",
      options: [
        { text: "Every contact, always", why: "Most of those messages go to apps in the background, to people who won't look until later. It's the biggest presence cost for no benefit." },
        { text: "Only contacts who are online and currently showing that person; others fetch fresh status when they open a screen", correct: true, why: "Right. When a screen opens, the app fetches a batch of statuses and subscribes to those users' channels; when it closes, it unsubscribes. Pub/sub carries changes only to gateways with interested viewers." },
        { text: "Nobody - poll for status every 10 s", why: "5M clients × 1 request / 10 s = 500,000 requests/s, mostly unchanged answers - see the next step." },
      ],
    },
    {
      type: "api",
      title: "The presence contract",
      body: "Design three endpoints: a heartbeat, a batch status lookup for a list of users, and the stream that carries presence changes.",
      baseUrl: "https://presence.example",
      expect: [
        { goal: "Send a heartbeat", methods: ["PUT", "POST"], statuses: [204, 200], why: "PUT /presence/me (or POST /heartbeats). Nothing to return - 204. In practice heartbeats usually ride the existing WebSocket as small ping frames." },
        { goal: "Look up many users' status at once", methods: ["GET", "POST"], statuses: [200], why: "GET /presence?users=a,b,c (or POST /presence/query with a list for long ones). One round trip fills a whole contact list." },
        { goal: "Open the presence change stream", methods: ["GET"], statuses: [101, 200], why: "GET /presence/stream upgrades to a WebSocket (101 Switching Protocols); the client then sends subscribe/unsubscribe messages for the users on screen." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: polling the dots",
      body: "5M clients; any one contact's status changes about once a minute from a viewer's point of view. The prototype polls every 10 s. Get changes to users within 2 s, cut API load below 50k req/s, and keep the gateways at most 80% full. A modern gateway holds about 250,000 idle WebSockets.",
      sim: "push-vs-poll",
      params: { users: 5_000_000, updateEverySec: 60, pollEverySec: 10, connsPerGateway: 250000 },
      locked: ["users", "updateEverySec", "connsPerGateway"],
      goals: [
        { metric: "requestsPerSec", op: "<=", value: 50000, label: "API requests ≤ 50k/s" },
        { metric: "avgDelaySec", op: "<=", value: 2, label: "Changes seen within 2 s on average" },
        { metric: "gatewayLoad", op: "<=", value: 0.8, label: "Gateways ≤ 80% full" },
      ],
      hints: [
        "Polling every 10 s already costs 500,000 req/s, and 83% of the answers say nothing changed.",
        "Push changes over the WebSockets the app already holds.",
        "5,000,000 ÷ (250,000 × 0.8) = 25 gateways.",
      ],
      solution: { mode: "websocket", gateways: 25 },
    },
    {
      type: "sim",
      title: "Measure it: the reconnect storm",
      body: "The presence service normally takes 4,000 heartbeats/s per shard and can handle 5,000. A network blip cuts it to 10% for 15 seconds. Clients reconnect and re-heartbeat immediately, up to 5 times. Make the shard recover within 10 s of the blip and keep peak load under 1.5× normal.",
      sim: "retry-storm",
      params: { clientRps: 4000, capacity: 5000, incidentFactor: 0.1, timeoutMs: 2000, retries: 5, backoff: "none" },
      locked: ["clientRps", "capacity", "incidentFactor", "timeoutMs"],
      goals: [
        { metric: "recovery", op: "<=", value: 10, label: "Recovers within 10 s" },
        { metric: "amplification", op: "<=", value: 1.5, label: "Peak load ≤ 1.5× normal" },
      ],
      hints: [
        "Five immediate retries per client means the load can reach 6× normal - on a service running at 10%.",
        "Backoff and jitter alone spread the retries, but the queue stays full of requests clients have already abandoned.",
        "Combine exponential backoff, jitter, a small retry budget (~20%), and a 1 s server queue that sheds stale work.",
      ],
      solution: { backoff: "exponential", jitter: true, budgetPct: 20, queueLimitSec: 1 },
    },
    {
      type: "design",
      title: "Build it on the canvas: lookups and changes",
      body: "Peak: **50,000 status lookups/s** (reads) and **3,000 status changes/s** (writes, after debouncing). Answer lookups from **Redis** (~95% hits), save \"last seen\" in the database, and publish every change to a **Kafka topic** that a **presence fan-out consumer group** reads - updating Redis and pushing to subscribed gateways. It must keep up. Budget: **$1,800/month**.",
      starter: build({
        nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "l" }], ["api2", "server", { size: "l" }], ["db", "db", { size: "m" }]],
        wires: "client>lb, lb>api1, lb>api2, api1>db, api2>db",
      }),
      test: {
        traffic: { reads: 50_000, writes: 3_000, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 80 },
          { type: "uses", kind: "cache", why: "presence lives in memory" },
          { type: "uses", kind: "kafka", why: "changes are published once" },
          { type: "consumerLag", maxGrowth: 0 },
          { type: "budget", maxUsd: 1800 },
        ],
      },
      hints: [
        "53,000 req/s on two servers is far too much. Five 8 vCPU servers run at about two thirds.",
        "Add a Redis cache with a high hit ratio and wire every server to it. The database then sees only misses and last-seen writes - give it room (8 vCPU).",
        "Add a Kafka topic (every server publishes), a consumer group reading it, and wire the group to the cache. 3,000 changes/s: 6 partitions, 6 consumers.",
      ],
      solution: build({
        nodes: [
          ["client", "client"],
          ["lb", "lb", { healthChecks: true }],
          ...ids.map((id) => [id, "server", { size: "l" }] as [string, "server", { size: string }]),
          ["presence", "cache", { hitRatio: 0.95 }],
          ["db", "db", { size: "l" }],
          ["changes", "kafka", { partitions: 6 }],
          ["fanout", "consumer", { consumers: 6 }],
        ],
        wires: ["client>lb", ...ids.map((id) => `lb>${id}, ${id}>presence, ${id}>db, ${id}>changes`), "changes>fanout, fanout>presence"].join(","),
      }),
    },
  ],
};
