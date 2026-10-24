# Curriculum

Four parts and thirty modules. Each module starts with a problem a growing
app runs into, teaches the idea that solves it, and ends with a hands-on lab.

Each lesson below lists **Learn**, the ideas it teaches, and **Try**, the
hands-on exercise (on the simulator canvas or on paper).

---

## Part 1 – Foundations

### Module 1 – What is system design?
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 1.1 | What system design is | Components, connections, and the decisions between them; design vs. coding | Draw the boxes behind an app you use daily |
| 1.2 | The design process | Clarify → estimate → sketch → deep dive → review; iterate | Run the process on "build a to-do app" |
| 1.3 | Functional vs non-functional requirements | Features vs qualities (latency, availability, durability, cost); how to ask for them | Turn a vague request into a requirements list |
| 1.4 | Back-of-the-envelope estimation | QPS, storage and bandwidth math; latency numbers worth memorising | Estimate traffic and storage for a photo app |
| 1.5 | Everything is a tradeoff | Consistency vs latency, cost vs headroom, simple vs flexible; writing down a decision | Compare two designs and write an ADR |
| 1.6 | Lab: a gym class booking system | Interview a stakeholder, write requirements, sketch v1 | Design it end-to-end on paper |

### Module 2 – Start with a simple system
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 2.1 | Anatomy of a request | DNS, TCP, TLS, HTTP; where the milliseconds go | Trace a request with browser dev tools |
| 2.2 | Designing an HTTP API | Resources, methods, status codes, request/response bodies | Design the API for a notes app |
| 2.3 | API details that bite later | Pagination (offset vs cursor), filtering, versioning, idempotency keys | Fix a broken pagination design |
| 2.4 | Modelling data | Entities, primary/foreign keys, one-to-many, many-to-many, normalisation | Model courses, lessons and enrolments |
| 2.5 | Indexes | B-tree indexes, composite indexes, reading a query plan, write cost of indexes | Add the right index to a slow query |
| 2.6 | Choosing a database | Relational, document, key-value, wide-column; access patterns first | Pick a store for three workloads |
| 2.7 | Measuring speed | Throughput vs latency, p50/p95/p99, latency budgets | Build a latency budget for one endpoint |
| 2.8 | Lab: a pastebin | API + schema + one server + one DB at 200 req/s | Build and load-test it |

### Module 3 – Caching
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 3.1 | Why cache | Read-heavy workloads, hit ratio, how hits change DB load | Calculate DB load at 0%, 80% and 95% hit ratio |
| 3.2 | Where caches live | Browser, CDN, reverse proxy, in-process, Redis, DB buffer pool | Place caches on a diagram |
| 3.3 | Cache patterns | Cache-aside, read-through, write-through, write-behind | Pick a pattern per use case |
| 3.4 | Keys, TTLs and eviction | Key design, TTL choice, LRU vs LFU, memory sizing | Size a Redis instance |
| 3.5 | Stale data and invalidation | Delete vs update on write, race conditions, versioned keys | Find the stale-read bug |
| 3.6 | Stampedes and hot keys | Thundering herd, request coalescing, jittered TTLs, local hot-key caches | Survive a cold cache |
| 3.7 | HTTP caching and CDNs | Cache-Control, ETag, 301 vs 302, edge caching | Cache a product page at the edge |
| 3.8 | Lab: a fast product catalogue | 20k reads/s on one database | Add a cache until p99 < 100 ms |

### Module 4 – When one server isn't enough
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 4.1 | Why busy servers get slow | Utilisation, queueing, why latency explodes past ~80% | Plot latency vs utilisation |
| 4.2 | Scaling up | Bigger machines, diminishing returns, the ceiling | Find the cheapest size that holds the load |
| 4.3 | Scaling out | Stateless servers, where state goes instead | Make a stateful server stateless |
| 4.4 | Load balancers | L4 vs L7, round robin, least connections, consistent hashing | Pick an algorithm for long-lived requests |
| 4.5 | Health checks and timeouts | Active/passive checks, connection draining, graceful shutdown | Kill a server without dropping requests |
| 4.6 | Sessions | Sticky sessions vs shared session store vs tokens | Move sessions to Redis |
| 4.7 | Autoscaling | Metrics to scale on, warm-up time, scaling limits | Tune an autoscaling policy for a spike |
| 4.8 | Lab: the dinner rush | 2k → 30k req/s for a food-ordering app | Scale without breaking the budget |

### Module 5 – When one database isn't enough
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 5.1 | Finding the DB bottleneck | CPU, IO, locks, connections, slow queries | Read a DB dashboard |
| 5.2 | Connection pooling | Why connections are expensive, pool sizing, PgBouncer | Fix "too many connections" |
| 5.3 | Read replicas | Async replication, replication lag, read-your-writes | Route reads to replicas safely |
| 5.4 | Failover | Detecting a dead primary, promotion, split brain | Survive a primary crash |
| 5.5 | Backups and recovery | Full + incremental backups, point-in-time recovery, RPO/RTO | Choose a backup plan for an RPO of 5 min |
| 5.6 | Make the DB do less | Query tuning, denormalisation, materialised views | Cut DB load in half without new hardware |
| 5.7 | Lab: a growing blog platform | Read-heavy traffic, one big write path | Add replicas and failover |

### Module 6 – Live updates
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 6.1 | Push vs pull | Short polling, long polling, server-sent events, WebSockets | Pick one for chat, scores and notifications |
| 6.2 | Holding many connections | Memory per connection, file descriptors, connection limits | Size a WebSocket fleet |
| 6.3 | Many servers, one message | Fan-out through pub/sub (Redis, NATS) | Deliver a message to users on other servers |
| 6.4 | Presence | Heartbeats, timeouts, "last seen" | Build "who's online" |
| 6.5 | Reconnects and missed messages | Sequence numbers, resume tokens, catch-up queries | Recover after a network blip |
| 6.6 | Lab: live match scores | 1M viewers, updates every few seconds | Design the push pipeline |

### Module 7 – Background jobs
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 7.1 | Not everything must happen now | Sync vs async work, user-facing latency | Move slow work out of the request |
| 7.2 | Queues and workers | Producers, consumers, visibility timeout, ack | Build an image-resize pipeline |
| 7.3 | At-least-once and idempotency | Why jobs run twice, idempotency keys, dedup tables | Make "send email" safe to repeat |
| 7.4 | Retries and dead letters | Exponential backoff, jitter, poison messages, DLQs | Stop one bad job from blocking the queue |
| 7.5 | Scheduled and long jobs | Cron at scale, leases, checkpoints | Run a nightly job on many servers exactly once |
| 7.6 | Backpressure | Queue depth, worker autoscaling, shedding load | Keep up with a 10x burst |
| 7.7 | Lab: video upload processing | Upload → transcode → thumbnail → notify | Design the pipeline |

### Module 8 – Rate limiting
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 8.1 | Why limit | Abuse, fairness, cost protection, 429 and Retry-After | Write a limit policy for a public API |
| 8.2 | Algorithms | Fixed window, sliding log, sliding window counter, token bucket, leaky bucket | Compare their burst behaviour |
| 8.3 | What to count by | User, API key, IP (and NAT pitfalls), route | Find who a per-IP limit hurts |
| 8.4 | Limits across many servers | Central counters in Redis, atomic scripts, local + global limits | Keep one limit across 20 servers |
| 8.5 | Lab: stop a scraper | Bot traffic at 10x real traffic | Block the bot, keep real users |

### Module 9 – Growing big
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 9.1 | Data that keeps growing | Hot vs cold data, archiving, storage tiers | Plan five years of growth |
| 9.2 | Table partitioning | Range/list/hash partitions inside one DB | Partition an orders table by month |
| 9.3 | Sharding | Hash, range and directory-based sharding | Choose a shard key |
| 9.4 | Living with shards | Cross-shard queries, resharding, hot shards | Reshard without downtime |
| 9.5 | Serving many regions | CDNs, regional read copies, latency by geography | Cut latency for users far away |
| 9.6 | Lab: a ride-hailing trip history | Billions of rows, many cities | Design storage that keeps up |

### Module 10 – Putting it together
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 10.1 | A framework for any design | Requirements → estimates → API → data → high level → deep dives → bottlenecks | Use it on a fresh problem |
| 10.2 | Explaining your design | Talking through tradeoffs, drawing clearly, handling "what if" | Record a 10-minute walkthrough |
| 10.3 | Common mistakes | Over-engineering, ignoring writes, missing failure modes | Review a flawed design |
| 10.4 | Capstone lab | A whole system from a blank page | Design, load-test, present |

---

## Part 2 – Distributed systems

### Module 11 – Microservices
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 11.1 | Monolith first | When splitting helps and when it hurts | Decide whether to split |
| 11.2 | Drawing boundaries | Bounded contexts, data ownership, one DB per service | Split an e-commerce monolith |
| 11.3 | How services talk | REST, gRPC, async events; sync call chains and their latency | Replace a 5-hop chain |
| 11.4 | Gateways and discovery | API gateway, service registry, client vs server-side discovery | Add a gateway |
| 11.5 | Seeing across services | Logs, metrics, distributed tracing, correlation IDs | Find the slow service in a trace |
| 11.6 | Lab: split the shop | Monolith → services | Draw the boundaries and the calls |

### Module 12 – Problems in distributed systems
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 12.1 | The network is not reliable | Partial failure, the fallacies of distributed computing | List what can fail in one call |
| 12.2 | Timeouts and retries | Choosing timeouts, retry storms, backoff with jitter, retry budgets | Stop a retry storm |
| 12.3 | Circuit breakers and bulkheads | Failing fast, isolating resources | Keep one slow dependency from taking you down |
| 12.4 | Idempotency everywhere | Idempotency keys, exactly-once is a myth | Make a payment call safe to retry |
| 12.5 | Clocks | Clock skew, NTP, Lamport clocks, vector clocks | Order events from three machines |
| 12.6 | Unique IDs | UUIDs, Snowflake-style IDs, ordering vs randomness | Generate IDs on 100 servers |
| 12.7 | Distributed locks | Leases, fencing tokens, why Redis locks need care | Find the double-write bug |
| 12.8 | Counters at scale | Sharded counters, approximate counts | Count likes on a viral post |

### Module 13 – Replication in depth
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 13.1 | Why replicate | Availability, read scale, latency | Pick goals for replication |
| 13.2 | Single-leader | Sync vs async vs semi-sync, lag | Choose a mode for a bank ledger |
| 13.3 | Leader election | Heartbeats, terms, Raft at a high level | Walk through an election |
| 13.4 | Multi-leader | Multi-region writes, write conflicts | Spot conflicts in a shared doc |
| 13.5 | Leaderless and quorums | N, R, W; sloppy quorums, read repair | Pick R and W for N = 3 |
| 13.6 | Consistency models | Linearisable, sequential, causal, eventual; CAP and PACELC | Classify five systems |
| 13.7 | Resolving conflicts | Last-write-wins, version vectors, CRDTs | Merge two offline edits |

### Module 14 – Partitioning in depth
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 14.1 | Key-range vs hash partitioning | Range scans vs even spread | Partition time-series data |
| 14.2 | Consistent hashing | The ring, virtual nodes, minimal movement | Add a node and count moved keys |
| 14.3 | Hot spots | Celebrity keys, key salting, splitting | Fix a hot partition |
| 14.4 | Secondary indexes | Local vs global indexes, scatter-gather | Query by a non-key field |
| 14.5 | Rebalancing and routing | Fixed partitions, dynamic splits, routing tiers | Rebalance a growing cluster |
| 14.6 | Lab: a key-value store | Partition + replicate | Design the cluster layout |

### Module 15 – Messaging: Kafka and pub/sub
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 15.1 | Queue vs log | Delete-on-consume vs retained log, replay | Pick one for three use cases |
| 15.2 | Topics, partitions, offsets | How Kafka stores and orders data | Choose a partition key |
| 15.3 | Consumer groups | Parallelism, rebalances, lag | Size a consumer group |
| 15.4 | Delivery guarantees | At-most-once, at-least-once, effectively-once | Avoid double-processing |
| 15.5 | Fan-out patterns | Pub/sub, fan-out on write vs read | Design a notification fan-out |
| 15.6 | Lab: an order events backbone | Many services reacting to orders | Design topics and consumers |

### Module 16 – Transactions across services
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 16.1 | ACID recap | Isolation levels and the anomalies they allow | Find the lost update |
| 16.2 | Two-phase commit | How it works and why it blocks | Walk through a coordinator crash |
| 16.3 | Sagas | Choreography vs orchestration, compensating actions | Design an order saga |
| 16.4 | The outbox pattern | Writing data and events atomically, CDC relays | Fix "saved but event lost" |
| 16.5 | Lab: place an order | Inventory, payment, shipping | Keep them consistent under failure |

### Module 17 – Events and streams
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 17.1 | Event sourcing | Events as the source of truth, rebuilding state | Model a bank account as events |
| 17.2 | CQRS | Separate write and read models | Build a read model for search |
| 17.3 | Change data capture | Streaming DB changes out | Keep a search index in sync |
| 17.4 | Stream processing | Windows, watermarks, late events, state | Count clicks per minute |
| 17.5 | Batch vs stream | When each fits; combining both | Choose for a daily report vs live dashboard |
| 17.6 | Lab: live analytics | Clicks → dashboard in seconds | Design the stream pipeline |

### Module 18 – Availability and going global
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 18.1 | SLIs, SLOs, SLAs | Choosing what to measure, error budgets | Write an SLO for an API |
| 18.2 | The cost of nines | Downtime per nine, availability of chained/parallel parts | Compute the availability of a design |
| 18.3 | Redundancy | Zones, regions, removing single points of failure | Find the SPOFs |
| 18.4 | Multi-region | Active-passive vs active-active, data residency | Pick a model for a global app |
| 18.5 | Traffic failover | DNS, anycast, global load balancers | Fail over a region |
| 18.6 | Testing failure | Game days, chaos experiments | Plan a chaos test |
| 18.7 | Lab: go global | Users on three continents | Design for 99.99% |

---

## Part 3 – Under the hood

### Module 19 – Classic algorithms in action
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 19.1 | Consistent and rendezvous hashing | Spreading keys with minimal movement | Simulate adding/removing nodes |
| 19.2 | Bloom filters | Fast "definitely not" checks, false-positive rate | Tune size vs error rate |
| 19.3 | Count-min sketch | Approximate frequency counts | Find heavy hitters |
| 19.4 | HyperLogLog | Counting unique items in tiny memory | Count unique visitors |
| 19.5 | Merkle trees | Detecting differences between replicas | Sync two replicas |
| 19.6 | Gossip protocols | Spreading state without a centre | Watch a rumour spread |
| 19.7 | Raft | Elections and log replication | Break a leader, watch recovery |
| 19.8 | LSM trees vs B-trees | Write- vs read-optimised storage engines | Compare write amplification |
| 19.9 | Geohash and quadtrees | Finding nearby things | Find drivers near a rider |
| 19.10 | Rate limiter algorithms | Token bucket internals | Simulate bursts |
| 19.11 | Snowflake IDs | Time-ordered unique IDs | Decode an ID |
| 19.12 | Skip lists | Sorted sets (Redis ZSET) | Build a leaderboard |
| 19.13 | Write-ahead logs | Durability and crash recovery | Recover after a crash |

### Module 20 – Networking under the hood
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 20.1 | DNS in depth | Resolvers, the root/TLD/authoritative chain, TTLs, negative caching, why DNS outages are global | Trace a lookup and pick TTLs for a failover record |
| 20.2 | TCP and congestion control | Handshakes, windows, slow start, Cubic vs BBR, head-of-line blocking | Explain why the first request on a new connection is slow |
| 20.3 | TLS and certificates | The TLS 1.3 handshake, session resumption, certificate chains, expiry outages | Plan certificate rotation for 500 domains |
| 20.4 | HTTP/2, HTTP/3 and QUIC | Multiplexing, header compression, QUIC over UDP, connection migration | Choose a protocol for a mobile app |
| 20.5 | BGP and anycast | Autonomous systems, route announcements, anycast for CDNs and DNS, route leaks | Explain how one BGP change took Facebook offline |
| 20.6 | Inside a load balancer | L4 vs L7 internals, Maglev-style consistent hashing, connection tracking, draining | Design a load balancer tier for 10M connections |

### Module 21 – Database internals
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 21.1 | How a query runs | Parser, planner, cost model, executor, statistics, plan caching | Read an EXPLAIN plan and spot the mistake |
| 21.2 | MVCC and isolation under the hood | Row versions, snapshots, visibility rules, write skew | Show why two doctors both went off call |
| 21.3 | Locks, latches and deadlocks | Row and table locks, lock queues, deadlock detection, lock timeouts | Untangle a deadlock from a log |
| 21.4 | Replication internals | WAL shipping, logical replication, binlogs, replication slots | Pick a replication method for a zero-downtime migration |
| 21.5 | Vacuum, compaction and bloat | Dead tuples, autovacuum, transaction ID wraparound, LSM compaction | Diagnose a table that keeps growing |
| 21.6 | Inside distributed SQL | Ranges, Raft per range, TrueTime and hybrid clocks, distributed transactions | Follow a write through Spanner or CockroachDB |

### Module 22 – Storage, search and data at scale
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 22.1 | Object storage | How S3-style stores reach 11 nines: erasure coding, metadata, consistency | Estimate storage overhead of 3× replication vs 8+4 erasure coding |
| 22.2 | Inverted indexes and search ranking | Tokenising, posting lists, BM25, sharding a search index | Index three documents by hand |
| 22.3 | Column stores and OLAP | Row vs column layout, compression, vectorised execution, data warehouses | Choose a store for a dashboard over 10B events |
| 22.4 | Time-series data | Downsampling, retention, high cardinality, Prometheus-style storage | Design metrics storage for 1M series |
| 22.5 | Distributed file systems | GFS/HDFS/Colossus: chunk servers, masters, replication | Survive a disk failure every hour |
| 22.6 | From MapReduce to Spark and dataflow | Batch jobs, shuffles, DAGs, exactly-once in streaming engines | Turn a nightly batch job into a streaming one |

### Module 23 – Real-world architectures
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 23.1 | Netflix: streaming to hundreds of millions | Open Connect appliances inside ISPs, the control plane on AWS, chaos engineering, regional evacuation | Estimate peak egress for a global premiere |
| 23.2 | Disney+ Hotstar: tens of millions watching one match | Pre-scaling ahead of a spike, ladder-based autoscaling, panic mode and graceful degradation | Plan capacity for a 50M-viewer final |
| 23.3 | WhatsApp: millions of connections per server | Erlang/BEAM, one process per connection, store-and-forward, tiny teams | Size a chat fleet for 2B users |
| 23.4 | Discord: trillions of messages | Cassandra to ScyllaDB, hot partitions, Rust data services with request coalescing | Fix a hot channel partition |
| 23.5 | Uber: real-time dispatch | H3 hexagons, supply/demand matching, geo-sharding, surge | Match riders to drivers in one city |
| 23.6 | Instagram: scaling Postgres | Sharding by user, logical shards, ID generation, Cassandra for feeds | Choose a shard key for likes |
| 23.7 | Twitter/X: building timelines | Fan-out on write, the celebrity problem, hybrid fan-out, Redis timelines | Decide who gets fan-out on read |
| 23.8 | YouTube: video at planetary scale | Upload pipeline, transcoding ladders, Vitess for MySQL sharding, edge caching | Design the upload-to-watch path |
| 23.9 | Shopify: surviving flash sales | Pods (cells), load shedding, the checkout queue, BFCM game days | Keep checkout up during a sneaker drop |
| 23.10 | Stripe: payments that never double-charge | Idempotency keys, the ledger, retries with backoff, API versioning | Make a charge endpoint safe to retry |
| 23.11 | Amazon DynamoDB: predictable at any scale | Partitions, adaptive capacity, Prime Day peaks, cell-based design | Spread a hot partition key |
| 23.12 | Figma: real-time multiplayer | A server-authoritative sync engine, conflict resolution per property, sharding Postgres | Merge two people editing one shape |

### Module 24 – Postmortems: why big systems fail
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 24.1 | How to read a postmortem | Blameless culture, timelines, trigger vs root cause vs contributing factors | Write the timeline for an outage you saw |
| 24.2 | Cloudflare, Nov 2025: a file that doubled | A generated feature file grew past a hard limit and crashed the core proxy worldwide | Add a guard rail to a config pipeline |
| 24.3 | Cloudflare, Jul 2019: one regular expression | Catastrophic backtracking pushed every CPU to 100%; global WAF rules without staging | Spot a dangerous regex |
| 24.4 | CrowdStrike, Jul 2024: 8.5 million blue screens | A content update read out of bounds in a kernel driver; no staged rollout | Design a staged rollout for agent updates |
| 24.5 | AWS us-east-1, Oct 2025: a DNS race | A race in DynamoDB's DNS automation emptied an endpoint record; the dependency cascade that followed | Map the dependencies of one region |
| 24.6 | AWS S3, Feb 2017: one mistyped command | Removing too many servers took down S3's index; slow cold restarts; the status page hosted on S3 | Add safety limits to an ops tool |
| 24.7 | Facebook, Oct 2021: the internet forgot Facebook | A backbone command withdrew BGP routes; DNS servers withdrew themselves; badges stopped working | Plan out-of-band access |
| 24.8 | GitLab, Jan 2017: deleting the database | rm -rf on the wrong host and five backup methods that didn't work | Test a restore, not a backup |
| 24.9 | GitHub, Oct 2018: 43 seconds, 24 hours | A brief network partition, cross-coast failover and divergent writes | Decide between availability and consistency |
| 24.10 | Roblox, Oct 2021: 73 hours down | Consul under a new streaming feature, BoltDB freelist growth, circular dependencies | Remove a circular dependency |
| 24.11 | Fastly, Jun 2021: one customer's config | A latent bug triggered by a valid config took down 85% of the network in a minute | Shrink a blast radius |
| 24.12 | Slack, Jan 2021: the first Monday back | Traffic after the holidays, AWS Transit Gateway scaling, autoscaling that made it worse | Pre-scale for a known spike |
| 24.13 | Google Cloud, Jun 2025: a null pointer everywhere | A policy with blank fields crashed Service Control in every region; no feature flag; retry herds | Gate a new code path behind a flag |
| 24.14 | Knight Capital, 2012: $440M in 45 minutes | A partial deploy reused an old flag and woke dead code | Design a safe deploy checklist |
| 24.15 | Patterns behind the outages | Global config pushes, missing staged rollouts, retry storms, hidden dependencies, cells and blast radius | Score your system against the patterns |

### Module 25 – The interview playbook
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 25.1 | How design interviews work | What interviewers score, a 45-minute plan, driving the conversation | Run a mock interview on yourself |
| 25.2 | Design a URL shortener | Key generation, redirects, caching, analytics | Handle 100k redirects/s |
| 25.3 | Design a rate limiter | Algorithms, where it runs, distributed counters, failure modes | Limit 1,000 API keys across 50 servers |
| 25.4 | Design a news feed | Fan-out on write vs read, ranking, celebrities | Build a feed for 300M users |
| 25.5 | Design a chat app | Connections, delivery receipts, ordering, group fan-out, offline sync | Deliver messages with ticks |
| 25.6 | Design a notification system | Channels, templates, priorities, dedupe, user preferences | Send 10M pushes in 5 minutes |
| 25.7 | Design search autocomplete | Tries, top-k per prefix, caching, freshness | Answer each keystroke in 50 ms |
| 25.8 | Design a web crawler | Frontier, politeness, dedupe with Bloom filters, scale | Crawl 1B pages a month |
| 25.9 | Design a video platform | Upload, transcode, storage, CDN, recommendations | Serve 1M concurrent viewers |
| 25.10 | Design a ride-hailing app | Location updates, geo indexing, matching, trip state | Match in under a second |
| 25.11 | Design a ticket booking system | Seat holds, contention, queues for big on-sales, payment | Sell 50k seats in a minute fairly |
| 25.12 | Design file sync (Dropbox) | Chunking, dedupe, metadata service, sync conflicts | Sync a 2 GB file edit cheaply |
| 25.13 | Design a collaborative editor | OT vs CRDTs, presence, snapshots | Merge concurrent edits |
| 25.14 | Design a payment system | Ledgers, idempotency, reconciliation, provider failures | Never double-charge |
| 25.15 | Design a leaderboard | Sorted sets, sharded top-k, real-time vs periodic | Rank 50M players |
| 25.16 | Design a distributed cache | Partitioning, replication, eviction, hot keys | Build a 10 TB cache cluster |
| 25.17 | Design metrics and monitoring | Ingestion, time-series storage, alerting, cardinality | Alert within 30 s on 1M series |

---

## Part 4 – AI system design

### Module 26 – AI systems foundations
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 26.1 | When a model becomes a component | Probabilistic outputs, slow and expensive calls, what changes in architecture | List what changes when you add an LLM to an app |
| 26.2 | LLMs for system designers | Tokens, context windows, prefill vs decode, TTFT and tokens/s, pricing by token | Estimate cost and latency of one chat turn |
| 26.3 | Serving models on GPUs | GPU memory math, the KV cache, continuous batching, PagedAttention, quantisation | Fit a 70B model and its KV cache on GPUs |
| 26.4 | Model gateways and routing | One API for many providers, fallbacks, routing and cascades, token-based rate limits | Route easy prompts to a small model |
| 26.5 | Caching for LLMs | Exact caches, prompt/prefix caching, semantic caches and their wrong answers | Pick a similarity threshold |
| 26.6 | Streaming and perceived latency | Token streaming over SSE, speculative decoding, latency budgets for AI features | Make a 6-second answer feel instant |
| 26.7 | Self-hosting vs model APIs | Cost per million tokens, utilisation, data control, the break-even point | Find the break-even for your traffic |

### Module 27 – Retrieval and RAG
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 27.1 | Why retrieval-augmented generation | Grounding, freshness, citations; RAG vs fine-tuning vs long context | Choose between RAG and fine-tuning for three products |
| 27.2 | Embeddings | Vectors for meaning, similarity, dimensions, choosing and versioning a model | Explain why "refund" finds "money back" |
| 27.3 | Vector indexes | Exact vs approximate search, HNSW, IVF, product quantisation, recall vs latency | Tune an index for 100M vectors |
| 27.4 | Ingestion and chunking | Pipelines, chunk size and overlap, metadata, permissions, keeping embeddings fresh | Design ingestion for a help centre |
| 27.5 | Hybrid search and reranking | BM25 plus vectors, reciprocal rank fusion, cross-encoder rerankers | Fix a query that misses an exact product code |
| 27.6 | Evaluating RAG | Recall@k, MRR, groundedness, answer quality, golden sets | Build a 50-question eval set |
| 27.7 | Beyond basic RAG | Query rewriting, agentic retrieval, GraphRAG, long context vs retrieval | Pick an approach for multi-hop questions |

### Module 28 – Agents
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 28.1 | Workflows vs agents | Prompt chaining, routing, parallelisation, orchestrator-workers, evaluator-optimizer | Decide if a task needs an agent at all |
| 28.2 | The agent loop and tool calling | Think, act, observe; tool schemas; structured outputs; stopping conditions | Trace one agent run step by step |
| 28.3 | MCP: connecting tools and data | The Model Context Protocol: hosts, clients, servers, tools, resources, transports | Expose a database to an agent safely |
| 28.4 | Memory and context engineering | Short-term context, long-term memory, summarisation, what to keep in the window | Design memory for a personal assistant |
| 28.5 | Multi-agent systems | Orchestrator and subagents, parallel research, handoffs, agent-to-agent protocols | Split a research task across agents |
| 28.6 | Durable execution for agents | Checkpoints, idempotent tools, retries, human approval steps, long-running tasks | Resume an agent after a crash |
| 28.7 | Sandboxing and permissions | Least privilege, approval gates, isolated execution, audit logs | Decide which tools need a human |
| 28.8 | Agent reliability math | Compounding step errors, verification, step limits, cost per task | Make a 10-step agent 95% reliable |

### Module 29 – AI in production
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 29.1 | Evals | Offline and online evals, golden sets, LLM-as-judge, regression gates | Write an eval for a support bot |
| 29.2 | Observability for LLM apps | Traces of prompts and tool calls, token accounting, quality signals, OpenTelemetry | Find why answers got worse last week |
| 29.3 | Guardrails | Input and output checks, PII redaction, policy filters, structured validation | Add guardrails without doubling latency |
| 29.4 | Prompt injection and AI security | Direct and indirect injection, data exfiltration, the OWASP LLM Top 10 | Find the injection path in a design |
| 29.5 | Cost engineering | Tokens per task, caching, routing, batch APIs, shorter prompts | Cut the bill of an AI feature by 70% |
| 29.6 | Reliability for AI features | Timeouts, provider failover, rate limits, degraded modes when the model is down | Keep an AI feature up when a provider fails |
| 29.7 | Data, privacy and governance | Training on user data, retention, data residency, audit and model cards | Write a data policy for an AI feature |

### Module 30 – AI case studies
| # | Lesson | Learn | Try |
|---|--------|-------|-----|
| 30.1 | Chat at ChatGPT scale | GPU capacity planning, queueing, rate limits and tiers, what its outages taught | Plan GPUs for a product launch |
| 30.2 | Code assistants | Completion latency budgets, context from the codebase, indexing repos, agents that edit code | Design repo indexing for a monorepo |
| 30.3 | An AI answer engine | Search plus LLM: query planning, crawling, ranking, citations | Design an answer engine with citations |
| 30.4 | A customer support agent | Retrieval over help articles, tool access, escalation to humans, measuring resolution | Decide what the agent may do alone |
| 30.5 | Recommendation systems | Candidate generation, ranking, two-tower models, feature stores, feedback loops | Design a "for you" feed |
| 30.6 | ML platforms and fraud detection | Feature stores, online vs offline features, training-serving skew, real-time scoring | Score payments in 50 ms |
| 30.7 | When AI goes wrong | Real incidents: a chatbot's promise held up in court, an agent that deleted production data, prompt leaks | Add the missing safeguards |
| 30.8 | Lab: an AI support assistant | Requirements to architecture for a RAG + agent product | Design, estimate, and load-test it |
