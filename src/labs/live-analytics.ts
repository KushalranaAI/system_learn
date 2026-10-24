import type { Lab } from "./types";

export const liveAnalytics: Lab = {
  slug: "live-analytics",
  module: 17,
  title: "Build live analytics",
  product: "News site",
  summary: "80,000 page views a second into a live editors' dashboard within 10 seconds. Choose ingestion, windows, lateness and approximate counting.",
  difficulty: "hard",
  minutes: 25,
  tags: ["stream processing", "windows", "watermarks", "HyperLogLog", "CDC"],
  steps: [
    {
      type: "intro",
      title: "The dashboard",
      body: `Editors want, live:

1. **Views per article per minute**
2. **Top 10 articles in the last 5 minutes**
3. **Unique readers per article today**

Traffic: **80,000 page-view events/s**. Phones on bad networks send events up to **2 minutes late**. Results should appear within **10 seconds**.`,
    },
    {
      type: "api",
      title: "The collector endpoint",
      body: "Browsers send view beacons in batches. Design the endpoint.",
      baseUrl: "https://collect.example",
      expect: [
        { goal: "Accept a batch of view events", methods: ["POST"], statuses: [202, 204], why: "A POST that answers 202 Accepted (or 204) immediately - events are written to the log and processed asynchronously." },
      ],
    },
    {
      type: "quiz",
      title: "Which clock?",
      body: "An event says it happened at 10:00:40 but arrives at 10:02:10.",
      question: "Which minute should it count towards?",
      options: [
        { text: "10:02 - when it was processed", why: "Then every network delay distorts the per-minute numbers." },
        { text: "10:00 - its event time", correct: true, why: "Right. Window by event time; a watermark decides when a minute is complete, and allowed lateness lets this event correct the 10:00 result." },
        { text: "Drop it - it's late", why: "Two minutes is within the expected lateness for mobile - dropping it undercounts mobile readers." },
      ],
    },
    {
      type: "quiz",
      title: "Freshness vs completeness",
      body: "Results must show within 10 s of each minute ending, yet events can be 2 minutes late.",
      question: "How do you configure the window?",
      options: [
        { text: "Wait 2 minutes before emitting each window", why: "Complete, but editors would see numbers 2 minutes late - too slow." },
        { text: "Emit at a ~5 s watermark, allow 2 minutes of lateness, and emit corrections", correct: true, why: "Right. A fast first result, then updates as late events arrive; the dashboard upserts by (article, minute)." },
        { text: "Use processing-time windows", why: "Fast, but late events land in the wrong minute and are never corrected." },
      ],
    },
    {
      type: "quiz",
      title: "Unique readers",
      body: "Exact unique readers per article per day would mean storing every reader id for every article.",
      question: "What's the practical approach for a live dashboard?",
      options: [
        { text: "A HyperLogLog per article per day", correct: true, why: "Right. ~12 KB per counter, about 1% error, and sketches from different partitions merge. Exact numbers, if ever needed, come from the nightly batch." },
        { text: "A set of reader ids per article in Redis", why: "Exact, but memory grows with readers × articles - millions of ids per popular article." },
        { text: "Count page views instead", why: "Views overcount readers who come back - it answers a different question." },
      ],
    },
    {
      type: "quiz",
      title: "Getting it exactly right",
      body: "Finance uses yesterday's views to pay authors. The stream may have missed or double-counted a little during incidents.",
      question: "How do you produce payout-grade numbers?",
      options: [
        { text: "Trust the streaming numbers", why: "Streams under incidents can drift; payouts need exactness." },
        { text: "Stream for the live dashboard, and a nightly batch job recomputes yesterday exactly", correct: true, why: "Right. Stream for speed, batch to reconcile - the batch reads the retained events (or the lake) and overwrites the stored daily totals." },
        { text: "Turn off late events so numbers never change", why: "That makes the numbers stable but wrong." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: per-minute counts with late events",
      body: "10% of events arrive up to 2 minutes late, and traffic varies with a spike. Get the final per-minute counts at least 99.5% accurate, with a first result no more than 10 s after each minute ends.",
      sim: "event-windows",
      locked: ["rate", "latePct", "maxLateSec", "windowSec"],
      goals: [
        { metric: "finalAccuracy", op: ">=", value: 0.995, label: "Final counts ≥ 99.5% accurate" },
        { metric: "latency", op: "<=", value: 10, label: "First result ≤ 10 s after the window ends" },
      ],
      hints: ["Processing-time windows put late events in the wrong minute - visible during the spike.", "Switch to event time.", "Keep the watermark short for freshness, and allow about 2 minutes of lateness so late events correct the counts."],
      solution: { mode: "event", latenessSec: 120 },
    },
  ],
};
