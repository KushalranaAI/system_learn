import { build } from "../presets";
import type { Lab } from "./types";

export const videoPlatform: Lab = {
  slug: "video-platform",
  module: 7,
  title: "A video platform",
  product: "Video",
  summary: "Creators upload gigabytes, viewers stream terabits. Upload straight to object storage, transcode in the background, and let a CDN carry the bytes - even when a new episode drops.",
  difficulty: "medium",
  minutes: 30,
  tags: ["object storage", "transcoding", "CDN", "queues", "adaptive bitrate"],
  steps: [
    {
      type: "intro",
      title: "The product",
      body: `A video platform for creators.

- **30,000 uploads a day**, averaging **500 MB** each (a 10-minute 1080p video). Some are 20 GB.
- **2 million daily viewers**; up to **400,000 watching at once** in the evening, at about **5 Mbps** each.
- Viewers are on everything from fibre to a train's 3G; playback must start in under 2 seconds and not stall.
- A popular show releases a new episode every Friday at 8 pm.`,
    },
    {
      type: "quiz",
      title: "Where do the bytes live?",
      body: "15 TB of new uploads a day, plus several transcoded copies of each.",
      question: "Where should video files be stored?",
      options: [
        { text: "As BLOBs in Postgres, next to the video's metadata", why: "Databases are built for small rows and transactions. Terabytes of BLOBs bloat backups, replication and the buffer cache, and every byte streams through the database." },
        { text: "In object storage (S3-style); the database keeps metadata and object keys", correct: true, why: "Right. Object storage is cheap per GB, practically unlimited, durable (copies across zones) and serves byte ranges over HTTP. The database holds titles, owners, status and keys." },
        { text: "On the API servers' local disks", why: "A disk dies and the video is gone; and every request must find the one server that has the file." },
      ],
    },
    {
      type: "quiz",
      title: "Uploading 20 GB",
      body: "A creator uploads a 20 GB file over home Wi-Fi. It takes 40 minutes.",
      question: "How should the upload work?",
      options: [
        { text: "POST the file to the API server, which writes it to object storage", why: "Every upload ties up an API server and its bandwidth for 40 minutes, and a dropped connection at minute 39 starts over." },
        { text: "The API hands out a presigned URL; the app uploads directly to object storage in resumable parts", correct: true, why: "Right. Your servers only sign a short-lived URL. The app uploads 10-100 MB parts in parallel, retries failed parts, and resumes after a drop. Object storage absorbs the bandwidth." },
        { text: "Email the file to support", why: "No." },
      ],
    },
    {
      type: "quiz",
      title: "Transcoding",
      body: "Viewers need the video at 240p, 480p, 720p and 1080p, cut into 4-second segments so players can switch quality mid-stream. Transcoding a 10-minute video takes several CPU-minutes per rendition.",
      question: "How do you run transcoding?",
      options: [
        { text: "Inside the upload request, before returning", why: "The creator waits many minutes, and a timeout throws the work away." },
        { text: "Put a job on a queue when the upload completes; workers transcode each rendition (and chunk) in parallel and write segments back to object storage", correct: true, why: "Right. The upload returns at once with status 'processing'. Workers scale with the backlog, retry failed chunks, and the video goes live when all renditions are ready." },
        { text: "Transcode on the viewer's device", why: "Phones would download the 20 GB original and burn their batteries. Do it once, on your side." },
      ],
    },
    {
      type: "api",
      title: "The upload flow",
      body: "Design the creator endpoints: start an upload (returns a presigned URL), tell the platform the upload finished (starts transcoding), and check processing status.",
      baseUrl: "https://video.example",
      expect: [
        { goal: "Start an upload", methods: ["POST"], statuses: [201], why: "POST /videos creates the video record (status 'uploading') and returns 201 with its id and presigned part URLs." },
        { goal: "Mark the upload complete", methods: ["POST", "PUT"], statuses: [202], needsParam: true, why: "POST /videos/:id/complete. 202 Accepted: the transcoding happens later, asynchronously." },
        { goal: "Check processing status", methods: ["GET"], statuses: [200], needsParam: true, why: "GET /videos/:id returns status ('processing', 'ready') and, when ready, the playback manifest URL." },
      ],
    },
    {
      type: "quiz",
      title: "Serving 2 Tbps",
      body: "400,000 viewers × 5 Mbps = 2 terabits per second at peak.",
      question: "How do you deliver that?",
      options: [
        { text: "More origin servers in one region", why: "2 Tbps out of one region is enormously expensive, and viewers far away still buffer." },
        { text: "A CDN caches segments at the edge; the player picks a bitrate per segment (HLS/DASH)", correct: true, why: "Right. Popular segments are served from edges near viewers - a 95%+ hit ratio leaves the origin about 100 Gbps. Adaptive bitrate lets a viewer on 3G drop to 480p instead of stalling." },
        { text: "Peer-to-peer between viewers only", why: "Some platforms add P2P on top, but you can't rely on it for start-up time or for unpopular videos." },
      ],
    },
    {
      type: "sim",
      title: "Measure it: Friday, 8 pm",
      body: "The new episode is published and its segments aren't at the edges yet. Edges ask the origin shield for 50,000 segment requests/s over 2,000 hot segments; the shield's storage path can take 5,000 fetches/s. Then, mid-evening, an edge restarts empty. Keep the origin under its capacity and fail almost nothing.",
      sim: "cache-stampede",
      params: { rps: 50000, keys: 2000, ttlSec: 60, dbCapacity: 5000, coldRestart: true },
      locked: ["rps", "keys", "dbCapacity", "coldRestart"],
      goals: [
        { metric: "peak", op: "<=", value: 1, label: "Origin load ≤ its capacity" },
        { metric: "failedPct", op: "<=", value: 0.001, label: "≤ 0.1% of requests fail" },
      ],
      hints: [
        "Every edge request for a missing segment goes to the origin at once. CDNs call the fix request collapsing.",
        "Turn on coalescing so each missing segment is fetched once.",
        "Segments cached at the same moment expire at the same moment. Add TTL jitter (and serve stale while refreshing).",
      ],
      solution: { coalesce: true, staleWhileRevalidate: true, jitterPct: 20 },
    },
    {
      type: "design",
      title: "Build it on the canvas: watch pages and transcode jobs",
      body: "Peak: **40,000 reads/s** (watch pages, manifests, thumbnails) and **2,000 transcode jobs/s** (one per segment-rendition, after uploads complete). Serve cacheable reads from a **CDN**, and send jobs to a **queue** with enough **workers** that it never backs up; workers record finished segments in the database. Budget: **$1,000/month**.",
      starter: build({
        nodes: [["client", "client"], ["lb", "lb", { healthChecks: true }], ["api1", "server", { size: "m" }], ["api2", "server", { size: "m" }], ["db", "db", { size: "m" }]],
        wires: "client>lb, lb>api1, lb>api2, api1>db, api2>db",
      }),
      test: {
        traffic: { reads: 40_000, writes: 2_000, bots: 0 },
        constraints: [
          { type: "successRate", min: 0.99 },
          { type: "p99", maxMs: 80 },
          { type: "uses", kind: "cdn", why: "the bytes and pages go out from the edge" },
          { type: "uses", kind: "queue", why: "transcoding happens in the background" },
          { type: "backlog", max: 0 },
          { type: "budget", maxUsd: 1000 },
        ],
      },
      hints: [
        "Put a CDN in front of the load balancer (about 90% of these reads are cacheable).",
        "Add a queue and workers: wire each API server to the queue, the queue to the workers, and the workers to the database.",
        "One worker process handles about 400 jobs/s - 2,000 jobs/s needs at least 5, and the database needs room for the results.",
      ],
      solution: build({
        nodes: [
          ["client", "client"],
          ["cdn", "cdn", { hitRatio: 0.9 }],
          ["lb", "lb", { healthChecks: true }],
          ["api1", "server", { size: "m" }],
          ["api2", "server", { size: "m" }],
          ["jobs", "queue"],
          ["transcoders", "worker", { workers: 6 }],
          ["db", "db", { size: "l" }],
        ],
        wires: "client>cdn, cdn>lb, lb>api1, lb>api2, api1>db, api2>db, api1>jobs, api2>jobs, jobs>transcoders, transcoders>db",
      }),
    },
    {
      type: "quiz",
      title: "The storage bill",
      body: "After two years you store 20 PB. 90% of views go to videos uploaded in the last 30 days; most old videos are watched a few times a year.",
      question: "How do you cut the storage bill without breaking old videos?",
      options: [
        { text: "Delete videos older than a year", why: "Creators expect their videos to stay up - and the long tail still gets views." },
        { text: "Lifecycle rules: move old, rarely-watched renditions to an infrequent-access tier; keep fewer renditions for the cold tail", correct: true, why: "Right. Infrequent-access tiers cost a fraction per GB with a small retrieval fee - fine for videos watched a few times a year. Dropping unused 4K/1080p renditions of cold videos (re-transcode on demand) saves even more." },
        { text: "Compress the originals with zip", why: "Video is already compressed; zip saves almost nothing." },
      ],
    },
  ],
};
