import { build } from "../presets";
import type { Lab } from "./types";

const servers = 6;
const ids = Array.from({ length: servers }, (_, i) => `api${i + 1}`);

export const rankedFeed: Lab = {
  slug: "ranked-feed",
  module: 15,
  title: "A ranked news feed",
  product: "Social",
  summary: "Fifty million people open their feed several times a day. Fan posts out on write, handle celebrities on read, count likes without hot rows, and keep the timeline cache balanced.",
  difficulty: "hard",
  minutes: 30,
  tags: ["fan-out", "hot keys", "counters", "ranking", "Kafka"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A social app with **50 million daily users**.

- The average user follows **200 accounts** and has **200 followers**. A few hundred accounts have **over 10 million** followers.
- Users publish about **3,000 posts/s** at peak and open their feed about **60,000 times/s**.
- The feed is **ranked**, not just newest-first: recent posts from close friends with lots of engagement go first.
- Likes, comments and views are shown as live-ish counts on every post.`,
    },
    {
      type: "quiz",
      title: "Fan out on write or on read?",
      body: "Option A (on write): when someone posts, push the post id into each follower's precomputed timeline. Option B (on read): when someone opens the feed, fetch recent posts from everyone they follow and merge.",
      question: "Which should be the default here?",
      options: [
        { text: "On read - nothing is precomputed, so nothing is wasted", why: "60,000 feed opens/s × 200 followed accounts = 12 million lookups/s, all on the latency-critical path. Reads outnumber posts 20:1, so do the work once at write time instead." },
        { text: "On write for normal accounts", correct: true, why: "Right. 3,000 posts/s × 200 followers = 600,000 timeline inserts/s - big, but asynchronous and cheap (append an id to a list). Opening a feed becomes one read of a precomputed list." },
        { text: "On write for everyone, including celebrities", why: "One post from a 30-million-follower account means 30 million inserts. Those queue behind each other and every other post waits." },
      ],
    },
    {
      type: "quiz",
      title: "The celebrity problem",
      body: "A pop star with 40 million followers posts. Their followers open the app within minutes.",
      question: "How do you include the post without a 40-million-row fan-out?",
      options: [
        { text: "Fan out anyway but in batches of 10,000", why: "Batching helps the workers, but it's still 40M writes per post, and the last batch lands many minutes late." },
        { text: "Hybrid: skip fan-out for accounts over a threshold; at read time merge in the recent posts of the few celebrities you follow", correct: true, why: "Right. A user follows a handful of big accounts; their recent posts are cached once and merged into the precomputed timeline at read time. Everyone else is still fanned out on write." },
        { text: "Rate-limit celebrities to one post per hour", why: "That's a product decision you don't get to make to fix a backend design." },
      ],
    },
    {
      type: "quiz",
      title: "Counting likes",
      body: "A post goes viral: 200,000 likes in a minute, all running `UPDATE posts SET likes = likes + 1 WHERE id = 42`.",
      question: "What happens, and what's better?",
      options: [
        { text: "Fine - databases handle increments", why: "Every increment takes the same row lock. One row serves a few hundred to a few thousand updates a second; the rest queue and time out, and the database stalls for everyone." },
        { text: "Record each like as an event; count in a stream processor or in sharded counters, and show a slightly stale total", correct: true, why: "Right. Store who liked what (for \"you liked this\") in a table keyed by (post, user); keep the count in N counter shards or aggregate the event stream every second. Nobody notices if 1,204,331 is a second old." },
        { text: "Count likes in the browser and send the total", why: "Clients can't be trusted with totals, and each only sees its own likes." },
      ],
    },
    {
      type: "quiz",
      title: "Where to rank",
      body: "Ranking uses the author's closeness to the reader, the post's age, and its likes and comments so far.",
      question: "When should posts be scored?",
      options: [
        { text: "Once, when the post is fanned out", why: "The score depends on engagement that keeps changing. A post scored at 0 likes would stay buried after it goes viral." },
        { text: "At read time: take the ~500 most recent candidate ids from the timeline, fetch fresh features, score them, return the top 50", correct: true, why: "Right. Fan-out keeps a cheap candidate list; ranking runs on fresh counters when the user actually looks. Cache the ranked page for a minute so pull-to-refresh doesn't recompute it." },
        { text: "Rank every post for every user in a nightly batch", why: "Feeds would be up to a day old, and most users never open most of those precomputed feeds." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: a celebrity in the fan-out log",
      body: "Fan-out jobs flow through a Kafka log with 16 partitions keyed by author; 16 fan-out workers each handle 2,500 jobs/s. The log carries 30,000 jobs/s. Tonight one star's posts are 10% of all fan-out work - all on one partition. Keep fan-out under 5 seconds behind.",
      sim: "kafka-log",
      params: { producerRps: 30000, partitions: 16, consumers: 16, perConsumerRps: 2500, hotKeyPct: 10 },
      locked: ["producerRps", "perConsumerRps", "hotKeyPct", "crash"],
      goals: [
        { metric: "maxLagAge", op: "<=", value: 5, label: "Never more than 5 s behind" },
        { metric: "finalLag", op: "<=", value: 1000, label: "Lag at the end ≤ 1,000" },
      ],
      hints: [
        "Partition 0 gets 3,000 jobs/s from one author plus its normal share - far more than one worker handles.",
        "Try more partitions and workers. The hot key still lands on one partition, so it doesn't help.",
        "A fan-out job for one author doesn't need strict ordering: key it by (author, follower-chunk) instead - salt the hot key.",
      ],
      solution: { saltHotKey: true },
    },
    {
      type: "sim",
      title: "Measure it: a balanced timeline cache",
      body: "Timelines live in a cache cluster of 20 nodes. Today keys are placed with hash(user) % N, so adding a node remaps almost everything - a cold cache. And popularity is skewed: the celebrity-post keys everyone merges at read time are very hot. Make adding one node move under 10% of keys, and keep the hottest node under 1.5× the average.",
      sim: "hash-ring",
      params: { nodes: 20, add: 1, keys: 20000, skew: 1.0 },
      locked: ["nodes", "add", "keys", "skew"],
      goals: [
        { metric: "moved", op: "<=", value: 0.1, label: "≤ 10% of keys move" },
        { metric: "imbalance", op: "<=", value: 1.5, label: "Hottest node ≤ 1.5× average" },
      ],
      hints: [
        "Switch to a consistent-hash ring: adding a node only takes keys from its neighbours.",
        "Give each node many virtual nodes (try 256) so the ring is evenly cut.",
        "The imbalance is now caused by a few hot keys, not placement. Split each hot key into sub-keys (salt it) - read them from any copy.",
      ],
      solution: { scheme: "ring", vnodes: 256, saltHot: true },
    },
    {
      type: "design",
      title: "Build it on the canvas: fan-out on write",
      body: "Peak: **60,000 feed reads/s** and **3,000 posts/s**. Serve feeds from a **timeline cache** (~90% hits), store posts in the database, and publish each post to a **Kafka topic** where a **fan-out consumer group** writes post ids into followers' timelines in the cache. Fan-out must keep up. Budget: **$2,000/month**.",
      starter: build({
        nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "m" }], ["api2", "server", { size: "m" }], ["api3", "server", { size: "m" }], ["api4", "server", { size: "m" }], ["db", "db", { size: "l" }]],
        wires: "client>lb, lb>api1, lb>api2, lb>api3, lb>api4, api1>db, api2>db, api3>db, api4>db",
      }),
      test: {
        traffic: { reads: 60_000, writes: 3_000, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 100 },
          { type: "uses", kind: "cache", why: "precomputed timelines" },
          { type: "uses", kind: "kafka", why: "fan-out happens asynchronously" },
          { type: "consumerLag", maxGrowth: 0 },
          { type: "budget", maxUsd: 2000 },
        ],
      },
      hints: [
        "Building every feed from the database means 60,000 reads/s on it. Add a cache and wire every server to it.",
        "63,000 req/s needs more than four 4 vCPU servers (9,000 each). Six 8 vCPU servers leave headroom.",
        "Add a Kafka topic (wire every server to it), a consumer group reading it, and wire the group to the cache: that's the fan-out. 3,000 events/s at ~1,000 per consumer: 6 partitions, 6 consumers.",
      ],
      solution: build({
        nodes: [
          ["client", "client"],
          ["lb", "lb", { healthChecks: true }],
          ...ids.map((id) => [id, "server", { size: "l" }] as [string, "server", { size: string }]),
          ["timelines", "cache", { hitRatio: 0.9 }],
          ["db", "db", { size: "l" }],
          ["posts", "kafka", { partitions: 6 }],
          ["fanout", "consumer", { consumers: 6 }],
        ],
        wires: ["client>lb", ...ids.map((id) => `lb>${id}, ${id}>timelines, ${id}>db, ${id}>posts`), "posts>fanout, fanout>timelines"].join(","),
      }),
    },
    {
      type: "quiz",
      title: "Showing the like count",
      body: "Every feed page shows like counts for 50 posts. That's 3 million count lookups a second at peak.",
      question: "Where should those counts come from?",
      options: [
        { text: "SELECT COUNT(*) FROM likes WHERE post_id = ? for each post", why: "Counting millions of rows per lookup, 3 million times a second - the database would melt." },
        { text: "A cached counter per post, updated by the like stream every second or so", correct: true, why: "Right. The stream aggregates likes and writes totals to the cache; the feed reads 50 counters in one batched call. Approximate and a second stale is exactly what users expect." },
        { text: "Leave counts off the feed", why: "Engagement counts are part of the product - and the ranking uses them anyway." },
      ],
    },
  ],
};
