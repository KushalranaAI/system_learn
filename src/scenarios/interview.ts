import { build, type Preset } from "../presets";

/** The most-asked design questions, each as a starting design to explain and improve. */
export const INTERVIEW: Preset[] = [
  {
    id: "iv-url-shortener",
    title: "URL shortener",
    source: "Interview classic",
    blurb: "Redirects are 99% reads: a CDN, a cache and one database. Survive a cold cache.",
    lesson: "32.2",
    story: `**The question:** design bit.ly. Users create short links (writes) and millions of people follow them (reads).

**Key numbers:** about 100:1 reads to writes. A popular service does on the order of 100k redirects/s at peak and a few hundred new links/s.

**Shape of the answer:**
- Generate a short key (base62 of a counter or a random 7-character key with a collision check).
- Store \`key → long URL\` in a key-value or relational table; the key is the primary key.
- A redirect is a 301/302 - cache it at the CDN and in Redis. Most traffic goes to a small set of hot links.

**On the canvas:** the client sends 40k redirects/s and 200 new links/s (scaled down). The CDN answers half the redirects; Redis answers 90% of the rest. One Postgres-style database holds every link. There is no replica, so the database is the place to watch.`,
    tryThis: [
      "Run \"Cache restart\" in the timeline. Can the one database take every redirect while Redis refills?",
      "Add a read replica (wire both API servers to it) and run the cache restart again.",
      "Raise the CDN hit ratio to 0.8 (use 301s that browsers and edges keep). How much origin capacity do you save?",
      "Double the reads: which card turns red first?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["cdn", "cdn", { hitRatio: 0.5 }],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["cache", "cache", { hitRatio: 0.9 }],
        ["db", "db", { size: "m" }],
      ],
      wires: "client>cdn, cdn>lb, lb>api1, lb>api2, api1>cache, api2>cache, api1>db, api2>db",
    }),
    traffic: { reads: 40_000, writes: 200, bots: 0 },
  },
  {
    id: "iv-rate-limiter",
    title: "Rate limiter",
    source: "Interview classic",
    blurb: "A scraper sends 20k req/s and the limiter in front is switched off. Pick a limit that stops it without blocking offices.",
    lesson: "32.3",
    story: `**The question:** design a rate limiter for a public API: limit each client to N requests per second across a fleet of servers.

**Shape of the answer:**
- Algorithm: token bucket (bursty but fair) or sliding-window counter (smooth). Fixed windows let a client send 2N across a boundary.
- Where it runs: at the edge or API gateway, before expensive work. Counters live in Redis (INCR + EXPIRE, or a Lua script) so all servers share them.
- Failure mode: if the counter store is down, fail open (let traffic through) for most APIs, fail closed for expensive or abusive endpoints.
- Key choice: per API key is fair; per IP is easy but punishes offices and mobile carriers behind one NAT address.

**On the canvas:** 12k real reads/s plus a scraper sending 20k req/s for random URLs from a few IPs. The rate limiter is wired in but its limit is 0 (off), so bot requests miss the cache and land on the database.`,
    tryThis: [
      "Read the Guide: what does the scraper do to the database right now?",
      "Select the rate limiter and set 100 req/s per IP. How much of the scraper still gets through?",
      "Lower the limit to 5 req/s per IP. Who else gets blocked, and why?",
      "Find the highest limit that keeps the database under 85%.",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["rl", "limiter", { limitPerIp: 0 }],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["cache", "cache", { hitRatio: 0.9 }],
        ["db", "db", { size: "m" }],
      ],
      wires: "client>rl, rl>lb, lb>api1, lb>api2, api1>cache, api2>cache, api1>db, api2>db",
    }),
    traffic: { reads: 12_000, writes: 300, bots: 20_000 },
  },
  {
    id: "iv-news-feed",
    title: "News feed",
    source: "Interview classic",
    blurb: "Fan-out on write: every post is copied into followers' timelines by a consumer group that can't keep up.",
    lesson: "32.4",
    story: `**The question:** design the home feed for a social network with 300M users.

**Shape of the answer:**
- **Fan-out on write:** when someone posts, push the post id into each follower's precomputed timeline (a Redis list). Reading a feed is one cache read.
- **Fan-out on read:** build the feed when it's opened by merging recent posts from everyone you follow. Cheap writes, expensive reads.
- **Hybrid:** fan out on write for normal users; for celebrities with millions of followers, merge their posts in at read time.
- Ranking runs on the candidate list (recency, affinity, engagement).

**On the canvas:** reads are feed loads served from the timeline cache; each write is a new post. Posts go to the database and to a Kafka topic; the "fan-out" consumer group writes them into timelines in the cache. It has 2 consumers for 6 partitions, so lag grows: followers see posts late.`,
    tryThis: [
      "Watch the fan-out group's lag. Add consumers until it stops growing.",
      "Set the topic's hot key share to 30% (a celebrity posting). Why don't more consumers help?",
      "Kill the cache: what would fan-out on read cost the database?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["timelines", "cache", { hitRatio: 0.9 }],
        ["db", "db", { size: "l" }],
        ["rep", "db", { size: "l", role: "replica" }],
        ["posts", "kafka", { partitions: 6 }],
        ["fanout", "consumer", { consumers: 2 }],
      ],
      wires:
        "client>lb, lb>api1, lb>api2, api1>timelines, api2>timelines, api1>db, api2>db, api1>rep, api2>rep, api1>posts, api2>posts, posts>fanout, fanout>timelines",
    }),
    traffic: { reads: 24_000, writes: 3_000, bots: 0 },
  },
  {
    id: "iv-chat",
    title: "Chat app",
    source: "Interview classic",
    blurb: "Gateways hold the connections, Kafka carries messages to delivery workers. Kill a gateway with no health checks.",
    lesson: "32.5",
    story: `**The question:** design WhatsApp or Messenger: one-to-one and group messages, delivery ticks, offline users.

**Shape of the answer:**
- Clients keep a WebSocket to a gateway server. A session store maps user → gateway.
- Each message gets a per-conversation sequence number, is stored, then delivered. Ticks: sent (server stored it), delivered (device got it), read.
- Offline users get the message on reconnect (sync from their last sequence number) plus a push notification.
- Group messages fan out to each member; big groups fan out lazily.

**On the canvas:** three API servers stand for the gateway fleet. Writes are messages sent (3,000/s), reads are history and sync requests. Messages go to the message store and to a Kafka topic; the delivery group pushes them to recipients' inboxes (the cache). The load balancer has health checks off.`,
    tryThis: [
      "Run \"Kill: API server 1\". A third of messages fail - why?",
      "Turn on health checks and run it again. Is there still room (N+1)?",
      "Double the writes. Which breaks first: the message store or delivery?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: false }],
        ["gw1", "server", { size: "m" }],
        ["gw2", "server", { size: "m" }],
        ["gw3", "server", { size: "m" }],
        ["inbox", "cache", { hitRatio: 0.85 }],
        ["store", "db", { size: "l" }],
        ["msgs", "kafka", { partitions: 4 }],
        ["delivery", "consumer", { consumers: 4 }],
      ],
      wires:
        "client>lb, lb>gw1, lb>gw2, lb>gw3, gw1>inbox, gw2>inbox, gw3>inbox, gw1>store, gw2>store, gw3>store, gw1>msgs, gw2>msgs, gw3>msgs, msgs>delivery, delivery>inbox",
    }),
    traffic: { reads: 12_000, writes: 3_000, bots: 0 },
    incident: { type: "nodeDown", nodeId: "gw1" },
  },
  {
    id: "iv-notifications",
    title: "Notification system",
    source: "Interview classic",
    blurb: "Send requests go to a queue; four workers can't keep up with 3,000 notifications a second.",
    lesson: "32.6",
    story: `**The question:** design a service that sends push, SMS and email notifications for other teams - 10M pushes in 5 minutes for a big campaign.

**Shape of the answer:**
- An API accepts "notify user X with template T"; it checks user preferences and rate caps, then enqueues.
- Separate queues per channel and priority, so a marketing blast can't delay a password reset.
- Workers render templates and call providers (APNs, FCM, SMS gateways) with retries and an idempotency key to avoid duplicates.
- 10M in 5 minutes is about 33k sends/s - provider limits matter as much as your own workers.

**On the canvas:** writes are send requests (3,000/s), reads are preference lookups. Sends go through a queue to 4 workers (1,600 jobs/s), so the backlog grows.`,
    tryThis: [
      "Watch the queue backlog grow. How many workers do you need to drain it?",
      "Run a 3x spike (a campaign launch). How long does the backlog take to drain afterwards?",
      "Add workers until the database becomes the limit, then pick a bigger database.",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["api", "server", { size: "m" }],
        ["prefs", "cache", { hitRatio: 0.9 }],
        ["q", "queue"],
        ["w", "worker", { workers: 4 }],
        ["db", "db", { size: "m" }],
      ],
      wires: "client>api, api>prefs, api>db, api>q, q>w, w>db",
    }),
    traffic: { reads: 1_000, writes: 3_000, bots: 0 },
    incident: { type: "spike", factor: 3 },
  },
  {
    id: "iv-autocomplete",
    title: "Search autocomplete",
    source: "Interview classic",
    blurb: "Every keystroke is a request. Two servers run hot; the trie is rebuilt from the query log.",
    lesson: "32.7",
    story: `**The question:** design search-as-you-type: return the top suggestions for a prefix within about 50 ms.

**Shape of the answer:**
- Precompute top-k completions per prefix (a trie or a prefix → list table) offline from the query log.
- Serve from memory: a cache or the servers themselves hold the hot prefixes. Short prefixes are tiny in number and very hot - push them to the CDN/browser.
- Debounce on the client and cancel stale requests: it cuts load by half or more.
- Freshness: rebuild hourly, and blend in trending queries from a stream.

**On the canvas:** 60k keystrokes/s, half answered at the CDN. Two API servers serve the rest from the suggestion cache. Every search is also logged (writes) to a Kafka topic; the trie builder consumes it and refreshes the cache.`,
    tryThis: [
      "Two servers run near 94%. Add a third and watch p99 drop.",
      "Lower the CDN hit ratio to 0.3 (no caching of short prefixes). What breaks?",
      "Run \"Cache restart\": the database holds the full table. Does it survive?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["cdn", "cdn", { hitRatio: 0.5 }],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["suggest", "cache", { hitRatio: 0.95 }],
        ["db", "db", { size: "m" }],
        ["log", "kafka", { partitions: 2 }],
        ["trie", "consumer", { consumers: 2 }],
      ],
      wires: "client>cdn, cdn>lb, lb>api1, lb>api2, api1>suggest, api2>suggest, api1>db, api2>db, api1>log, api2>log, log>trie, trie>suggest",
    }),
    traffic: { reads: 60_000, writes: 500, bots: 0 },
  },
  {
    id: "iv-web-crawler",
    title: "Web crawler",
    source: "Interview classic",
    blurb: "A URL frontier feeds fetchers through a queue. Two fetchers for 1,200 pages a second.",
    lesson: "32.8",
    story: `**The question:** crawl 1 billion pages a month and store them for indexing.

**Key numbers:** 1B / (30 × 86,400 s) ≈ 400 pages/s on average; plan for 2-3x that. At ~100 KB per page that is about 100 TB a month.

**Shape of the answer:**
- The **frontier** holds URLs to visit, split into per-host queues so you are polite (one request per host every few seconds, respect robots.txt).
- **Fetchers** download pages; parsers extract links. A Bloom filter of seen URLs (and a content hash) stops re-crawling duplicates.
- Pages go to blob storage; metadata to a database.

**On the canvas:** the client stands for the scheduler. Each write is a page to fetch (1,200/s); the frontier server enqueues it and 2 fetcher workers (800 pages/s) process the queue. Reads are "have we seen this URL?" checks against the seen-set cache.`,
    tryThis: [
      "The backlog grows. How many fetchers drain it?",
      "Run a 2x spike (a big site map discovered). Watch the backlog after it ends.",
      "Add fetchers until the database is the limit. Which database size do you need?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["frontier", "server", { size: "m" }],
        ["seen", "cache", { hitRatio: 0.95 }],
        ["q", "queue"],
        ["fetch", "worker", { workers: 2 }],
        ["db", "db", { size: "s" }],
      ],
      wires: "client>frontier, frontier>seen, frontier>db, frontier>q, q>fetch, fetch>db",
    }),
    traffic: { reads: 3_000, writes: 1_200, bots: 0 },
  },
  {
    id: "iv-video",
    title: "Video platform",
    source: "Interview classic",
    blurb: "Uploads are transcoded in the background; viewers are served from the CDN. The origin runs hot.",
    lesson: "32.9",
    story: `**The question:** design YouTube: upload, transcode, store and stream to 1M concurrent viewers.

**Shape of the answer:**
- **Upload:** resumable upload straight to object storage, then a job per video.
- **Transcode:** split into segments, encode a ladder (240p to 4K) in parallel on workers; write a manifest (HLS/DASH).
- **Watch:** players fetch the manifest, then 2-6 second segments from a CDN, switching quality as bandwidth changes.
- 1M viewers at 5 Mbit/s is 5 Tbit/s - only a CDN can carry that.

**On the canvas:** reads are segment and manifest requests (200k/s), writes are uploads. The CDN answers 85%; two origin servers take the rest. Uploads go to a queue and 2 transcode workers.`,
    tryThis: [
      "The origin servers sit near 94%. Raise the CDN hit ratio to 0.95 - how many servers can you remove?",
      "Kill an origin server. Health checks are on - is there room for it?",
      "Run a 2x spike (a viral video). What breaks first?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["cdn", "cdn", { hitRatio: 0.85 }],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["cache", "cache", { hitRatio: 0.8 }],
        ["db", "db", { size: "m" }],
        ["q", "queue"],
        ["transcode", "worker", { workers: 2 }],
      ],
      wires: "client>cdn, cdn>lb, lb>api1, lb>api2, api1>cache, api2>cache, api1>db, api2>db, api1>q, api2>q, q>transcode, transcode>db",
    }),
    traffic: { reads: 200_000, writes: 300, bots: 0 },
  },
  {
    id: "iv-ride-hailing",
    title: "Ride-hailing",
    source: "Interview classic",
    blurb: "Every driver sends a location every few seconds. The trip database is taking all of them and drowning.",
    lesson: "32.10",
    story: `**The question:** design Uber: riders request trips, the nearest available driver is matched in under a second.

**Key numbers:** 1M active drivers sending a location every 4 s is 250k updates/s - far more writes than trips.

**Shape of the answer:**
- Location updates go to an in-memory geo index (geohash or H3 cells → drivers), not to the trip database.
- Matching queries nearby cells, ranks candidates by ETA, and offers the trip to one driver at a time.
- Trips are a state machine (requested → accepted → arrived → in progress → completed) in a durable store.
- Shard everything by city or region.

**On the canvas:** writes are location pings (8,000/s); reads are rider requests. The servers write every ping to one trip database (l, 7,000 writes/s) and to a Kafka topic that the matching group consumes.`,
    tryThis: [
      "The database is overloaded by pings. Shard it into 2 or 3 pieces in the inspector.",
      "The matching group falls behind. Add consumers.",
      "Kill an API server: is there room for it?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["geo", "cache", { hitRatio: 0.9 }],
        ["trips", "db", { size: "l" }],
        ["pings", "kafka", { partitions: 8 }],
        ["matching", "consumer", { consumers: 4 }],
      ],
      wires: "client>lb, lb>api1, lb>api2, api1>geo, api2>geo, api1>trips, api2>trips, api1>pings, api2>pings, pings>matching, matching>geo",
    }),
    traffic: { reads: 6_000, writes: 8_000, bots: 0 },
  },
  {
    id: "iv-ticketing",
    title: "Ticket booking",
    source: "Interview classic",
    blurb: "A big on-sale: 6,000 seat holds a second hit one database directly. Add a waiting room.",
    lesson: "32.11",
    story: `**The question:** design Ticketmaster: sell 50k seats for a concert in a minute, fairly, without selling a seat twice.

**Shape of the answer:**
- **Seat holds:** reserve a seat for a few minutes (a row with \`held_until\`, or a Redis key with TTL) with a conditional update so two people can't hold the same seat.
- **Contention:** everyone wants the same front rows. Lock per seat, not per event.
- **Waiting room:** put buyers in a queue and admit them at the rate the booking system can handle. It is fairer and it protects the database.
- **Payment:** charge after the hold; release on timeout or failure.

**On the canvas:** 20k reads/s (seat maps) and 6,000 hold attempts/s, all going straight to one database (m, 4,000 writes/s).`,
    tryThis: [
      "Run the 2x spike (the on-sale opens). What share of buyers get errors?",
      "Add a queue and workers between the API and the database (wire API → queue → workers → DB). Size the workers below the database's write limit.",
      "Instead, try a bigger database. Which fix is cheaper and fairer?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["cdn", "cdn", { hitRatio: 0.5 }],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["seatmap", "cache", { hitRatio: 0.8 }],
        ["db", "db", { size: "m" }],
      ],
      wires: "client>cdn, cdn>lb, lb>api1, lb>api2, api1>seatmap, api2>seatmap, api1>db, api2>db",
    }),
    traffic: { reads: 20_000, writes: 6_000, bots: 0 },
    incident: { type: "spike", factor: 2 },
  },
  {
    id: "iv-file-sync",
    title: "File sync (Dropbox)",
    source: "Interview classic",
    blurb: "A metadata service plus background chunk processing. Uploads pile up in the queue.",
    lesson: "32.12",
    story: `**The question:** design Dropbox: sync files across devices; a small edit to a 2 GB file must not re-upload 2 GB.

**Shape of the answer:**
- Split files into chunks (e.g. 4 MB) addressed by their hash. Upload only chunks the server doesn't have - dedupe for free.
- A **metadata service** stores files → ordered chunk lists, versions and a per-user change journal. Clients long-poll for changes.
- Chunks live in blob storage; metadata in a sharded relational database.
- Conflicts: if two devices edit the same version, keep both ("conflicted copy").

**On the canvas:** reads are "what changed?" and metadata lookups; writes are commits of new versions (2,500/s). Commits go to a queue; 4 workers (1,600/s) process chunks and update metadata.`,
    tryThis: [
      "How many workers stop the backlog growing?",
      "Run \"Cache restart\". Can the metadata database take every lookup?",
      "Add a read replica for metadata reads and run it again.",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["meta", "cache", { hitRatio: 0.7 }],
        ["db", "db", { size: "m" }],
        ["q", "queue"],
        ["chunks", "worker", { workers: 4 }],
      ],
      wires: "client>lb, lb>api1, lb>api2, api1>meta, api2>meta, api1>db, api2>db, api1>q, api2>q, q>chunks, chunks>db",
    }),
    traffic: { reads: 15_000, writes: 2_500, bots: 0 },
  },
  {
    id: "iv-payments",
    title: "Payment system",
    source: "Interview classic",
    blurb: "Charges run as a saga with no safeguards, and a ledger consumer records every one. Make it never double-charge.",
    lesson: "32.14",
    story: `**The question:** design a payment service: take a charge, call a card provider, record it - and never charge twice.

**Shape of the answer:**
- **Idempotency keys:** the client sends a key per payment; the server stores the result and returns it on retries.
- **Double-entry ledger:** every movement is two rows (debit and credit) that sum to zero; balances are derived.
- **Provider calls** time out and may have succeeded anyway - query before retrying; reconcile daily against provider reports.
- **Outbox:** write the payment and its event in one transaction, then publish.

**On the canvas:** writes are charges (800/s) run by a saga (reserve → charge → confirm) against the primary, publishing to Kafka; the ledger group writes entries. No safeguards are on yet.`,
    tryThis: [
      "Read the saga's line in the Guide. Which inconsistency is worst?",
      "Turn on idempotency keys and the outbox. How many inconsistent payments are left?",
      "Run \"Kill: Primary DB\" with failover off, then on.",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "m" }],
        ["api2", "server", { size: "m" }],
        ["saga", "saga"],
        ["db", "db", { size: "l" }],
        ["rep", "db", { size: "l", role: "replica" }],
        ["events", "kafka", { partitions: 4 }],
        ["ledger", "consumer", { consumers: 2 }],
      ],
      wires: "client>lb, lb>api1, lb>api2, api1>db, api2>db, api1>rep, api2>rep, api1>saga, api2>saga, saga>db, saga>events, events>ledger, ledger>db",
    }),
    traffic: { reads: 4_000, writes: 800, bots: 0 },
  },
  {
    id: "iv-leaderboard",
    title: "Leaderboard",
    source: "Interview classic",
    blurb: "Score updates go straight to the database at 5,000/s. Move the ranking into memory.",
    lesson: "32.15",
    story: `**The question:** design a real-time leaderboard for a game with 50M players: top 100, and "what's my rank?".

**Shape of the answer:**
- A Redis sorted set (\`ZADD\`, \`ZREVRANGE\`, \`ZREVRANK\`) answers both in O(log n). 50M members is a few GB - one node, or shard by score range or region.
- Keep the durable score history in a database, written asynchronously.
- Exact global rank for everyone is expensive; show exact top-N and approximate percentiles for the long tail.

**On the canvas:** reads are leaderboard views (25k/s), writes are score updates (5,000/s). Every update goes straight to the database (m, 4,000 writes/s).`,
    tryThis: [
      "The database is overloaded by writes. Add a queue and workers so scores are saved asynchronously.",
      "Or shard the database: how many shards keep it under 85%?",
      "Run a 2x spike at the end of a tournament. What breaks?",
    ],
    graph: build({
      nodes: [
        ["client", "client"],
        ["lb", "lb", { healthChecks: true }],
        ["api1", "server", { size: "l" }],
        ["api2", "server", { size: "l" }],
        ["api3", "server", { size: "l" }],
        ["ranks", "cache", { hitRatio: 0.95 }],
        ["db", "db", { size: "m" }],
      ],
      wires: "client>lb, lb>api1, lb>api2, lb>api3, api1>ranks, api2>ranks, api3>ranks, api1>db, api2>db, api3>db",
    }),
    traffic: { reads: 25_000, writes: 5_000, bots: 0 },
  },
];
