import { build, type Preset } from "../presets";

/** Real architectures, scaled down to the simulator. */
export const CASE_STUDIES: Preset[] = [
  {
    id: "cs-netflix",
    title: "Netflix: video from inside your ISP",
    source: "Netflix",
    blurb: "Open Connect appliances serve the video; a small control plane on AWS does everything else.",
    lesson: "30.1",
    story: `Netflix splits its system in two:

- **Open Connect** - Netflix's own CDN. Open Connect Appliances (OCAs) are servers full of disks installed inside ISP networks and at internet exchanges, given to ISPs at no charge. They hold the catalogue and serve all video bytes. They are filled overnight, during off-peak hours, with what Netflix predicts each region will watch.
- **The control plane** on AWS - sign-in, browsing, recommendations, billing, and the steering service that tells each player which OCAs to fetch from. It runs in several AWS regions, uses EVCache (memcached) and Cassandra, and streams events through Kafka (Keystone).

Netflix pioneered chaos engineering (Chaos Monkey kills instances in production) and practises evacuating a whole AWS region by shifting its traffic to the others.

**On the canvas:** reads are player requests (400k/s). The CDN node is Open Connect and answers 98% of them; the API servers are the control plane; the cache is EVCache; the database is Cassandra. Writes are viewing events (2,000/s) to Kafka.`,
    tryThis: [
      "Lower the CDN hit ratio to 0.9 (a new hit show that isn't pre-positioned). What happens to the control plane?",
      "Kill an API server - health checks are on. Is there room?",
      "Delete the CDN and wire the client straight to the load balancer. How many servers would you need?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["oca", "cdn", { hitRatio: 0.98 }],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["api3", "server", { size: "l" }],
        ["evcache", "cache", { hitRatio: 0.95 }],
        ["cassandra", "db", { size: "l", shards: 2 }],
        ["keystone", "kafka", { partitions: 4 }],
        ["analytics", "consumer", { consumers: 4 }],
      ],
      wires:
        "client>oca, oca>lb, lb>api1, lb>api2, lb>api3, api1>evcache, api2>evcache, api3>evcache, api1>cassandra, api2>cassandra, api3>cassandra, api1>keystone, api2>keystone, api3>keystone, keystone>analytics",
    }),
    traffic: { reads: 400_000, writes: 2_000, bots: 0 },
  },
  {
    id: "cs-hotstar",
    title: "Disney+ Hotstar: one cricket match, tens of millions live",
    source: "Disney+ Hotstar",
    blurb: "Concurrency jumps by millions in minutes when a star walks out to bat. Pre-scale or fall over.",
    lesson: "30.2",
    story: `Hotstar (now JioHotstar) streams Indian cricket. Its audience is spiky in a way few platforms see: millions join in minutes when a key batter comes in, and leave together at the innings break.

**Key numbers:** 25.3 million concurrent viewers for the India-New Zealand World Cup semi-final in 2019; about 59 million (5.9 crore) for the India-Australia World Cup final in November 2023, which Hotstar reported as its peak.

**How they cope:**
- Reactive autoscaling is too slow: new machines take minutes, the spike takes seconds. They **pre-scale** ahead of the match from forecasts.
- Scaling decisions follow a **ladder** keyed on concurrent viewers, not CPU.
- **Panic mode:** under extreme load, non-essential features (recommendations, personalisation) are switched off so video keeps playing.
- Big load-test "game days" before tournaments.

**On the canvas:** the CDN serves video segments (90%); the API servers are the platform's services. The preselected incident is a 3x surge.`,
    tryThis: [
      "Run the 3x surge. Which tier fails first?",
      "Pre-scale: add API servers until the surge passes with success above 99%.",
      "\"Panic mode\": instead of more servers, raise the cache hit ratio (serve a static home page) and the CDN ratio. How far does that get you?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["cdn", "cdn", { hitRatio: 0.9 }],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["api3", "server", { size: "l" }],
        ["api4", "server", { size: "l" }],
        ["cache", "cache", { hitRatio: 0.9 }],
        ["db", "db", { size: "l" }],
      ],
      wires: "client>cdn, cdn>lb, lb>api1, lb>api2, lb>api3, lb>api4, api1>cache, api2>cache, api3>cache, api4>cache, api1>db, api2>db, api3>db, api4>db",
    }),
    traffic: { reads: 300_000, writes: 1_000, bots: 0 },
    incident: { type: "spike", factor: 3 },
  },
  {
    id: "cs-whatsapp",
    title: "WhatsApp: millions of connections per server",
    source: "WhatsApp",
    blurb: "Erlang servers hold millions of connections each and store messages only until they are delivered.",
    lesson: "30.3",
    story: `WhatsApp is famous for doing a lot with very little.

- Servers run **Erlang** on FreeBSD. Each connection is a lightweight Erlang process; in 2012 the team reported over **2 million TCP connections on one server**.
- **Store and forward:** the server keeps a message only until the recipient's device acknowledges it, then deletes it. Messages are end-to-end encrypted, so the server can't read them anyway.
- When Facebook bought it in 2014 (for $19B), WhatsApp had about 450 million monthly users and a small engineering team - often quoted as about 32 engineers.
- Today it has more than 2 billion users.

**On the canvas:** three large chat servers hold the connections (one node = a group of chat servers). Writes are messages (6,000/s); they go to a queue (the offline store) and workers deliver them and record receipts. Reads are presence and receipt lookups, mostly from memory.`,
    tryThis: [
      "Kill a chat server. Health checks are on - do the others have room for its connections?",
      "Run a 2x spike (New Year's Eve). Watch the backlog of undelivered messages.",
      "Add workers until the backlog drains within the run.",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["chat1", "server", { size: "xl" }],
        ["chat2", "server", { size: "xl" }],
        ["chat3", "server", { size: "xl" }],
        ["presence", "cache", { hitRatio: 0.9 }],
        ["offline", "queue"],
        ["deliver", "worker", { workers: 18 }],
        ["store", "db", { size: "xl" }],
      ],
      wires: "client>lb, lb>chat1, lb>chat2, lb>chat3, chat1>presence, chat2>presence, chat3>presence, chat1>store, chat2>store, chat3>store, chat1>offline, chat2>offline, chat3>offline, offline>deliver, deliver>store",
    }),
    traffic: { reads: 20_000, writes: 6_000, bots: 0 },
    incident: { type: "spike", factor: 2 },
  },
  {
    id: "cs-discord",
    title: "Discord: trillions of messages",
    source: "Discord",
    blurb: "ScyllaDB behind Rust data services that coalesce identical reads. Take the coalescing away and see.",
    lesson: "30.4",
    story: `Discord stores every message ever sent. In 2017 that was billions of messages on 12 Cassandra nodes; by early 2022 it was trillions on **177 Cassandra nodes**, with hot partitions (one huge server's busy channel) causing latency spikes and constant on-call firefighting.

**What they changed (2022-2023):**
- Moved to **ScyllaDB** (Cassandra-compatible, written in C++): **72 nodes** instead of 177.
- Put **data services** written in Rust between the API and the database. They route requests by channel id (consistent hashing) and **coalesce** requests: if many users ask for the same messages at once, the database is queried once.
- Messages are partitioned by channel plus a time bucket.

**Results:** p99 for fetching historical messages went from 40-125 ms to 15 ms; inserts from 5-70 ms to a steady 5 ms. The migration copied data at up to 3.2 million messages per second.

**On the canvas:** the API servers are the data services; the cache stands for request coalescing; the database is the sharded ScyllaDB cluster.`,
    tryThis: [
      "Set the cache hit ratio to 0 (no coalescing): what happens to the database when everyone opens the same channel?",
      "Run a 2x spike with coalescing on and off.",
      "Remove one shard. How much headroom did it give you?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["data1", "server", { size: "xl" }],
        ["data2", "server", { size: "xl" }],
        ["data3", "server", { size: "xl" }],
        ["coalesce", "cache", { hitRatio: 0.7 }],
        ["scylla", "db", { size: "l", shards: 3 }],
      ],
      wires: "client>lb, lb>data1, lb>data2, lb>data3, data1>coalesce, data2>coalesce, data3>coalesce, data1>scylla, data2>scylla, data3>scylla",
    }),
    traffic: { reads: 60_000, writes: 4_000, bots: 0 },
  },
  {
    id: "cs-instagram",
    title: "Instagram: scaling Postgres",
    source: "Instagram",
    blurb: "Thousands of logical shards on a few Postgres machines, IDs that encode time and shard, and a CDN for photos.",
    lesson: "30.6",
    story: `Instagram grew on Django and PostgreSQL, and kept Postgres by sharding it.

- **Logical shards:** data is split into thousands of logical shards (Postgres schemas) by user id, mapped onto far fewer physical database servers. Moving a shard to a new machine is a copy, not a re-shard.
- **IDs:** a 64-bit id generated inside Postgres: 41 bits of milliseconds since a custom epoch, 13 bits of logical shard id, 10 bits of per-shard sequence. Ids sort by time and say where the row lives.
- **Caching:** memcached in front of the databases; read replicas for read-heavy data.
- Photos are served from a CDN. Later, feeds and inboxes moved to Cassandra.

**On the canvas:** the CDN serves photos (80% of reads); three API servers are the Django fleet; the cache is memcached; the primary has 4 shards (one node = the whole sharded Postgres fleet) with one replica. Writes are posts, likes and comments.`,
    tryThis: [
      "Set the primary's shards to 1. Which card turns red?",
      "Run \"Kill: Primary DB\" with failover off, then on.",
      "Run \"Cache restart\". Do the shards survive the stampede?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["cdn", "cdn", { hitRatio: 0.8 }],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "xl" }],
        ["api2", "server", { size: "xl" }],
        ["api3", "server", { size: "xl" }],
        ["memcache", "cache", { hitRatio: 0.9 }],
        ["pg", "db", { size: "l", shards: 4 }],
        ["pgrep", "db", { size: "l", shards: 4, role: "replica" }],
      ],
      wires: "client>cdn, cdn>lb, lb>api1, lb>api2, lb>api3, api1>memcache, api2>memcache, api3>memcache, api1>pg, api2>pg, api3>pg, api1>pgrep, api2>pgrep, api3>pgrep",
    }),
    traffic: { reads: 200_000, writes: 3_000, bots: 0 },
  },
  {
    id: "cs-shopify-bfcm",
    title: "Shopify: Black Friday flash sales",
    source: "Shopify · BFCM 2024",
    blurb: "Pods isolate shops, the edge sheds bots, and checkout is queued. Run the Black Friday surge.",
    lesson: "30.9",
    story: `Shopify hosts millions of shops on one platform, and Black Friday-Cyber Monday (BFCM) is its biggest weekend.

**BFCM 2024 numbers (Shopify):** a peak of 284 million requests per minute at the edge, over 80 million per minute on app servers, and 10.5 trillion database queries over the weekend.

**How it holds:**
- **Pods:** shops are split into pods, each a full, isolated set of MySQL, Redis and memcached. A bad shop or a failing database hurts one pod, not everyone.
- **Load shedding and bot protection** at the edge, and a checkout queue (throttle) for flash sales such as sneaker drops.
- **Game days:** months of load tests against production-like traffic before the weekend.

**On the canvas:** the CDN serves storefront pages (75%); the limiter blocks bots; four API servers are the Rails fleet; the database is sharded in 4 (one shard = a pod). Writes are orders, which go through a queue to checkout workers. The preselected incident is a 2x surge.`,
    tryThis: [
      "Run the 2x surge. What fails first?",
      "Set the limiter to 0 (off). How much do the bots cost you?",
      "Add checkout workers until the order backlog drains. When does the database become the limit?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["cdn", "cdn", { hitRatio: 0.75 }],
        ["rl", "limiter", { limitPerIp: 40 }],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "xl" }],
        ["api2", "server", { size: "xl" }],
        ["api3", "server", { size: "xl" }],
        ["api4", "server", { size: "xl" }],
        ["cache", "cache", { hitRatio: 0.85 }],
        ["pods", "db", { size: "xl", shards: 4 }],
        ["checkout", "queue"],
        ["workers", "worker", { workers: 12 }],
      ],
      wires:
        "client>cdn, cdn>rl, rl>lb, lb>api1, lb>api2, lb>api3, lb>api4, api1>cache, api2>cache, api3>cache, api4>cache, api1>pods, api2>pods, api3>pods, api4>pods, api1>checkout, api2>checkout, api3>checkout, api4>checkout, checkout>workers, workers>pods",
    }),
    traffic: { reads: 250_000, writes: 4_000, bots: 20_000 },
    incident: { type: "spike", factor: 2 },
  },
  {
    id: "cs-dynamodb-prime-day",
    title: "DynamoDB on Prime Day",
    source: "AWS · Prime Day 2025",
    blurb: "Request routers in front of thousands of partitions: predictable at any scale, as long as keys spread.",
    lesson: "30.11",
    story: `Amazon DynamoDB is a key-value database built to give single-digit millisecond latency at any scale.

**Prime Day 2025 (AWS):** Amazon's own sites, Alexa and fulfilment centres made tens of trillions of DynamoDB calls, peaking at **151 million requests per second**.

**How it stays predictable:**
- Tables are split into **partitions** by key hash; each partition is replicated across three availability zones.
- A fleet of **request routers** looks up which storage nodes hold a key and forwards the request.
- **Adaptive capacity** and automatic splitting move hot keys and split busy partitions; admission control caps what one partition takes.
- A hot key still has a ceiling: spread writes over many keys.

**On the canvas:** the API servers are the request router fleet; the cache is DAX; the database is the storage fleet with 8 shards (one shard = many partitions). The incident is a 2x Prime Day surge.`,
    tryThis: [
      "Run the 2x surge. Is there headroom?",
      "Set the shards to 2: what does a table with too few partitions look like?",
      "Remove the cache. How much read capacity did DAX save?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["router1", "server", { size: "2xl" }],
        ["router2", "server", { size: "2xl" }],
        ["router3", "server", { size: "2xl" }],
        ["router4", "server", { size: "2xl" }],
        ["router5", "server", { size: "2xl" }],
        ["dax", "cache", { hitRatio: 0.5 }],
        ["storage", "db", { size: "xl", shards: 8 }],
      ],
      wires: "client>lb, lb>router1, lb>router2, lb>router3, lb>router4, lb>router5, router1>dax, router2>dax, router3>dax, router4>dax, router5>dax, router1>storage, router2>storage, router3>storage, router4>storage, router5>storage",
    }),
    traffic: { reads: 60_000, writes: 25_000, bots: 0 },
    incident: { type: "spike", factor: 2 },
  },
  {
    id: "cs-uber",
    title: "Uber: real-time dispatch",
    source: "Uber",
    blurb: "Driver locations stream into an H3-indexed supply view; dispatch matches riders in one city at a time.",
    lesson: "30.5",
    story: `Uber matches riders and drivers in real time in hundreds of cities.

- **Locations:** driver apps send their position every few seconds. These updates are the bulk of the write traffic.
- **H3:** Uber's open-source hexagonal grid (released 2018). Every location maps to a hexagon id; nearby supply is "this cell and its neighbours". Hexagons have equal-distance neighbours, which makes surge pricing and demand maps smoother than squares.
- **Dispatch** matches a request to nearby drivers by estimated time of arrival, and keeps trip state as a state machine.
- Work is sharded by geography, so a busy city doesn't slow the others.

**On the canvas:** writes are location pings (6,000/s) published to Kafka and stored in a sharded trip/location database; the dispatch group consumes them into the supply index (the cache). Reads are rider requests and ETAs.`,
    tryThis: [
      "Kill an API server: health checks are on. Is there room?",
      "Run a 2x spike (a concert ends). Which group falls behind?",
      "Set the topic's hot key share to 40% (one city dominates). What does the Guide say?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["api3", "server", { size: "l" }],
        ["supply", "cache", { hitRatio: 0.9 }],
        ["trips", "db", { size: "l", shards: 2 }],
        ["locations", "kafka", { partitions: 8 }],
        ["dispatch", "consumer", { consumers: 8 }],
      ],
      wires:
        "client>lb, lb>api1, lb>api2, lb>api3, api1>supply, api2>supply, api3>supply, api1>trips, api2>trips, api3>trips, api1>locations, api2>locations, api3>locations, locations>dispatch, dispatch>supply",
    }),
    traffic: { reads: 10_000, writes: 6_000, bots: 0 },
  },
];
