import { build } from "../presets";
import type { Lab } from "./types";

export const paymentsLedger: Lab = {
  slug: "payments-ledger",
  module: 16,
  title: "A payments ledger",
  product: "Payments",
  summary: "Money must never be created, lost or moved twice. Build a double-entry ledger, make every call idempotent, and run payouts as sagas that announce themselves through an outbox.",
  difficulty: "hard",
  minutes: 30,
  tags: ["idempotency", "sagas", "outbox", "double-entry", "consistency"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A wallet app: people top up from a card, pay each other, and pay out to their bank.

- Peak: **2,000 payments/s** and **4,000 balance and history reads/s**.
- Card top-ups and bank payouts go through **external providers** over HTTP. They time out, retry, and occasionally answer twice.
- Regulators and auditors must be able to explain **every cent**: where it came from, where it went, and when.
- The rule that can't bend: the sum of all balances always equals the money you actually hold.`,
    },
    {
      type: "quiz",
      title: "How to record money",
      body: "Alice pays Bob $25.",
      question: "How should the ledger store it?",
      options: [
        { text: "UPDATE accounts SET balance = balance - 25 for Alice, + 25 for Bob", why: "The balances change but nothing says why. A bug or a half-applied update leaves money created or destroyed, and you can't reconstruct what happened." },
        { text: "Append a transaction with two entries - debit Alice 25, credit Bob 25 - that must sum to zero; balances are derived from entries", correct: true, why: "Right. Double-entry: every movement is recorded on both sides, entries are never edited (a mistake is fixed by a reversing entry), and any balance can be recomputed and audited. Keep a cached balance per account, updated in the same transaction." },
        { text: "Store a JSON log of payments in object storage", why: "Durable, but you can't enforce balances, constraints or atomic updates on it." },
      ],
    },
    {
      type: "quiz",
      title: "The retried payment",
      body: "Alice taps Pay. Her phone's request times out after 10 s, and the app retries. The first request actually succeeded.",
      question: "How do you avoid charging her twice?",
      options: [
        { text: "Ask users not to tap twice", why: "The retry came from the app, not the user - and networks will always produce retries." },
        { text: "The app sends an Idempotency-Key per payment; the server stores the key with the result in the same transaction and replays the result on a repeat", correct: true, why: "Right. A unique constraint on (account, key) makes the second request find the first one's result and return it. A repeat with a different body for the same key is rejected." },
        { text: "Reject any payment with the same amount to the same person within a minute", why: "That blocks legitimate repeats (two coffees) and still misses retries that arrive later." },
      ],
    },
    {
      type: "quiz",
      title: "Two withdrawals at once",
      body: "Alice has $100. Two $80 payments from her account arrive at the same moment on different servers.",
      question: "How do you stop the balance going negative?",
      options: [
        { text: "Read the balance, check it's ≥ 80, then write the entries", why: "Both requests read $100, both pass the check, both write: -$60. Check-then-act race." },
        { text: "Do the check and the write atomically: lock the account row (SELECT … FOR UPDATE) or UPDATE … SET balance = balance - 80 WHERE balance >= 80, in the same transaction as the entries", correct: true, why: "Right. One request wins; the other sees insufficient funds. Locking per account keeps the contention to that one account." },
        { text: "Let it go negative and send Alice a bill", why: "Some products allow overdrafts deliberately - this one doesn't, and accidental overdrafts are a compliance problem." },
      ],
    },
    {
      type: "api",
      title: "The payments API",
      body: "Design the endpoints: create a payment (safe to retry), fetch a payment's status, refund a payment, and list an account's entries.",
      baseUrl: "https://pay.example",
      expect: [
        { goal: "Create a payment", methods: ["POST"], statuses: [201, 202], why: "POST /payments with an Idempotency-Key header. 201 when it completes synchronously; 202 when it goes on to an external provider and finishes later." },
        { goal: "Check a payment's status", methods: ["GET"], statuses: [200], needsParam: true, why: "GET /payments/:id returns its state ('pending', 'succeeded', 'failed') - clients and support look here after a timeout." },
        { goal: "Refund a payment", methods: ["POST"], statuses: [201, 202], needsParam: true, why: "POST /payments/:id/refunds creates a new reversing transaction (also idempotent). Nothing is ever deleted or edited." },
        { goal: "List an account's ledger entries", methods: ["GET"], statuses: [200], needsParam: true, why: "GET /accounts/:id/entries?cursor=… pages through the immutable history. Use cursor pagination - the list only grows." },
      ],
    },
    {
      type: "quiz",
      title: "Paying out to a bank",
      body: "A payout: hold the funds in the ledger, call the bank's API, then post the final entries. The bank call can fail, or time out without telling you what happened.",
      question: "How do you structure it?",
      options: [
        { text: "One database transaction around all three steps", why: "The bank isn't in your database. Holding a transaction open across a slow external call blocks the account, and a rollback can't un-send money." },
        { text: "A saga: each step is its own local transaction with a compensation (release the hold); ambiguous timeouts are resolved by querying the bank with the idempotency key", correct: true, why: "Right. The payout moves through states (held → sent → settled, or released). Each step is retried safely, and a timeout is 'unknown' until you ask - never assumed to be a failure." },
        { text: "Call the bank first, then update the ledger", why: "If you crash after the bank call, the money left and the ledger never knew." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: 10,000 payouts",
      body: "10,000 payouts, with real-world failure rates (bank networks time out more often than card checkouts: 6%). The team already has compensations and an outbox. Find what's still missing so no payout ends inconsistent. The simulation speaks shop: \"stock\" is the funds hold, \"card\" is the bank, \"shipping\" is the notification and accounting consumers.",
      sim: "saga",
      params: { orders: 10000, timeoutPct: 6, compensate: true, outbox: true },
      locked: ["orders", "stockFailPct", "declinePct", "timeoutPct", "crashPct", "redeliverPct"],
      goals: [{ metric: "inconsistent", op: "<=", value: 0, label: "0 inconsistent payouts" }],
      hints: [
        "Look at the bars: which kinds of inconsistency are left?",
        "A timeout isn't a failure: query the outcome - and only with an idempotency key is retrying safe.",
        "Events are delivered at least once. Consumers must dedupe by event id.",
      ],
      solution: { timeoutHandling: "query", idempotencyKeys: true, dedupeConsumers: true },
    },
    {
      type: "sim",
      title: "Measure it: the payment call chain",
      body: "Creating a payment calls 7 services in a row: auth, fraud scoring, the ledger - plus receipts, rewards, analytics and the activity feed. Each has a p50 of 25 ms and 99.9% availability. Only the first three are needed to take the money. Get p99 under 300 ms and success above 99.5%.",
      sim: "service-chain",
      params: { services: 7, p50: 25, tail: 6, availability: 0.999, mode: "sequential", critical: 3 },
      locked: ["services", "p50", "tail", "availability", "critical"],
      goals: [
        { metric: "p99", op: "<=", value: 300, label: "p99 ≤ 300 ms" },
        { metric: "success", op: ">=", value: 0.995, label: "Success ≥ 99.5%" },
      ],
      hints: [
        "Seven 99.9% services in a row give at best 99.3% - and every one adds its tail latency.",
        "Receipts, rewards, analytics and the feed don't have to happen before the response.",
        "Publish them as events after the payment commits (via the outbox) instead of calling them in the request.",
      ],
      solution: { asyncSideEffects: true },
    },
    {
      type: "design",
      title: "Build it on the canvas: payments through a saga",
      body: "**2,000 payments/s** and **4,000 reads/s**. Route every payment through a **saga orchestrator** that runs its three local transactions against the ledger database, turn on the safeguards until **no payment ends inconsistent**, and let the saga publish its events to a **Kafka topic** (the outbox relay) read by a **consumer group** for notifications - fast enough that it keeps up.",
      starter: build({
        nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "l" }], ["api2", "server", { size: "l" }], ["ledger", "db", { size: "xl" }]],
        wires: "client>lb, lb>api1, lb>api2, api1>ledger, api2>ledger",
      }),
      test: {
        traffic: { reads: 4000, writes: 2000, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 150 },
          { type: "uses", kind: "saga" },
          { type: "uses", kind: "kafka", why: "events leave through the outbox relay" },
          { type: "consistency", maxPerSec: 0 },
          { type: "consumerLag", maxGrowth: 0 },
        ],
      },
      hints: [
        "Add a Saga orchestrator, wire both API servers to it, and wire it to the ledger database.",
        "Select the saga and turn on all five safeguards. Three steps per payment is 6,000 writes/s - check the database still has room.",
        "Wire the saga to a Kafka topic and the topic to a consumer group. 2,000 events/s at ~1,000 per consumer: 4 partitions, 4 consumers.",
      ],
      solution: build({
        nodes: [
          ["client", "client"],
          ["lb", "lb", { healthChecks: true }],
          ["api1", "server", { size: "l" }],
          ["api2", "server", { size: "l" }],
          ["saga", "saga", { sagaSteps: 3, compensate: true, queryTimeouts: true, idempotencyKeys: true, outbox: true, dedupeConsumers: true }],
          ["ledger", "db", { size: "xl" }],
          ["events", "kafka", { partitions: 4 }],
          ["notify", "consumer", { consumers: 4 }],
        ],
        wires: "client>lb, lb>api1, lb>api2, api1>ledger, api2>ledger, api1>saga, api2>saga, saga>ledger, saga>events, events>notify",
      }),
    },
    {
      type: "quiz",
      title: "The nightly reconciliation",
      body: "Every night the bank sends a settlement file listing what actually moved.",
      question: "Why compare it with your ledger if every step is already idempotent?",
      options: [
        { text: "You don't need to - idempotency guarantees correctness", why: "Idempotency protects against your own retries. It can't catch a provider bug, a manual correction at the bank, or a timeout you never resolved." },
        { text: "Reconciliation catches what the system can't see: mismatches with the outside world get flagged and fixed with new entries", correct: true, why: "Right. Every real payments system reconciles with its providers daily. Differences become exceptions for a person or an automated rule to resolve - always with a new, explained entry." },
        { text: "To recompute every balance from scratch", why: "You can do that from entries anytime. Reconciliation is about agreeing with external records." },
      ],
    },
  ],
};
