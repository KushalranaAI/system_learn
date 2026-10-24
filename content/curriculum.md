# Curriculum

Three parts and nineteen modules. Each module starts with a problem a growing
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
