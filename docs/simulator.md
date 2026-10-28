# How the simulator works

The engine (`src/engine/`) is plain TypeScript with no UI dependencies, so it's easy to test and to reuse.

## Model

It's a **steady-state flow model**, not a packet-level simulation. That keeps it instant, deterministic, and
explainable on screen.

1. The client emits traffic in classes: `read`, `write` and `bot`. Queues add a fourth, `job`.
2. Traffic moves along wires in topological order as *bundles*: a class, a rate, and the latency accumulated so far.
3. Each component:
   - computes **utilisation** = load ÷ capacity. Databases use `reads/readCap + writes/writeCap`, and replicas also
     replay the primary's writes.
   - **serves** `min(load, capacity)` and **drops** the rest as failures;
   - adds its **p99 queueing delay**: `serviceMs × ln(100) / (1 − utilisation)`, capped at 2 s. This is the
     99th-percentile time in an M/M/1 queue, which is why latency explodes past ~85%;
   - either **completes** a bundle (CDN hit, cache hit, database answer, queue ack) or **routes** it on.
4. The run's p99 is the latency below which 99% of successful traffic finishes.
5. The solver runs twice. The second pass uses first-pass utilisations for the two places that depend on
   downstream state: cache-miss latency, and replication load on replicas.

### Component rules

| Component | Rule |
|-----------|------|
| CDN | Answers `hitRatio` of reads at the edge; writes and bot traffic pass through |
| Rate limiter | Per-IP limit. Bots come from 4 IPs; 3% of real users share busy NAT IPs (~40 req/s); others send ~2 req/s |
| Load balancer | Splits evenly; with health checks, skips dead servers |
| API server | Reads hit the cache first (bots always miss); misses go to databases. Writes go to the queue if wired, else the primary |
| Cache | Hit ratio × warmth (0 after a restart) |
| Database | Primary takes writes; replicas add read capacity but replay every write; lag grows with primary write load. **Shards** multiply read *and* write capacity (85% efficiency per shard) and cost |
| Queue | Acks writes instantly; forwards jobs to workers |
| Workers | `workers × workerCap` jobs/s; the excess becomes backlog, not failures |
| Kafka topic | Accepts `partitions × 10k` events/s; every write a server makes is published as an event; each consumer group gets the full stream |
| Consumer group | Per-partition capacity = consumerCap × min(1, consumers ÷ partitions); a hot key concentrates traffic on one partition; what isn't processed becomes lag (tracked over the timeline) |
| Saga orchestrator | Orders become `steps` database writes; the share of orders left inconsistent follows the failure model in `engine/saga.ts` and drops to zero with all five safeguards |
| LLM inference | Self-hosted model on GPUs. Capacity = `LLM_MODELS[model].cap × replicas` requests/s (×0.15 without continuous batching); cost is per replica (the GPUs one copy needs). Its latency is time to first token, ×1.3 with batching. When an API server has an LLM or agent wired, its reads (prompts) go cache (semantic cache) → vector DB → model instead of the database; writes still go to the database |
| Vector database | `replicas × 2,000` ANN queries/s or `× 1,000` upserts/s. API servers query it once per prompt; agents once per step; workers and consumers upsert embeddings into it |
| Agent runtime | Each task makes `agentSteps` model calls (and vector lookups if wired); latency adds up per step. Without the step limit, 4% of tasks loop to 30 steps |

### Timeline (`timeline.ts`)

60 one-second ticks with the incident at t=10 s.
- **Retries:** 70% of failed requests come back the next second.
- **Failover:** a replica is promoted 15 s after the primary dies.
- **Cache warm-up:** a cold cache warms by 20%/s × DB headroom.
- **Backlog:** accumulates and drains at worker capacity.

`summarize()` reports the worst second, recovery time, failed requests and share of a 99.9% monthly error budget used.

## The guide (`engine/explain.ts`)

`explainDesign` turns a result into a headline, the request paths in words, advice cards (problem → why → what to try →
trade-off, often with a one-click action), and "what if" checks that re-run the simulation (traffic doubles, cache
restarts, a server dies, the primary dies). `explainTimeline` narrates an incident run, and `describeTest` describes a
lab test before it runs. Every simulation has a matching explanation in `sims/explain.ts`.

When the learner has added an AI key (`src/ai/`), `ai/context.ts` packs the same numbers (components, load, busy %,
issues, timeline, and the built-in analysis) into compact JSON, and `useAiExplanation` asks the chosen provider for a
structured guide (headline, what happened, problems with why/fix/trade-off, next step). Calls are debounced and cached
by content. On any error the built-in guide is shown, and one-click fixes always come from the rule engine.

## Capacity profiles: reference vs measured

The simulator reads capacities from the **active capacity profile** (`catalog.ts`):

| Profile | Where it comes from | Used by |
|---------|---------------------|---------|
| **Reference** | Round, cloud-like teaching numbers in `catalog.ts` | All lab checks (so every lab is solvable on any machine), and the sandbox by default |
| **Measured** | `npm run bench` on your computer → `src/state/calibration/measured.json` (git-ignored) | The sandbox, when you pick "Measured on my machine" |

### What `npm run bench` does

All servers really run on `127.0.0.1`, and load comes from worker threads on the same machine:

| Component | Real workload | Becomes |
|-----------|---------------|---------|
| API server | Node HTTP server returning a ~1 KB JSON object; 1, 2, 4 (and 8) processes | `cap(v) = rps(1) · v / (1 + α(v − 1))`, α fitted from the runs |
| Database reads | SQLite (WAL) behind HTTP, indexed point lookups; 1, 2, 4 reader processes | Same fit → `readCap` per machine size |
| Database writes | Durable single-row commits (`synchronous=FULL`), 4 processes | `writeCap = measured × √(v/4)` (group-commit scaling is **extrapolated**: SQLite has one writer) |
| Cache | Single-threaded TCP key-value server (like one Redis node) | `cacheCap` |
| Worker | SHA-256 of 1 MB + deflate of 64 KB, one process | `workerCap` (jobs/s) |
| Disk | 4 KB write + fsync, 200 times | shown as info (commit latency) |

Caveats: loopback has no real network latency, and the load generator competes with the servers for the same CPUs, so
results vary between runs. The raw numbers, the fitted α and the method are stored with the profile and shown on the
**My machine** page.

## Simulations (`src/sims/`)

Beyond the canvas, 37 focused simulations implement the algorithms for real (seeded RNG, so runs are reproducible):

| Simulation | Model |
|------------|-------|
| `push-vs-poll` | Request load vs open connections; sampled delivery delay |
| `service-chain` | Monte Carlo over 20k requests; lognormal latencies, failures, timeouts, fallbacks, async side effects |
| `retry-storm` | 1 s ticks; server queue, M/M/1-style delay, client timeouts, retries with backoff/jitter/budgets, circuit breaker |
| `quorum` | 20k trials of N/W/R leaderless reads and writes with replication lag and failed nodes |
| `hash-ring` | Real modulo / ring (virtual nodes) / rendezvous placement of 20k keys; Zipf popularity; hot-key salting |
| `kafka-log` | Partition inflow, consumer ownership, backlog-proportional consumption, eager vs cooperative rebalance |
| `saga` | 5k orders through stock, payment (ambiguous timeouts), commit/publish crash and duplicate delivery |
| `event-windows` | Event time vs processing time, watermarks, allowed lateness, late-arrival distribution |
| `bloom`, `hyperloglog`, `count-min`, `merkle`, `skip-list` | Real data structures measured on real data |
| `gossip`, `raft` | Round-based epidemic spread; event-driven Raft elections with timers and message delays |
| `token-bucket` | Per-client buckets with lazy refill, bursty vs abusive clients |
| `lsm-btree` | B-tree with an LRU buffer pool vs an LSM with flushes, leveled compaction and optional Bloom filters |
| `geohash` | Real geohash encoding; scan vs cell vs cell + neighbours, recall vs work |
| `snowflake` | Per-ms ID generation, sequence exhaustion, random worker-id collisions, clock rollback |
| `wal` | fsync per commit vs group commit vs async; uses your measured fsync time if available |
| `cache-stampede` | 100 ms ticks; synchronized TTL expiry, jitter, coalescing, stale-while-revalidate, cold restart |
| `payload-formats` | Real records encoded byte for byte as JSON, short-key JSON, MessagePack and Protobuf (varints, tags, zigzag) |
| `fetch-patterns` | Round trips, bytes and DB queries for one screen: chatty REST, `?include=`, GraphQL with/without DataLoader, a BFF |
| `pagination` | A live newest-first feed in a Fenwick tree; offset vs cursor paging with inserts and deletes; rows walked per page |
| `idempotent-retries` | 20k payments over lossy request/response legs; no key, key per attempt, key per intent, TTL and atomic save |
| `token-lifetime` | Refresh and introspection load vs revocation lag (5k sampled revocations) for JWT, JWT + denylist, opaque tokens |
| `debounce` | 600 typing sessions with lognormal keystroke gaps; every-key / debounce / throttle, out-of-order replies |
| `latency-budget` | RTT from distance, handshake round trips per protocol, edge termination, TCP slow start, server work |
| `chunked-upload` | 400 uploads over a link with Poisson connection drops; single PUT vs resumable chunks with parallelism |

The last eight belong to Part 3 (API design); their explanations live in `sims/api-explain.ts`.

Each simulation exports `run(params)`, `metrics(result)` and a view. Lab steps of type `sim` declare goals over the
metrics; `src/labs/labs.test.ts` checks each step's solution meets them and the starting parameters don't.

## Adding a component

1. Add the kind to `NodeKind` in `types.ts` and its spec to `KINDS` in `catalog.ts` (label, icon, colour, service
   time, capacity, cost, defaults).
2. Add wiring rules in `wiring.ts` (`CAN_SEND_TO`, plus a teaching message for wrong wires).
3. Add a `case` in `solve.ts` that completes or routes its bundles, plus any issues it should explain.
4. Add inspector controls in `src/workspace/Inspector.tsx` and a subtitle in `NodeCard.tsx`.
5. Add a test in `engine.test.ts` showing the behaviour it teaches.
