import { build } from "../presets";
import type { Lab } from "./types";

const onSale = (replica: boolean) =>
  build({
    nodes: [
      ["client", "client"],
      ["cdn", "cdn", { hitRatio: 0.6 }],
      ["lb", "lb", { healthChecks: true }],
      ["api1", "server", { size: "l" }],
      ["api2", "server", { size: "l" }],
      ["api3", "server", { size: "l" }],
      ["seats", "cache", { hitRatio: 0.9 }],
      ["db", "db", { size: "l" }],
      ...(replica ? [["rep", "db", { size: "l", role: "replica" }] as [string, "db", { size: string; role: "replica" }]] : []),
    ],
    wires: [
      "client>cdn, cdn>lb, lb>api1, lb>api2, lb>api3",
      "api1>seats, api2>seats, api3>seats, api1>db, api2>db, api3>db",
      replica ? "api1>rep, api2>rep, api3>rep" : "",
    ].join(","),
  });

export const ticketBooking: Lab = {
  slug: "ticket-booking",
  module: 12,
  title: "A ticket booking system",
  product: "Event tickets",
  summary: "60,000 seats, two million fans, one on-sale moment. Never sell a seat twice, hold seats while people pay, and stay up when everyone hits refresh.",
  difficulty: "hard",
  minutes: 30,
  tags: ["locking", "holds", "payments", "idempotency", "retry storms"],
  steps: [
    {
      type: "intro",
      title: "The on-sale",
      body: `A stadium tour goes on sale at **10:00 sharp**: **60,000 seats** per show, about **2 million fans** waiting.

- Fans pick specific seats on a map, or ask for "2 best available".
- A chosen seat is **held for 10 minutes** while the fan pays; unpaid holds go back on sale.
- Payment goes through an external card provider that is sometimes slow.
- A seat sold twice is the worst possible outcome: two people, one seat, one very public apology.`,
    },
    {
      type: "quiz",
      title: "Two clicks, one seat",
      body: "Two fans click seat B-14 within the same millisecond. Each request runs on a different API server.",
      question: "How do you make sure only one of them gets it?",
      options: [
        { text: "SELECT the seat; if it's available, UPDATE it to held", why: "Both requests read \"available\" before either writes. Classic check-then-act race: both think they won." },
        { text: "One conditional write: UPDATE seats SET status='held', hold_id=… WHERE id='B-14' AND status='available'", correct: true, why: "Right. The database applies the check and the write atomically. One request updates 1 row and wins; the other updates 0 rows and gets 409 Conflict. No separate lock service needed." },
        { text: "Take a Redis lock on the seat, then write to the database", why: "It can work, but it adds a second system that can disagree with the database (an expired lock, a paused process). The database row is already the source of truth - let it decide." },
      ],
    },
    {
      type: "quiz",
      title: "Holding a seat",
      body: "After winning B-14, the fan has 10 minutes to pay.",
      question: "How should the hold work?",
      options: [
        { text: "Keep a database transaction open with the row locked until payment finishes", why: "Thousands of transactions open for minutes: locks pile up, connections run out, and a fan closing the tab leaves a lock until the timeout." },
        { text: "Store the hold with an expiry (hold_until); treat expired holds as available, and sweep them in the background", correct: true, why: "Right. The hold is just data: the conditional write also accepts \"status='held' AND hold_until < now()\". A sweeper tidies up and updates the seat map, but correctness doesn't depend on it running on time." },
        { text: "Don't hold anything - the first to pay gets the seat", why: "Then many fans pay for the same seat and most need refunds. Holds exist so the payment step can't conflict." },
      ],
    },
    {
      type: "quiz",
      title: "Standing tickets",
      body: "The floor is 5,000 general-admission tickets. At 10:00, 4,000 requests/s try to buy them. Today it's one row: `ga_remaining = 5000`.",
      question: "What's the problem, and the fix?",
      options: [
        { text: "No problem - one UPDATE … SET ga_remaining = ga_remaining - 2 WHERE ga_remaining >= 2 is atomic", why: "It's correct, but every request queues for the same row lock. At a few milliseconds per update the row serves a few hundred buyers a second while 4,000 wait and time out." },
        { text: "Split the stock into buckets (say 50 rows of 100) and decrement a random bucket conditionally", correct: true, why: "Right. 50 rows means 50 updates can run in parallel; a request that finds its bucket empty tries another. The total is never oversold because each bucket's update is still conditional." },
        { text: "Keep the counter in the app server's memory", why: "With several servers, each has its own counter - you'd sell 5,000 per server." },
      ],
    },
    {
      type: "api",
      title: "Holds and purchases",
      body: "Design the booking endpoints: hold seats for an event, tell a fan the seat is gone, buy what you hold (safe to retry), and let go of a hold.",
      baseUrl: "https://tickets.example",
      expect: [
        { goal: "Hold seats for an event", methods: ["POST"], statuses: [201], needsParam: true, why: "POST /events/:id/holds with the seat ids. 201 Created returns a hold id and its expiry, so the app can show a countdown." },
        { goal: "Tell the fan a seat was already taken", methods: ["POST"], statuses: [409], needsParam: true, why: "The same POST answers 409 Conflict when the conditional write updated 0 rows. The app refreshes the seat map and suggests the next best seats." },
        { goal: "Buy the held seats", methods: ["POST"], statuses: [200, 201], needsParam: true, why: "POST /holds/:id/purchase with an Idempotency-Key header. A retry after a timeout returns the same order instead of charging twice." },
        { goal: "Release a hold", methods: ["DELETE"], statuses: [204, 200], needsParam: true, why: "DELETE /holds/:id puts the seats back on sale at once instead of waiting for the expiry." },
      ],
    },
    {
      type: "quiz",
      title: "Paying at minute nine",
      body: "A fan starts paying 9 minutes into a 10-minute hold. The card provider takes 90 seconds to answer. Meanwhile the sweeper runs.",
      question: "What should happen?",
      options: [
        { text: "The sweeper releases the seat at minute 10; if payment succeeds, refund it", why: "The fan did everything right and loses the seat. Refunds are slow and this happens to thousands of people at every on-sale." },
        { text: "Move the hold to a 'paying' state the sweeper skips, with its own hard limit; settle the outcome by idempotency key", correct: true, why: "Right. Starting payment extends the hold for as long as payment may take (say 5 minutes more). If the provider never answers, you query it by the idempotency key before releasing the seat." },
        { text: "Make holds 30 minutes long", why: "Fans who walk away lock seats for half an hour; during an on-sale that feels like a sell-out that isn't." },
      ],
    },
    {
      type: "design",
      title: "Build it on the canvas: 10:00:00",
      body: "At the on-sale: **60,000 reads/s** (event pages, seat maps, \"is it still free?\") and **3,000 writes/s** (holds and purchases). Event pages are cacheable at the edge; the seat map changes every second, so cache it briefly in Redis. Writes must reach the database. Budget: **$1,200/month**.",
      starter: build({
        nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "m" }], ["api2", "server", { size: "m" }], ["db", "db", { size: "l" }]],
        wires: "client>lb, lb>api1, lb>api2, api1>db, api2>db",
      }),
      test: {
        traffic: { reads: 60_000, writes: 3_000, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 120 },
          { type: "uses", kind: "cdn", why: "event pages and static seat-map data" },
          { type: "budget", maxUsd: 1200 },
        ],
      },
      hints: [
        "Put a CDN in front of the load balancer: about 60% of reads are cacheable pages that never need your servers.",
        "What's left still needs more than two 4 vCPU servers. Three 8 vCPU servers leave headroom.",
        "Add a Redis cache for seat availability (short TTL, ~90% hits) so the database mostly takes writes.",
      ],
      solution: onSale(false),
    },
    {
      type: "sim",
      title: "Measure it: everyone hits refresh",
      body: "The hold service handles 4,000 req/s and normally gets 3,000. For 15 seconds a slow query drops it to a quarter of its capacity. Fans' apps retry failed requests three times, immediately - and the fans themselves mash refresh. Make the service recover within 10 s of the slowdown and keep the peak load below 1.5× normal.",
      sim: "retry-storm",
      params: { clientRps: 3000, capacity: 4000, incidentFactor: 0.25, timeoutMs: 1000, retries: 3, backoff: "none" },
      locked: ["clientRps", "capacity", "incidentFactor", "timeoutMs"],
      goals: [
        { metric: "recovery", op: "<=", value: 10, label: "Recovers within 10 s" },
        { metric: "amplification", op: "<=", value: 1.5, label: "Peak load ≤ 1.5× normal" },
      ],
      hints: [
        "Retries that come back the next second land on a service that's still slow - they keep it slow after the incident ends.",
        "Exponential backoff with jitter spreads retries out; a retry budget caps how much extra load they add.",
        "A short server queue sheds requests the app has already given up on. Try a 1 s queue limit.",
      ],
      solution: { backoff: "exponential", jitter: true, budgetPct: 10, queueLimitSec: 1 },
    },
    {
      type: "design",
      title: "The primary database dies",
      body: "At t=10 s the primary database crashes in the middle of the on-sale. Seat maps can keep coming from Redis and a replica, but holds and purchases need a new primary. Recover on your own within 25 seconds.",
      test: {
        traffic: { reads: 60_000, writes: 3_000, bots: 0 },
        incident: { type: "killKind", kind: "db", role: "primary" },
        constraints: [
          { type: "recovery", maxSeconds: 25 },
          { type: "uses", kind: "db", min: 2, why: "something has to take over" },
        ],
      },
      hints: [
        "Run it: every hold and purchase fails from t=10 s, forever.",
        "Add a database, set its role to Read replica, and wire every API server to it.",
        "Turn on 'Automatic DB failover' in the timeline bar. It takes 15 s to promote the replica; until then writes fail.",
      ],
      solution: onSale(true),
      solutionResilience: { dbFailover: true },
    },
  ],
};
