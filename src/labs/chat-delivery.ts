import { build } from "../presets";
import type { Lab } from "./types";

const chat = (servers: number, healthChecks: boolean) =>
  build({
    nodes: [
      ["client", "client"],
      ["lb", "lb", { healthChecks }],
      ...Array.from({ length: servers }, (_, i) => [`gw${i + 1}`, "server", { size: "l" }] as [string, "server", { size: string }]),
      ["redis", "cache", { hitRatio: 0.8 }],
      ["db", "db", { size: "xl" }],
      ["log", "kafka", { partitions: 8 }],
      ["delivery", "consumer", { consumers: 8 }],
    ],
    wires: [
      "client>lb",
      ...Array.from({ length: servers }, (_, i) => `lb>gw${i + 1}, gw${i + 1}>redis, gw${i + 1}>db, gw${i + 1}>log`),
      "log>delivery",
    ].join(","),
  });

export const chatDelivery: Lab = {
  slug: "chat-delivery",
  module: 6,
  title: "Chat with delivery ticks",
  product: "Messaging",
  summary: "Three million people online, one tick when the server has a message, two when the phone does. Route messages to the right socket, keep every chat in order, and survive a gateway dying.",
  difficulty: "medium",
  minutes: 30,
  tags: ["WebSockets", "pub/sub", "ordering", "acks", "sequence numbers"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A messaging app with **20 million daily users**. At the evening peak **3 million** are online at once.

- People send about **6,000 messages/s** at peak, in 1:1 chats and groups of up to 256.
- Each message shows ticks: **✓ sent** (the server has it), **✓✓ delivered** (the recipient's phone has it), **blue ✓✓ read**.
- Messages in a chat must appear **in the same order for everyone**, even when phones drop off the network mid-send.
- A phone that was offline for a day must catch up on everything it missed when it reconnects.`,
    },
    {
      type: "quiz",
      title: "The connection",
      body: "Phones send messages, receive them, show typing indicators and send read receipts - all in both directions, all the time.",
      question: "Which transport fits?",
      options: [
        { text: "Short polling every 5 seconds", why: "3M phones ÷ 5 s = 600,000 requests/s, most of them empty, and messages arrive up to 5 s late. Typing indicators would be useless." },
        { text: "Server-Sent Events for incoming, POST for outgoing", why: "Workable, but chat is chatty in both directions: typing, receipts and sends would each be a separate HTTP request. One two-way socket is simpler and cheaper." },
        { text: "One WebSocket per phone, both directions", correct: true, why: "Right. One long-lived connection carries sends, deliveries, receipts and typing events with no per-message HTTP overhead. Phones reconnect and resync when it drops." },
      ],
    },
    {
      type: "quiz",
      title: "When does ✓ appear?",
      body: "Alice sends \"see you at 8\". Her phone shows a clock icon until something happens.",
      question: "When should her app turn the clock into a single ✓?",
      options: [
        { text: "As soon as she taps send", why: "Then a message lost in a tunnel still shows ✓. The tick would lie." },
        { text: "When the server has stored the message durably and replied with its sequence number", correct: true, why: "Right. ✓ means \"we have it and won't lose it\". The phone sends a client-generated message id; the server stores it (deduping retries by that id) and acks with the chat's sequence number." },
        { text: "When Bob's phone receives it", why: "That's ✓✓ (delivered). Bob may be offline for hours - Alice still needs to know the server has it." },
      ],
    },
    {
      type: "quiz",
      title: "Finding Bob's socket",
      body: "Bob's WebSocket lives on one of 40 gateway servers. Alice's message arrives at a different one.",
      question: "How does the message reach Bob?",
      options: [
        { text: "Broadcast every message to all 40 gateways; the one holding Bob delivers it", why: "Every gateway processes every message: 6,000 msg/s × 40 = 240,000 deliveries/s, 39 of every 40 wasted. It gets worse with every gateway you add." },
        { text: "Keep a session registry (user → gateway) in Redis and publish to that gateway's channel", correct: true, why: "Right. Gateways write user → gateway on connect (with a TTL). Delivery looks Bob up and publishes once to his gateway. If Bob is offline, the message waits in his inbox for the next sync." },
        { text: "Gateways poll the messages table every second for their users", why: "Adds up to a second of delay and constant load on the database, for 40 gateways × thousands of users each." },
      ],
    },
    {
      type: "quiz",
      title: "Keeping order",
      body: "In a group chat, two people send at almost the same moment from phones whose clocks differ by 3 seconds. Phones also retry when a send times out.",
      question: "What decides the order everyone sees?",
      options: [
        { text: "The phone's timestamp", why: "Phone clocks drift and can be set by hand. Two members would see different orders, and a wrong clock can push a message to the top." },
        { text: "A per-chat sequence number assigned when the server stores the message", correct: true, why: "Right. One writer per chat (e.g. the log partition keyed by chat_id) hands out 1, 2, 3… Everyone sorts by it, and a phone that sees 41 then 43 knows to fetch 42. Retries carry the same client id, so they don't get a new number." },
        { text: "The order the gateway received them", why: "Different gateways receive different messages; without one place that assigns the order, members can disagree." },
      ],
    },
    {
      type: "api",
      title: "The sync contract",
      body: "Live traffic goes over the WebSocket, but reconnecting phones catch up over HTTP. Design the endpoints for sending a message (idempotent), fetching everything after a sequence number, and reporting delivered/read receipts.",
      baseUrl: "https://chat.example",
      expect: [
        { goal: "Send a message to a chat", methods: ["POST", "PUT"], statuses: [201, 200], needsParam: true, why: "POST /chats/:id/messages with a client-generated message id (or PUT /chats/:id/messages/:clientId). 201 returns the server sequence number - that's the ✓. A retry with the same id returns the same message, not a duplicate." },
        { goal: "Fetch messages after a sequence number", methods: ["GET"], statuses: [200], needsParam: true, why: "GET /chats/:id/messages?after=1041 returns what the phone missed, in order. The phone remembers the last sequence it has for each chat." },
        { goal: "Report delivered / read receipts", methods: ["POST", "PUT"], statuses: [204, 202, 200], needsParam: true, why: "POST /chats/:id/receipts with \"delivered up to 1045\" or \"read up to 1043\". One watermark covers many messages, so receipts stay cheap. 204 is enough." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: 3 million phones",
      body: "3M phones online; a new message for a given phone arrives about every 20 seconds. The first prototype polls every 5 s. Get messages to phones within a second without drowning the API - and keep the gateways at most 75% full, so one can die or be drained for a deploy.",
      sim: "push-vs-poll",
      params: { users: 3_000_000, updateEverySec: 20, pollEverySec: 5 },
      locked: ["users", "updateEverySec", "connsPerGateway"],
      goals: [
        { metric: "requestsPerSec", op: "<=", value: 50000, label: "API requests ≤ 50k/s" },
        { metric: "avgDelaySec", op: "<=", value: 1, label: "Messages arrive within 1 s on average" },
        { metric: "gatewayLoad", op: "<=", value: 0.75, label: "Gateways ≤ 75% full" },
      ],
      hints: [
        "Try a longer poll interval: request load falls, but messages arrive later. There's no interval that meets both goals.",
        "Switch delivery to WebSockets.",
        "Each gateway safely holds 100,000 sockets. 3M sockets at 75% fill needs 3,000,000 ÷ 75,000 gateways.",
      ],
      solution: { mode: "websocket", gateways: 40 },
    },
    {
      type: "sim",
      title: "Measure it: a delivery worker crashes",
      body: "Stored messages flow through a log with 32 partitions keyed by chat_id, so each chat stays in order. 32 delivery workers each push about 1,500 messages/s; the log carries 30,000 events/s (messages plus receipts). At t=40 s a worker crashes. Nobody should wait more than 3 seconds for a ✓✓.",
      sim: "kafka-log",
      params: { producerRps: 30000, partitions: 32, consumers: 32, perConsumerRps: 1500, crash: true, rebalance: "eager" },
      locked: ["producerRps", "perConsumerRps", "crash", "hotKeyPct"],
      goals: [
        { metric: "maxLagAge", op: "<=", value: 3, label: "Never more than 3 s behind" },
        { metric: "finalLag", op: "<=", value: 1000, label: "Lag at the end ≤ 1,000" },
      ],
      hints: [
        "An eager rebalance pauses the whole group for ~10 s. Try cooperative.",
        "Cooperative alone isn't enough: after the crash one worker owns two partitions (1,875 events/s) but handles 1,500. Its lag grows forever.",
        "Run a few spare workers. With more workers than partitions, the spares sit idle - and nothing has to move when one dies.",
      ],
      solution: { rebalance: "cooperative", consumers: 40 },
    },
    {
      type: "design",
      title: "Build it on the canvas: store, order, deliver",
      body: "Peak: **6,000 messages/s** (writes) and **24,000 syncs and history reads/s**. Each gateway server handles about 16,000 req/s. Store every message, publish it to a **Kafka log** keyed by chat, and let a **delivery consumer group** push it to recipients - fast enough that it never falls behind. Keep the session registry and recent messages in **Redis**.",
      starter: build({
        nodes: [["client", "client"], ["lb", "lb"], ["gw1", "server", { size: "l" }], ["gw2", "server", { size: "l" }], ["db", "db", { size: "xl" }]],
        wires: "client>lb, lb>gw1, lb>gw2, gw1>db, gw2>db",
      }),
      test: {
        traffic: { reads: 24_000, writes: 6_000, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 100 },
          { type: "uses", kind: "cache", why: "session registry and recent messages" },
          { type: "uses", kind: "kafka", why: "an ordered log per chat" },
          { type: "consumerLag", maxGrowth: 0 },
          { type: "budget", maxUsd: 2000 },
        ],
      },
      hints: [
        "Two gateways at 30,000 req/s are both at ~94% - p99 explodes. Add a third.",
        "Add a Redis cache and a Kafka topic, and wire every gateway to both. Then add a consumer group and wire the topic to it.",
        "6,000 events/s at ~1,000 per consumer needs 6+ busy consumers - and a group can't use more consumers than partitions. Try 8 partitions and 8 consumers.",
      ],
      solution: chat(3, false),
    },
    {
      type: "design",
      title: "A gateway dies at peak",
      body: "At t=10 s one gateway crashes. Its phones reconnect to the others (they retry), and they resync from their last sequence number. Keep every second at 99% success and p99 under 150 ms - the survivors have to carry the load.",
      test: {
        traffic: { reads: 24_000, writes: 6_000, bots: 0 },
        incident: { type: "killKind", kind: "server" },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 150 },
        ],
      },
      hints: [
        "Run the test: the load balancer keeps sending a third of the traffic to the dead gateway.",
        "Turn on health checks on the load balancer.",
        "Two gateways at 30,000 req/s run at ~94% - latency explodes. Plan for N+1: add a fourth gateway (and wire it like the others).",
      ],
      solution: chat(4, true),
    },
    {
      type: "quiz",
      title: "The ✓✓ for a group",
      body: "A message goes to a group of 200. Members' phones come online over the next few hours.",
      question: "When does the sender see ✓✓?",
      options: [
        { text: "When the first member's phone acknowledges", why: "Then ✓✓ would mean almost nothing in a big group." },
        { text: "When every member's phone has acknowledged; tap the message to see who has read it", correct: true, why: "Right. The server tracks a delivered/read watermark per member and flips the sender's tick when all have passed the message's sequence number. Per-member detail is fetched on demand, not pushed." },
        { text: "Never - groups only show ✓", why: "Users expect delivery status in groups too. Watermarks per member make it affordable." },
      ],
    },
  ],
};
