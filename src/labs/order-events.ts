import { build } from "../presets";
import type { Lab } from "./types";

export const orderEvents: Lab = {
  slug: "order-events",
  module: 15,
  title: "Build an order events backbone",
  product: "E-commerce",
  summary: "Seven services react to every order change through one event log. Pick topics, keys, partitions and guarantees that never lose or double-apply an event.",
  difficulty: "hard",
  minutes: 25,
  tags: ["Kafka", "partition keys", "consumer groups", "outbox", "idempotency"],
  steps: [
    {
      type: "intro",
      title: "The goal",
      body: `Today the orders service calls billing, inventory, shipping, email, search, analytics and fraud directly - one slow service slows checkout.

Replace the calls with an **event backbone**: orders publishes facts, every service consumes them.

- Peak: **25,000 order events/s**. One consumer instance handles ~1,000/s.
- Each order's events must be processed **in order** (placed → paid → shipped).
- No event lost; no event applied twice.`,
    },
    {
      type: "quiz",
      title: "Queue or log?",
      body: "Seven services need every order event, some of them may be down for maintenance, and a new fraud model will want last week's events.",
      question: "Which broker model fits?",
      options: [
        { text: "A work queue (each message delivered to one consumer, then deleted)", why: "Services would compete for messages, and nothing could replay history." },
        { text: "A partitioned log (Kafka-style) with one consumer group per service", correct: true, why: "Right. Each group reads everything at its own pace, retention lets slow or new consumers catch up, and partitions give per-key ordering." },
        { text: "Direct HTTP webhooks to each service", why: "That's the point-to-point coupling you're trying to remove." },
      ],
    },
    {
      type: "quiz",
      title: "Partition key",
      body: "Events: OrderPlaced, OrderPaid, OrderShipped, OrderCancelled.",
      question: "What should the partition key be?",
      options: [
        { text: "No key (round robin) for the best spread", why: "An order's 'paid' could be processed before its 'placed' - ordering is lost." },
        { text: "order_id", correct: true, why: "Right. All events of one order land in the same partition, in order, and millions of orders spread evenly." },
        { text: "event type", why: "Only four values: four hot partitions, and an order's events split across them out of order." },
      ],
    },
    {
      type: "quiz",
      title: "How many partitions?",
      body: "25,000 events/s at peak; one consumer handles ~1,000/s; traffic is expected to double in two years.",
      question: "Pick the partition count.",
      options: [
        { text: "8", why: "At most 8 consumers per group could work - 8,000/s, far below the peak." },
        { text: "64", correct: true, why: "Right. Today you need 25+ consumers per group; 64 partitions leave room to double without changing the count (which would reshuffle keys)." },
        { text: "10,000", why: "Far more than needed: lots of overhead in files, leader elections and rebalances." },
      ],
    },
    {
      type: "quiz",
      title: "Publishing reliably",
      body: "The orders service commits the order to Postgres, then publishes OrderPlaced. Sometimes it crashes in between.",
      question: "How do you guarantee the event is published exactly when the order commits?",
      options: [
        { text: "Publish first, then commit", why: "If the commit fails, consumers react to an order that doesn't exist." },
        { text: "Transactional outbox: write the event to an outbox table in the same transaction; a relay publishes it", correct: true, why: "Right. The order and its event commit atomically; the relay (or CDC) publishes with an idempotent producer and retries until it succeeds." },
        { text: "Retry the publish in a loop inside the request", why: "A crash still loses the event, and the request hangs while the broker is slow." },
      ],
    },
    {
      type: "quiz",
      title: "Consuming safely",
      body: "Consumers commit offsets after processing. After a crash, some events are processed again.",
      question: "How do you make the billing consumer safe?",
      options: [
        { text: "Commit offsets before processing", why: "Then a crash after the commit skips the event - an unbilled order." },
        { text: "Dedupe by event id in the same DB transaction as the billing write", correct: true, why: "Right. At-least-once delivery + idempotent processing = effectively once. A unique event_id makes reprocessing a no-op." },
        { text: "Enable Kafka exactly-once and skip dedupe", why: "Kafka transactions cover Kafka-to-Kafka writes; the billing database write still needs its own idempotency." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: keep up with 20,000 events/s",
      body: "Each consumer handles 1,000 events/s. The topic has 8 partitions and the group 8 consumers - lag grows forever. Size them so lag stays under 1,000 events and never more than 5 s behind.",
      sim: "kafka-log",
      locked: ["producerRps", "perConsumerRps", "hotKeyPct", "crash"],
      goals: [
        { metric: "finalLag", op: "<=", value: 1000, label: "Lag at the end ≤ 1,000" },
        { metric: "maxLagAge", op: "<=", value: 5, label: "Never more than 5 s behind" },
      ],
      hints: ["Try adding consumers without adding partitions - watch 'Idle consumers'.", "You need at least 20 consumers working, so at least 20 partitions.", "Give each consumer an even share: e.g. 48 partitions and 48 consumers."],
      solution: { partitions: 48, consumers: 48 },
    },
    {
      type: "sim",
      title: "Measure it: a crash and a hot key",
      body: "Now a consumer crashes at t=40 s, and one customer's key is 8% of all traffic. Stay within 5 s of real time.",
      sim: "kafka-log",
      params: { partitions: 48, consumers: 48, crash: true, hotKeyPct: 8 },
      locked: ["producerRps", "perConsumerRps", "hotKeyPct", "crash"],
      goals: [
        { metric: "finalLag", op: "<=", value: 1000, label: "Lag at the end ≤ 1,000" },
        { metric: "maxLagAge", op: "<=", value: 5, label: "Never more than 5 s behind" },
      ],
      hints: ["An eager rebalance pauses the whole group for about 10 s.", "Partition 0 receives 1,600+ events/s from the hot key - more than one consumer can handle.", "Use cooperative rebalancing, and salt the hot key (if its events don't need strict order)."],
      solution: { rebalance: "cooperative", saltHotKey: true },
    },
    {
      type: "design",
      title: "Build it on the canvas: the event backbone",
      body: "4,000 orders a second. Publish every write to a Kafka topic and add **two consumer groups** (say, search indexing and emails) that both keep up. Each consumer handles about 1,000 events/s.",
      starter: build({
        nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "l" }], ["api2", "server", { size: "l" }], ["db", "db", { size: "xl" }]],
        wires: "client>lb, lb>api1, lb>api2, api1>db, api2>db",
      }),
      test: {
        traffic: { reads: 5000, writes: 4000, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "uses", kind: "kafka", why: "publish events once" },
          { type: "uses", kind: "consumer", min: 2, why: "two independent consumer groups" },
          { type: "consumerLag", maxGrowth: 0 },
        ],
      },
      hints: [
        "Add a Kafka topic and wire both API servers to it - every write is then also published as an event.",
        "Add two Consumer groups and wire the topic to each. Each group reads the whole stream.",
        "A group can use at most one consumer per partition: 4,000 events/s needs ≥ 4 busy consumers - e.g. 12 partitions and 6 consumers per group.",
      ],
      solution: build({
        nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "l" }], ["api2", "server", { size: "l" }], ["db", "db", { size: "xl" }], ["topic", "kafka", { partitions: 12 }], ["search", "consumer", { consumers: 6 }], ["email", "consumer", { consumers: 6 }]],
        wires: "client>lb, lb>api1, lb>api2, api1>db, api2>db, api1>topic, api2>topic, topic>search, topic>email",
      }),
    },
  ],
};
