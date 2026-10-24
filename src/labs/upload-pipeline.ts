import { build } from "../presets";
import type { Lab } from "./types";

export const uploadPipeline: Lab = {
  module: 7,
  slug: "upload-pipeline",
  title: "Process uploads with a queue",
  product: "Photo upload processing",
  summary: "Uploads arrive in bursts. Answer users instantly, then resize and store in the background - without buying a giant database.",
  difficulty: "medium",
  minutes: 30,
  tags: ["queues", "workers", "backpressure", "idempotency"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `Every upload must be resized into three sizes and recorded in the database.

- Normally **1,500 uploads/s** and **1,000 reads/s**.
- Evenings bring a **4x burst** that lasts about a minute.
- Users only need "Got it!" quickly. The resized images may take a little while to appear.

Writing every upload straight to the database works - until the burst.`,
    },
    {
      type: "design",
      title: "Absorb the burst",
      body: "Run the starter design through the 4x spike: the database can't take the writes. Put a queue between the API and the work.",
      starter: build({
        nodes: [["client", "client"], ["api", "server", { size: "l" }], ["db", "db", { size: "l" }]],
        wires: "client>api, api>db",
      }),
      test: {
        traffic: { reads: 1000, writes: 1500, bots: 0 },
        incident: { type: "spike", factor: 4 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 60 },
          { type: "budget", maxUsd: 800, why: "a database big enough for the burst costs more than a queue" },
          { type: "backlog", max: 200_000 },
        ],
      },
      hints: [
        "Add a queue and wire API server → Queue. Writes now go to the queue and get an instant reply.",
        "Add workers: Queue → Workers → Database. Reads still go API server → Database.",
        "Too many workers just move the overload to the database. Find a worker count the database can absorb while reads stay fast - the backlog drains after the burst.",
      ],
      solution: build({
        nodes: [["client", "client"], ["api", "server", { size: "l" }], ["q", "queue"], ["w", "worker", { workers: 8 }], ["db", "db", { size: "l" }]],
        wires: "client>api, api>q, q>w, w>db, api>db",
      }),
    },
    {
      type: "quiz",
      title: "The job that ran twice",
      body: "A worker resizes an image, writes the row, then crashes before it acknowledges the message. The queue hands the job to another worker.",
      question: "How do you stop the upload from being recorded twice?",
      options: [
        { text: "Use a queue that guarantees exactly-once delivery", why: "Across a network, crashes between 'did the work' and 'said so' make exactly-once delivery impossible to guarantee in general." },
        { text: "Make the job idempotent: key the write by upload ID", correct: true, why: "Right. With an upsert or a unique constraint on upload_id, running the job twice leaves the same result. At-least-once delivery + idempotent jobs = effectively once." },
        { text: "Never retry failed jobs", why: "Then every crash loses an upload. Retrying is right; it just needs idempotent jobs." },
      ],
    },
    {
      type: "quiz",
      title: "The poison message",
      body: "One corrupted image crashes the resizer every time. The queue keeps redelivering it.",
      question: "What should happen to it?",
      options: [
        { text: "Retry forever with no delay", why: "It will never succeed, and it burns worker time on every attempt." },
        { text: "Retry a few times with backoff, then move it to a dead-letter queue", correct: true, why: "Right. Bounded retries with exponential backoff handle temporary failures; a dead-letter queue parks the poison message for a human to inspect." },
        { text: "Delete it immediately on the first failure", why: "Most failures are temporary (a timeout, a deploy). Dropping on the first error loses good uploads." },
      ],
    },
  ],
};
