# Open-source interactive system design lab: plan

> **Status (2026-10-24):** Phases 0–5 and 7 are built. All 19 modules are written (129 lessons), with
> 19 interactive labs and database sharding in the engine. That covers the engine,
> canvas, load, incidents and timeline, the lab runner with 3 labs, Module 1
> lessons, and presenter mode. The app is a single Vite package (not a pnpm
> workspace); `src/engine` stays UI-free. Next up: Phase 5 (more lessons),
> Phase 6 (more components) and Phase 8 (benchmarks). See README.md and
> docs/.

Goal: a local-first, open-source app for learning system design by building
architectures on a canvas and putting them under simulated load. It should be
easy to extend one module at a time, and good enough on screen to record
YouTube videos with.

This plan is based on reverse engineering sys0.in's public pages and JavaScript
(REA browser capture, evidence `ev_ed8db9d4…`, script export `ev_07b29741…`).
The research tells us **how this kind of product works**. The code, lesson text,
lab wording and branding we build must be our own (see "Ground rules").

---

## 1. What we learned from sys0.in

### Observed (read directly from the public bundles)

**Stack.** Next.js App Router built with Turbopack, Better Auth (`/api/auth/*`),
PostHog analytics proxied through `/ingest`, and Cloudflare Web Analytics. The
canvas is **hand-built SVG + pointer events** (`onPointerDown`,
`setPointerCapture`, wheel zoom). They don't use React Flow. The hand-drawn look
comes from the Excalifont font.

**The simulator runs entirely in the browser and is deterministic.** It isn't a
packet-level simulation. It's a **steady-state flow model**:

1. The client produces traffic in classes: `reads`, `writes`, `attack`
   (scraper) and `cached` (browser-cached 301s).
2. Traffic moves along the wired graph. Each node computes
   `load`, `util = load / capacity` and `served = min(load, capacity)`. Past
   100%, the excess is dropped.
3. Routing rules per node kind:
   - **rate limiter**: passes `legitPass` / `attackPass` fractions. The model
     depends on the key: global, per-path or per-IP. Per-IP uses a
     distribution of users per NAT'd IP, so strict limits hurt offices and
     mobile carriers.
   - **load balancer**: splits traffic evenly across wired servers. With health
     checks on, dead servers are skipped.
   - **API server**: capacity depends on machine size. Reads go to Redis first
     (if wired); hits are answered there and misses fall through to the DB.
     Writes go to the primary DB.
   - **Postgres**: `util = reads/readCap + writes/writeCap`. Replicas add read
     capacity but replay every write. Replication lag is
     `~30 / (1 − writeUtil)` ms, so fresh reads from a replica can 404.
   - **Redis**: the hit rate comes from cache-key quality (does the key include
     the slug? does it include the client IP?), the value cached, coalescing on
     a miss, write-through, and how warm the cache is.
4. **Latency per hop** uses an M/M/1-style p99 formula, capped at 2 s:
   `p99(hop) = serviceMs × ln(100) / (1 − min(util, 0.99))`.
   The request's p99 is the sum along the slowest path.
5. **The output** per run: `success`, `p99`, `limited`, `stale`, `lagMs`, a
   per-node `{load, util, down}` and per-edge flow, plus plain-English
   **issues** ("API server is at 112% – add more servers", "past ~85%, latency
   climbs steeply" …).
6. **Incident timeline** (`runTimeline`): 40 one-second ticks, with the failure
   at t=5 s. Failed requests are retried the next second (80% retry rate),
   failover promotes a replica after 20 s, and a cold cache refills at 60% per
   tick, limited by DB headroom. `summarize()` returns worst success, recovery
   time and SLO error-budget burn (99.9%).
7. **Wiring rules** (`wireRefusal`) are a whitelist of allowed edges
   (client→limiter/lb/server, limiter→lb/server, lb→server, server→db/redis),
   with a teaching message for every wrong wire.
8. **Cost model**: each node has a `$/month`, and server sizes run from
   2 to 32 vCPU. Capacity grows more slowly than cores do.
9. **`sampleRequest()`** draws individual fake requests (Zipf-distributed hot
   links, random IPs, bots). It's probably used to animate dots on the wires.
   That's an inference: the source shows the generator, not the renderer.

**Capacities are calibrated from their own benchmarks.** The source strings say
things like "measured 26.8k req/s on an M2 Pro (bench/), derated for cloud
vCPUs". We should run **our own** benchmarks (see Phase 8).

**Labs are pure data.** Each lab is `{slug, meta, steps[]}`. Step types:

| type     | what the learner does                                        | how it's checked |
|----------|--------------------------------------------------------------|------------------|
| `intro`  | reads functional/non-functional requirements                 | none             |
| `api`    | designs endpoints (method, path, params, body, status)        | rule checks with messages: `method`, `field`, `status`, `path` |
| `schema` | designs tables/fields for a chosen DB engine (Postgres/MySQL/Mongo/Cassandra/DynamoDB type lists) | rule checks |
| `design` | builds a graph from a `starter` graph                         | runs the simulator on `test.scenario` against `constraints`: `successRate ≥ x`, `p99 ≤ y ms`, `budget ≤ $z`, `recovery` |
| `choose` | multiple choice                                               | `correct`        |

Each step also has `topics[]`, progressive `hints[]`, and optional incidents
such as `down` (kill a node) and `cacheCold`. **No AI grading was seen**: all
checks are deterministic rules.

### Not seen (outside this research)

- Members-only lesson pages, and the lab UI after login.
- Five JS chunks larger than 64 KiB weren't kept by the capture. The canvas
  renderer and the request-dot animation are probably in them.
- The server side (payments, progress storage).

---

## 2. Ground rules for an open-source version

- **Write all code from scratch.** Use the *ideas* above (flow model, M/M/1
  latency, data-driven labs). Don't paste or port their minified code.
- **Write your own lessons, lab text, hints and issue messages.** Their wording
  is copyrighted content they sell.
- **Make the numbers your own:** take capacities from your own benchmarks, with
  the method documented in the repo.
- **Use your own name and branding.** Don't call it "sys0" or use their logo or
  design. Labs can model public products (like "a URL shortener") without using
  company logos.
- **License:** MIT for code, CC BY-SA 4.0 for lesson content.

---

## 3. Architecture

```
system-learn/                  (pnpm workspace, TypeScript everywhere)
├─ packages/
│  ├─ engine/      pure TS, zero UI deps: graph model, solver, timeline,
│  │               wiring rules, scoring, cost. 100% unit tested.
│  ├─ nodes/       node-type plugins (client, lb, server, redis, postgres, …)
│  ├─ labs/        lab definitions (JSON/TS) + JSON schema + validator
│  └─ ui/          shared React components (canvas, inspector, charts)
├─ apps/
│  └─ web/         Vite + React app (local-first, static deploy to GitHub Pages)
├─ content/        MDX lessons, with embeddable <Sim /> blocks
├─ bench/          docker-compose + k6 scripts that calibrate engine numbers
└─ docs/           architecture, "how to add a node type", "how to write a lab"
```

**Choices, and the reasons for them**

| Concern        | Pick                                | Reason |
|----------------|-------------------------------------|--------|
| App framework  | Vite + React 19 + TS                | Local-first with no server needed; deploys free as a static site. |
| Canvas         | **@xyflow/react (React Flow)**      | Pan, zoom, drag and handles come built in, which saves weeks. Custom node and edge components keep the look your own. |
| Auto layout    | elkjs                               | Gives the "Auto layout" button. |
| State          | Zustand + Immer                     | Graph state with undo/redo. |
| Charts         | uPlot (or Recharts)                 | Fast timeline charts for incidents. |
| Lessons        | MDX                                 | Prose with live simulator widgets embedded. |
| Progress       | localStorage, plus export/import JSON | No accounts needed. |
| Share a design | graph JSON compressed in the URL hash (lz-string) | "Here's my design" links for viewers. |
| Tests          | Vitest (engine), Playwright (UI)    | |
| Look           | Dark board, dotted grid, a hand-drawn font (e.g. Virgil/Excalifont, both OFL) | Reads well on video. |

### Engine design (the core, and better than a hard-coded switch)

Each node type is a **plugin**, so new modules only add files:

```ts
interface NodeType<C = unknown> {
  kind: string;                       // "server", "redis", "kafka", …
  label: string;
  defaults: C;                        // e.g. { size: "2vcpu" }
  capacity(cfg: C): Record<FlowClass, number>; // ops/s per class
  serviceMs(cfg: C): number;
  monthlyUsd(cfg: C): number;
  canSendTo: string[];                // wiring whitelist
  route(ctx: RouteCtx<C>): RouteResult; // split incoming flow to out-edges,
                                        // decide served/dropped/cached/etc.
  diagnose?(state: NodeState, cfg: C): Issue[];  // teaching messages
}

type FlowClass = "read" | "write" | "attack" | "async";
```

The solver works like this:
1. Topologically order the graph (reject cycles, except async loops such as
   queue → worker).
2. Push `offered` flow from the client through each node's `route()`.
3. Compute `util`, `served` and `dropped` per node, and the p99 per hop with
   `p99 = s·ln(100)/(1−ρ)`, capped at 2000 ms.
4. Combine: success = served legit traffic ÷ offered legit traffic; the
   end-to-end p99 is the slowest path that carries more than 1% of traffic.
5. Collect issues, then sort them by severity.

The timeline runner calls the solver once per tick and applies incidents (node
down, traffic spike, cache flush, network partition, region outage) and
feedback (retries, failover delay, cache warm-up, autoscaling delay).

**A "live" mode for video:** the steady-state numbers drive a particle animation
in which dot density equals throughput, red dots are drops, and amber dots are
slow requests. Dots are sampled with a seeded RNG so every recording is
identical.

Later, as an optional extra: a **discrete-event mode** (an event queue sending
individual requests) for lessons where order matters, such as Kafka
partitions, leader election and consistent hashing. It's slower, but more
honest for algorithm demos (module 26).

---

## 4. Roadmap

Each phase ends with something you can demo, and maybe film.

**Phase 0: Repo setup (1–2 days)**
pnpm workspace, TS strict mode, ESLint, Vitest, GitHub Actions CI, MIT and
CC BY-SA licenses, README, CONTRIBUTING.

**Phase 1: Engine v0 (1 week)**
Client → server → Postgres. Capacity, drops, M/M/1 p99, cost and issues. Add a
CLI that takes `pnpm sim scenario.json` and prints a result table. Write unit
tests for every formula.
*Video: "Why latency explodes at 85% CPU", with the formula plotted.*

**Phase 2: Canvas (1–2 weeks)**
React Flow board, a node palette, drag-to-wire with refusal messages, a node
inspector (machine size, cache key, limits), live metric badges on nodes, an
issues panel, auto layout, undo/redo, and save/load/share via URL.

**Phase 3: Load and incidents (1 week)**
Sliders for read rps, write rps and bot traffic. A 40-second timeline with an
incident picker, success/p99 charts, recovery time and SLO budget burn. Add
load balancer health checks, replicas and failover.
*Video: "Killing my database live: failover in 20 seconds".*

**Phase 4: Lab runner + first lab (1–2 weeks)**
A lab JSON schema and validator, plus step types `intro`, `api`, `schema`,
`design` and `choose`. Add constraint checks, progressive hints and progress
saved in localStorage. Lab #1 is a **URL shortener**, written by you: an API,
a schema, then steps that scale from 500 to 50k rps with a cache and a rate
limiter.

**Phase 5: Lessons (ongoing)**
MDX pages with embedded `<Sim preset="…"/>` mini-boards. Follow the usual
progression found in public curricula: requirements → single server → caching
→ horizontal scaling → DB replicas → realtime → queues → rate limiting →
partitioning → microservices → distributed-systems problems → Kafka → sagas →
streams → multi-region → algorithms.

**Phase 6: More node types (one per release)**
CDN, object storage, message queue + workers, Kafka (partitions, consumer
lag), WebSocket gateway, search index, sharded DB (hash/range, hot keys),
service mesh, multi-region with latency between regions. Each is one plugin
file plus tests plus a lab.

**Phase 7: Presenter mode for YouTube (1 week)**
Large font, hidden UI, keyboard-driven "scenes" (a scripted sequence of graph
edits and traffic changes), seeded particles, 1080p/4K canvas sizes, and PNG
or WebM export of the board. Record with OBS.

**Phase 8: Calibration benchmarks (1 week, and good content)**
`bench/` has a docker-compose stack: a Go or Node API, Postgres, Redis and
nginx. k6 scripts measure req/s at a target p99 for each machine size. Results
go into `packages/nodes/*/calibration.json`, with the hardware and method
written down. This is your own data, and great "I benchmarked it" videos.

**Phase 9: Community**
"Write a lab" guide, a lab JSON schema with editor autocomplete, a gallery of
shared designs, and good-first-issue node types.

---

## 5. First week checklist

- [ ] Pick a project name and check that it's free on GitHub and npm.
- [ ] Scaffold the pnpm workspace with `packages/engine` and `apps/web`.
- [ ] Implement `solve(graph, scenario)` for client/server/db, with tests.
- [ ] Implement the p99 formula and plot it (first video).
- [ ] Get a React Flow board rendering a hard-coded graph with live util badges.
