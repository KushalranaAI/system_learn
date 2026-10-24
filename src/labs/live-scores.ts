import type { Lab } from "./types";

export const liveScores: Lab = {
  slug: "live-scores",
  module: 6,
  title: "Push live match scores",
  product: "Sports",
  summary: "One million fans watching a final. Choose the push technology, size the gateways, and deliver every update in order.",
  difficulty: "medium",
  minutes: 20,
  tags: ["SSE", "WebSockets", "pub/sub", "fan-out", "reconnects"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A cricket final: **1,000,000 fans** have the app open.

- Scores change roughly **every 6 seconds**; fans expect them within **2 seconds**.
- Fans send reactions (🔥, 😱) that show as live counts.
- Phones switch networks constantly, and you'll deploy during the match.`,
    },
    {
      type: "quiz",
      title: "Push or pull?",
      body: "Option A: every app polls `GET /match/score` every 2 seconds. Option B: each app holds one stream and the server pushes changes.",
      question: "Which fits best, and why?",
      options: [
        { text: "Polling - it's simpler and stateless", why: "1M ÷ 2 s = 500,000 req/s, nearly all returning the same unchanged score. Simple, but very wasteful at this scale." },
        { text: "Server-Sent Events (SSE)", correct: true, why: "Right. Updates flow one way (server → fans), SSE runs over plain HTTP, and it resumes automatically with Last-Event-ID. Reactions can go up as normal POSTs." },
        { text: "WebSockets for everything", why: "They work too, but two-way sockets aren't needed for one-way score updates, and they add protocol and scaling work." },
      ],
    },
    {
      type: "quiz",
      title: "Sizing the connection tier",
      body: "One gateway can safely hold about 100,000 idle streams. You want to survive losing one gateway and deploying another at the same time.",
      question: "How many gateways should you run?",
      options: [
        { text: "10", why: "That's exactly 1M ÷ 100k with zero headroom - losing one overloads the rest." },
        { text: "12-13", correct: true, why: "Right. 10 for the load, plus room for one failure and one draining for a deploy. Balance new connections by least-connections." },
        { text: "1, on the biggest machine", why: "One box can't hold a million connections safely, and it's a single point of failure." },
      ],
    },
    {
      type: "quiz",
      title: "One update, a million screens",
      body: "The score service has a new score. Fans are spread across 12 gateways.",
      question: "How should the update reach every fan?",
      options: [
        { text: "The score service sends 1M messages, one per fan", why: "It would need to track every fan's gateway and send a million network messages per update." },
        { text: "Publish once to a match channel; each gateway pushes to its own connections", correct: true, why: "Right. One publish reaches 12 gateways (12 messages); each fans out to its ~80k local sockets. Include a sequence number so clients can resume after a drop." },
        { text: "Write the score to the database; gateways query it every second", why: "That's polling moved inside the data centre - workable, but it adds up to a second of delay and constant load." },
      ],
    },
    {
      type: "api",
      title: "The resume contract",
      body: "Design the two endpoints the app uses: open the event stream for a match, and post a reaction. The stream must resume after a drop.",
      baseUrl: "https://live.example",
      expect: [
        { goal: "Open the match event stream", methods: ["GET"], statuses: [200], needsParam: true, why: "Streams are a GET on the match (like /matches/:id/events) answered with 200 and text/event-stream. The client sends Last-Event-ID on reconnect." },
        { goal: "Post a reaction", methods: ["POST"], statuses: [202, 201, 204], needsParam: true, why: "Reactions are a POST on the match (like /matches/:id/reactions). 202 Accepted fits: they're counted asynchronously and shown as aggregates." },
      ],
    },
    {
      type: "quiz",
      title: "The big moment",
      body: "A six: 300,000 fans tap 🔥 within 10 seconds.",
      question: "How should reactions be shown to everyone?",
      options: [
        { text: "Broadcast every reaction to every fan", why: "300,000 reactions × 1M fans = 3 × 10¹¹ messages. Impossible." },
        { text: "Count them and broadcast an aggregate once a second", correct: true, why: "Right. Increment sharded counters as reactions arrive, and publish '🔥 +48,211' each second. Fans see the excitement without the firehose." },
        { text: "Drop reactions during big moments", why: "That's exactly when fans care most - aggregate instead." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: polling vs push",
      body: "One million fans, a score that changes every 6 seconds. Today the app polls every 2 seconds. Get updates to fans within 2 seconds without drowning the API - and leave the gateways room to lose one.",
      sim: "push-vs-poll",
      locked: ["users", "updateEverySec", "connsPerGateway"],
      goals: [
        { metric: "requestsPerSec", op: "<=", value: 50000, label: "API requests ≤ 50k/s" },
        { metric: "avgDelaySec", op: "<=", value: 2, label: "Fans see changes within 2 s on average" },
        { metric: "gatewayLoad", op: "<=", value: 0.8, label: "Gateways ≤ 80% full (room to lose one)" },
      ],
      hints: ["Slower polling cuts load but delays updates - try it.", "Switch delivery to Server-Sent Events.", "1M connections at 100k per gateway need 10 gateways at 100% - add headroom."],
      solution: { mode: "sse", gateways: 13 },
    },
  ],
};
