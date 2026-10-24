import { build } from "../presets";
import type { Lab } from "./types";

export const placeAnOrder: Lab = {
  slug: "place-an-order",
  module: 16,
  title: "Place an order across services",
  product: "E-commerce checkout",
  summary: "Orders, inventory and payments live in different services. Design a saga that never ships unpaid orders or charges for missing stock.",
  difficulty: "hard",
  minutes: 25,
  tags: ["sagas", "compensation", "outbox", "idempotency", "2PC"],
  steps: [
    {
      type: "intro",
      title: "The checkout",
      body: `Placing an order needs three services:

- **Orders** (Postgres): the order and its status.
- **Inventory** (its own database): stock per item.
- **Payments**: authorises and captures through an external card provider's HTTP API.

Any call can fail, be slow, or time out. Customers must never be charged for an order that can't be fulfilled, and stock must never be oversold.`,
    },
    {
      type: "quiz",
      title: "Distributed transaction?",
      body: "A teammate proposes two-phase commit across the three services.",
      question: "Why is that a poor fit here?",
      options: [
        { text: "2PC is fine - it's the standard answer", why: "Inside one distributed database, yes. Across independent services and an external API, no." },
        { text: "The card provider can't join 2PC, and participants would block holding locks if the coordinator fails", correct: true, why: "Right. External APIs have no prepare phase, and 2PC couples every service's availability to the coordinator. Use a saga of local transactions with compensations." },
        { text: "2PC is too slow for any use", why: "Speed isn't the main issue - blocking and lack of participant support are." },
      ],
    },
    {
      type: "quiz",
      title: "Order the steps",
      body: "Steps: create order (pending), reserve stock, authorise payment, confirm order. Stock is the most likely to be unavailable; payment authorisation is easy to void.",
      question: "Which order is safest?",
      options: [
        { text: "Authorise payment → reserve stock → create order", why: "Charging (authorising) before knowing stock exists means frequent voids, and there's no order record to attach them to." },
        { text: "Create order (pending) → reserve stock → authorise payment → confirm", correct: true, why: "Right. A pending order records intent; the step most likely to fail (stock) comes before payment; confirmation comes last. Capture and shipping happen after confirmation." },
        { text: "Run all three in parallel", why: "Then you'd often have to undo two successes because the third failed - more compensations, more confusion." },
      ],
    },
    {
      type: "quiz",
      title: "Payment declined",
      body: "Stock was reserved, then the card was declined.",
      question: "What does the saga do?",
      options: [
        { text: "Roll back the inventory database", why: "Each step already committed locally - there's nothing to roll back. You need a compensating action." },
        { text: "Run compensations in reverse: release the reservation, then mark the order cancelled", correct: true, why: "Right. Compensations are business actions that undo earlier steps' effects. Each must be idempotent, since it may be retried." },
        { text: "Retry the payment forever", why: "A decline is a permanent answer - retrying won't help, and the stock stays locked." },
      ],
    },
    {
      type: "quiz",
      title: "The payment timeout",
      body: "The authorise call to the card provider times out after 10 s.",
      question: "What should happen next?",
      options: [
        { text: "Treat it as declined and compensate", why: "The provider may have authorised the card - you'd cancel an order the customer was charged for." },
        { text: "Retry with the same idempotency key (or query status by it) before deciding", correct: true, why: "Right. A timeout means 'unknown'. Reusing the key returns the original outcome; the order stays pending until you know." },
        { text: "Retry with a new request", why: "That could authorise twice." },
      ],
    },
    {
      type: "quiz",
      title: "Announcing the order",
      body: "After confirming, Orders must publish OrderConfirmed so that email, shipping and analytics react. The service sometimes crashes right after committing.",
      question: "How do you make sure the event is never lost or invented?",
      options: [
        { text: "Publish inside the database transaction", why: "The broker isn't part of the transaction - a rollback after publishing still announces a phantom order." },
        { text: "Write the event to an outbox table in the same transaction; a relay publishes it", correct: true, why: "Right. The confirmation and the event commit atomically; the relay publishes at-least-once, and consumers dedupe by event id." },
        { text: "Have consumers poll the orders table", why: "It couples every consumer to Orders' schema and database load." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: 5,000 orders, zero inconsistencies",
      body: "5,000 orders with real-world failure rates: out-of-stock, declines, ambiguous payment timeouts, crashes between commit and publish, and duplicate deliveries. Turn on the mechanisms that leave **no** order inconsistent.",
      sim: "saga",
      locked: ["orders", "stockFailPct", "declinePct", "timeoutPct", "crashPct", "redeliverPct"],
      goals: [{ metric: "inconsistent", op: "<=", value: 0, label: "0 inconsistent orders" }],
      hints: [
        "Each bar is a different failure. Turn on one mechanism at a time and watch which bar drops to zero.",
        "A timeout isn't a decline: retry or query the outcome - and that's only safe with idempotency keys.",
        "Lost events need the outbox; duplicate events need consumers that dedupe.",
      ],
      solution: { compensate: true, timeoutHandling: "query", idempotencyKeys: true, outbox: true, dedupeConsumers: true },
    },
    {
      type: "design",
      title: "Build it on the canvas: a checkout saga",
      body: "1,500 orders a second. Route every order through a **Saga orchestrator** that runs its steps against the database, and turn on the safeguards until no order ends inconsistent.",
      starter: build({
        nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "l" }], ["api2", "server", { size: "l" }], ["db", "db", { size: "xl" }]],
        wires: "client>lb, lb>api1, lb>api2, api1>db, api2>db",
      }),
      test: {
        traffic: { reads: 3000, writes: 1500, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "uses", kind: "saga" },
          { type: "consistency", maxPerSec: 0 },
        ],
      },
      hints: [
        "Add a Saga orchestrator, wire both API servers to it, and wire it to the database.",
        "Select the saga: the inspector shows which inconsistencies happen and why.",
        "Turn on all five safeguards. Each step is a database write - check the database still has room.",
      ],
      solution: build({
        nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "l" }], ["api2", "server", { size: "l" }], ["saga", "saga", { sagaSteps: 3, compensate: true, queryTimeouts: true, idempotencyKeys: true, outbox: true, dedupeConsumers: true }], ["db", "db", { size: "xl" }]],
        wires: "client>lb, lb>api1, lb>api2, api1>db, api2>db, api1>saga, api2>saga, saga>db",
      }),
    },
  ],
};
