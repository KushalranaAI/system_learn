/* eslint-disable @typescript-eslint/no-explicit-any */
import { fmt } from "./types";

export interface SimExplain {
  /** what is being simulated, with the current settings */
  scenario: string;
  /** what the run showed */
  outcome: string;
  good: boolean;
  /** what to change if the result isn't good enough */
  fix?: string;
  /** what the fix (or the current choice) costs */
  tradeoff: string;
}

type Fn = (p: any, m: Record<string, number>) => SimExplain;

const pct = fmt.pct;
const usdShort = (v: number) => (!Number.isFinite(v) ? "-" : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);

export const EXPLAIN: Record<string, Fn> = {
  "push-vs-poll": (p, m) => ({
    scenario: `${fmt.n(p.users)} users watch a value that changes every ${p.updateEverySec} s, delivered by ${p.mode === "poll" ? `polling every ${p.pollEverySec} s` : p.mode === "sse" ? "Server-Sent Events" : "WebSockets"}.`,
    outcome:
      p.mode === "poll"
        ? `Your API answers ${fmt.n(m.requestsPerSec)} requests/s, and ${pct(m.wasted)} of them say "nothing new". Users see a change ${fmt.s(m.avgDelaySec)} late on average.`
        : `No polling load; changes arrive in ~${fmt.s(m.avgDelaySec)}. The gateways are ${pct(m.gatewayLoad)} full.`,
    good: p.mode === "poll" ? m.requestsPerSec <= 50000 && m.avgDelaySec <= 2 : m.gatewayLoad <= 0.8,
    fix: p.mode === "poll" ? "Switch to Server-Sent Events (one-way updates) and size the gateways with headroom." : m.gatewayLoad > 0.8 ? "Add gateways until they're under ~80% full, so one can die or be deployed." : undefined,
    tradeoff: p.mode === "poll" ? "Polling is simple and stateless; push needs long-lived connections, sticky gateways and reconnect logic." : "Push keeps a connection per user: memory, file descriptors and careful deploys.",
  }),
  "service-chain": (p, m) => ({
    scenario: `Each request calls ${p.services} services ${p.mode === "sequential" ? "one after another" : "in parallel"}; each has p50 ${p.p50} ms, p99 ${Math.round(p.p50 * p.tail)} ms and ${(p.availability * 100).toFixed(2)}% availability. ${p.critical} of them are essential.`,
    outcome: `p99 is ${fmt.ms(m.p99)} and ${fmt.pct2(m.success)} of requests succeed${m.degraded > 0 ? ` (${fmt.pct2(m.degraded)} with a fallback)` : ""}.`,
    good: m.p99 <= 250 && m.success >= 0.997,
    fix: "Mark only truly essential calls as critical, move side effects off the request path as events, call independent services in parallel, and give non-essential calls a timeout + fallback.",
    tradeoff: "Async side effects happen later (eventual); fallbacks show degraded results; parallel calls still wait for the slowest one.",
  }),
  "retry-storm": (p, m) => ({
    scenario: `${fmt.n(p.clientRps)} req/s hit a server that handles ${fmt.n(p.capacity)}/s. From t=30 to 45 s its capacity drops to ${Math.round(p.incidentFactor * 100)}%. Clients retry up to ${p.retries}× (${p.backoff === "none" ? "immediately" : "with exponential backoff"}${p.jitter ? ", jittered" : ""}).`,
    outcome: Number.isFinite(m.recovery)
      ? `It recovered ${fmt.s(m.recovery)} after capacity came back; peak load was ${fmt.x(m.amplification)} normal.`
      : `It never recovered: retries kept the offered load (${fmt.x(m.amplification)} normal at peak) above capacity, so every request kept timing out - a metastable failure.`,
    good: Number.isFinite(m.recovery) && m.recovery <= 10 && m.amplification <= 1.5,
    fix: "Retry less, back off exponentially with jitter, cap retries with a budget (~10% of traffic), shorten the server's queue so it sheds load, or add a client circuit breaker.",
    tradeoff: "Fewer retries mean a few more errors during real blips; a short queue rejects requests a long queue would have served (late).",
  }),
  quorum: (p, m) => ({
    scenario: `${p.n} replicas (${p.down} down). A write waits for ${p.w} acknowledgement${p.w > 1 ? "s" : ""}; a read asks ${p.r} replica${p.r > 1 ? "s" : ""}, ${p.readAfterMs} ms after the write, with ${p.lagMs} ms average replication lag.`,
    outcome: `${fmt.pct2(m.stale)} of reads were stale; writes available ${pct(m.writeAvail)}, reads ${pct(m.readAvail)}.`,
    good: m.stale <= 0.001 && m.writeAvail >= 0.99 && m.readAvail >= 0.99,
    fix: m.writeAvail < 0.99 || m.readAvail < 0.99 ? `W and R can't exceed the ${p.n - p.down} live replicas.` : "Make W + R greater than N so every read overlaps the latest write.",
    tradeoff: "Bigger W makes writes slower and less available; bigger R does the same for reads. W + R > N still doesn't resolve concurrent writes.",
  }),
  "hash-ring": (p, m) => ({
    scenario: `${fmt.n(p.keys)} keys on ${p.nodes} nodes using ${p.scheme === "modulo" ? "hash % N" : p.scheme === "ring" ? `a hash ring (${p.vnodes} virtual nodes each)` : "rendezvous hashing"}; then ${p.add} node(s) join.`,
    outcome: `${pct(m.moved)} of keys moved, and the busiest node carries ${fmt.x(m.imbalance)} the average load.`,
    good: m.moved <= 0.12 && m.imbalance <= 1.3,
    fix: m.moved > 0.12 ? "Use consistent hashing (a ring with ~100-256 virtual nodes) or rendezvous hashing." : p.skew > 0 && !p.saltHot ? "One popular key always lands on one node - salt the hottest keys across several nodes." : "Add virtual nodes to even out the ring.",
    tradeoff: "Virtual nodes cost a little memory and lookup time; salting a key means reading all its pieces.",
  }),
  "kafka-log": (p, m) => ({
    scenario: `${fmt.n(p.producerRps)} events/s into ${p.partitions} partitions, read by ${p.consumers} consumers doing ${fmt.n(p.perConsumerRps)} events/s each${p.hotKeyPct ? `; one key carries ${p.hotKeyPct}%` : ""}${p.crash ? "; a consumer crashes at t=40 s" : ""}.`,
    outcome: m.finalLag <= 1000 ? `Consumers keep up - at worst ${fmt.s(m.maxLagAge)} behind.` : `Lag grows to ${fmt.n(m.finalLag)} events (${fmt.s(m.maxLagAge)} behind)${m.idle > 0 ? `, while ${m.idle} consumers sit idle` : ""}.`,
    good: m.finalLag <= 1000 && m.maxLagAge <= 5,
    fix: m.idle > 0 ? "Consumers beyond the partition count can't help - add partitions." : p.hotKeyPct && !p.saltHotKey ? "The hot key's partition overloads one consumer: salt the key (or give it its own topic)." : p.crash && p.rebalance === "eager" ? "Use cooperative rebalancing so only the moved partitions pause." : "Add consumers (and partitions) until capacity beats the inflow on every partition.",
    tradeoff: "More partitions add overhead and reshuffle keys when changed; salting a key gives up its ordering.",
  }),
  saga: (p, m) => ({
    scenario: `${fmt.n(p.orders)} orders: ${p.stockFailPct}% out of stock, ${p.declinePct}% declined, ${p.timeoutPct}% ambiguous payment timeouts, ${p.crashPct}% crash between commit and publish, ${p.redeliverPct}% duplicate events.`,
    outcome: m.inconsistent > 0 ? `${fmt.pct2(m.inconsistent)} of orders ended inconsistent - see the bars for which kind.` : `Every order completed (${pct(m.completed)}) or was cleanly cancelled (${pct(m.cancelled)}).`,
    good: m.inconsistent <= 0,
    fix: "Turn on the mechanism for each bar: compensation (stock leaked), resolve timeouts + idempotency keys (charged), outbox (never shipped), consumer dedupe (shipped twice).",
    tradeoff: "Each safeguard adds a table, a lookup or a relay process - small compared with refunds and support tickets.",
  }),
  "event-windows": (p, m) => ({
    scenario: `Counting events per ${p.windowSec} s by ${p.mode === "event" ? "event time" : "arrival (processing) time"}. ${p.latePct}% of events arrive up to ${p.maxLateSec} s late.`,
    outcome: `Final counts are ${fmt.pct2(m.finalAccuracy)} accurate (first results ${fmt.pct2(m.firstAccuracy)}), available ${fmt.s(m.latency)} after each window; ${fmt.pct2(m.dropped)} of events were dropped as too late.`,
    good: m.finalAccuracy >= 0.995 && m.latency <= 10,
    fix: p.mode === "processing" ? "Window by event time - late events then count toward the minute they happened." : m.dropped > 0 ? "Allow more lateness so late events correct the result." : "Shorten the watermark for fresher first results.",
    tradeoff: "Allowed lateness keeps window state in memory longer and means results change after they're first shown.",
  }),
  bloom: (p, m) => ({
    scenario: `${fmt.n(p.n)} items in a ${p.bitsPerItem}-bits-per-item filter with ${p.k} hash function(s); 20,000 never-inserted items are tested.`,
    outcome: `${fmt.pct2(m.fp)} false positives (theory ${fmt.pct2(m.theory)}) using ${fmt.kb(m.memoryKB)}. Inserted items are never missed.`,
    good: m.fp <= 0.01 && m.memoryKB <= 14,
    fix: "About 10 bits per item with k ≈ 0.7 × bits gives ~1%.",
    tradeoff: "More bits cut false positives but cost memory; a plain Bloom filter can't delete items.",
  }),
  hyperloglog: (p, m) => ({
    scenario: `Counting ${fmt.n(p.distinct)} distinct users, each seen ${p.repeats}×, with 2^${p.p} registers.`,
    outcome: `Estimated ${fmt.n(m.estimate)} - ${fmt.pct2(m.error)} off - in ${fmt.kb(m.memoryKB)}.`,
    good: m.error <= 0.02,
    fix: "Raise p: error ≈ 1.04 / √(2^p). p = 12 gives ~1.6% in 3 KB.",
    tradeoff: "It's an estimate - fine for dashboards, not for billing.",
  }),
  "count-min": (p, m) => ({
    scenario: `${fmt.n(p.stream)} events over ${fmt.n(p.keys)} keys (skewed), counted in a ${p.width} × ${p.depth} grid.`,
    outcome: `Top-10 keys are overestimated by ${fmt.pct2(m.topError)}; rare keys by ${pct(m.tailError)}. Memory ${fmt.kb(m.memoryKB)}.`,
    good: m.topError <= 0.01,
    fix: "Widen the rows (error ≈ total ÷ width) and use a few rows so the minimum dodges collisions.",
    tradeoff: "Rare keys stay imprecise; it never undercounts but can overcount.",
  }),
  merkle: (p, m) => ({
    scenario: `Two replicas of ${fmt.n(p.keys)} keys differ in ${p.diffs}; the tree has 2^${p.leavesPow} leaf ranges.`,
    outcome: `${fmt.n(m.comparisons)} hashes compared and ${fmt.n(m.transferred)} keys sent - ${fmt.n(m.total)} total, versus ${fmt.n(p.keys)} to compare everything.`,
    good: m.total <= 1000,
    fix: "More leaves mean fewer keys sent per differing range (but more hashes to store and compare).",
    tradeoff: "Trees must be rebuilt or updated as data changes; very deep trees cost memory.",
  }),
  gossip: (p, m) => ({
    scenario: `${fmt.n(p.nodes)} nodes, each contacting ${p.fanout} random peer(s) per round (${p.mode === "push" ? "push" : "push-pull"}), with ${p.lossPct}% message loss.`,
    outcome: Number.isFinite(m.rounds) ? `Everyone knew after ${m.rounds} rounds.` : "Some nodes still hadn't heard after 60 rounds.",
    good: Number.isFinite(m.rounds) && m.rounds <= 8,
    fix: "Push-pull lets uninformed nodes ask, which fixes pure push's slow tail; a fanout of 2-3 is usually enough.",
    tradeoff: "Higher fanout spreads faster but sends more messages per node per round.",
  }),
  raft: (p, m) => ({
    scenario: `A ${p.nodes}-node cluster loses its leader${p.failed ? ` and ${p.failed} more node(s)` : ""}. Election timeouts are ${p.baseMs} ms + random 0-${p.spreadMs} ms; messages take ~${p.netMs} ms.`,
    outcome: m.failedPct > 0 ? `${pct(m.failedPct)} of elections found no leader within 3 s - candidates kept splitting the vote.` : `A new leader in ${fmt.ms(m.avg)} on average (p99 ${fmt.ms(m.p99)}); ${pct(m.splitPct)} needed more than one round.`,
    good: m.failedPct <= 0 && m.avg <= 300,
    fix: "Randomise the timeouts (a spread of ~100-150 ms) so one node usually starts well ahead of the others.",
    tradeoff: "Longer timeouts avoid false elections on slow networks but make real failovers slower.",
  }),
  "token-bucket": (p, m) => ({
    scenario: `Each client gets a bucket of ${p.capacity} tokens refilling at ${p.refill}/s. The app sends bursts of ${p.burst} every 10 s plus 1/s; an abuser sends ${p.abusiveRps}/s.`,
    outcome: `${pct(m.legit)} of the app's requests and ${pct(m.abusive)} of the abuser's get through.`,
    good: m.legit >= 0.99 && m.abusive <= 0.15,
    fix: "Capacity must fit a whole burst; the refill rate should cover the app's average but stay well below the abuser's rate.",
    tradeoff: "A big bucket lets abusers burst too; a low rate throttles legitimate heavy users.",
  }),
  "skip-list": (p, m) => ({
    scenario: `${fmt.n(p.n)} sorted elements in a skip list with promotion probability ${p.prob}.`,
    outcome: `A search takes ~${fmt.n(m.avgSteps)} steps over ${m.levels} levels, using ${m.pointersPerNode.toFixed(2)} pointers per element.`,
    good: true,
    tradeoff: "p = 1/4 uses fewer pointers (less memory) for a few more steps than p = 1/2.",
  }),
  "lsm-btree": (p, m) => ({
    scenario: `${fmt.n(p.keys)} ${p.pattern} inserts into a B-tree (${p.btreeCacheMB} MB buffer pool) and an LSM tree (${p.memtableMB} MB memtable, ×${p.fanout} levels${p.bloom ? ", Bloom filters" : ""}).`,
    outcome: `The B-tree wrote ${fmt.x(m.btreeWA)} the data, the LSM ${fmt.x(m.lsmWA)}. A lookup costs ${m.btreeReadIO.toFixed(2)} disk reads in the B-tree vs ${m.lsmReadIO.toFixed(2)} in the LSM.`,
    good: m.lsmReadIO <= 1.1,
    fix: m.lsmReadIO > 1.1 ? "Add a Bloom filter per LSM file so lookups skip files that can't hold the key." : p.pattern === "random" && m.btreeWA > 10 ? "Random keys make B-trees rewrite cold pages - more buffer pool, or time-ordered keys, help." : undefined,
    tradeoff: "LSMs win on heavy, random writes but pay with compaction work and multi-file reads; B-trees give steadier reads and simpler range scans.",
  }),
  geohash: (p, m) => ({
    scenario: `${fmt.n(p.drivers)} drivers in a ~33 × 33 km city; find everyone within ${p.radiusKm} km of 200 riders by ${p.mode === "scan" ? "checking every driver" : p.mode === "cell" ? `their geohash-${p.precision} cell` : `their geohash-${p.precision} cell plus 8 neighbours`}.`,
    outcome: `Found ${pct(m.recall)} of nearby drivers while checking ${pct(m.scanned)} of all drivers per query.`,
    good: m.recall >= 0.99 && m.scanned <= 0.25,
    fix: m.recall < 0.99 ? "Include the 8 neighbouring cells, and pick a precision whose cell is at least as big as the radius." : "Use a finer precision (more characters) to check fewer drivers.",
    tradeoff: "Bigger cells check more drivers; smaller cells miss drivers just across the edge unless you search more cells.",
  }),
  snowflake: (p, m) => ({
    scenario: `${p.workers} servers each make ${p.ratePerWorkerK}k IDs/s with ${p.seqBits} sequence bits; worker ids are ${p.workerIds}${p.clockJump ? "; one clock jumps back 5 ms" : ""}.`,
    outcome: `${fmt.n(m.duplicates)} duplicate IDs; an ID waits ${m.avgWaitMs.toFixed(2)} ms on average; ${pct(m.collisionRisk)} chance two servers share a worker id.`,
    good: m.duplicates === 0 && m.avgWaitMs <= 0.1 && m.collisionRisk <= 0.001,
    fix: [m.avgWaitMs > 0.1 && "Add sequence bits (each bit doubles IDs per ms).", m.collisionRisk > 0.001 && "Assign worker ids uniquely (config or a lease).", m.duplicates > 0 && p.clockJump && p.onBackwards === "ignore" && "Wait when the clock goes backwards instead of reusing old milliseconds."].filter(Boolean).join(" ") || undefined,
    tradeoff: "Sequence bits come out of worker bits: more IDs per ms means fewer possible workers.",
  }),
  wal: (p, m) => ({
    scenario: `${p.clients} clients commit to a log on a disk whose fsync takes ~${p.fsyncMs} ms, using ${p.mode === "each" ? "one fsync per commit" : p.mode === "group" ? `group commit (${p.windowMs} ms window)` : "no fsync before acknowledging"}.`,
    outcome: `${fmt.n(m.commitsPerSec)} commits/s, p99 ${m.p99.toFixed(m.p99 < 10 ? 2 : 0)} ms${m.lostOnCrash > 0 ? `, but a crash would lose ~${fmt.n(m.lostOnCrash)} acknowledged commits` : ", nothing lost on a crash"}.`,
    good: m.commitsPerSec >= 5000 && m.lostOnCrash <= 0 && m.p99 <= 20,
    fix: m.lostOnCrash > 0 ? "Acknowledge only after the data is durable - use group commit instead." : "Group commit lets one fsync cover every commit waiting, so throughput scales with concurrency.",
    tradeoff: "A group window adds a little latency to each commit; async commits are fastest but can lose data.",
  }),
  "cache-stampede": (p, m) => ({
    scenario: `${fmt.n(p.rps)} reads/s over ${fmt.n(p.keys)} hot keys cached for ${p.ttlSec} s (±${p.jitterPct}%), in front of a database that answers ${fmt.n(p.dbCapacity)} queries/s${p.coldRestart ? "; the cache restarts empty at t=150 s" : ""}.`,
    outcome: m.peak > 1 ? `The database peaked at ${fmt.x(m.peak)} its capacity and ${fmt.pct2(m.failedPct)} of requests failed - keys expiring together (or a cold cache) caused a stampede.` : `The database peaked at ${pct(m.peak)} of capacity; ${fmt.pct2(m.failedPct)} failed.`,
    good: m.peak <= 1 && m.failedPct <= 0.001,
    fix: "Add TTL jitter so keys expire at different times, coalesce misses so each key costs one query, and serve stale while refreshing.",
    tradeoff: "Jitter makes freshness less predictable; stale-while-revalidate shows slightly old data; coalescing adds waiting for the first request.",
  }),
  "llm-batching": (p, m) => ({
    scenario: `A ${p.model === "70b" ? "70B" : "8B"} model on ${p.gpus} GPU${p.gpus === 1 ? "" : "s"}, up to ${p.batch} sequence${p.batch === 1 ? "" : "s"} decoding together; each request has a ${fmt.n(p.promptTokens)}-token prompt and a ${fmt.n(p.outputTokens)}-token answer.`,
    outcome: !m.fits
      ? "The model's weights don't fit on these GPUs with room left for any KV cache, so it can't serve at all."
      : `The replica produces ${fmt.n(m.tokensPerSec)} tokens/s (${m.reqPerSec.toFixed(1)} requests/s) at ${usdShort(m.costPerM)} per million tokens. Each user sees ${fmt.n(m.userTps)} tokens/s, first token after ${fmt.ms(m.ttftMs)}.`,
    good: m.fits === 1 && m.tokensPerSec >= 2000 && m.userTps >= 20,
    fix: !m.fits ? "Add GPUs (tensor parallelism) or pick the smaller model." : m.userTps < 20 ? "The batch is so big each user's stream crawls - lower it, or add replicas." : "Raise the batch size: one decode step reads all the weights anyway, so more sequences per step are nearly free.",
    tradeoff: "Bigger batches cut cost per token but slow every user's stream and need KV-cache memory for each sequence; long prompts delay the first token for everyone sharing the GPU.",
  }),
  "kv-cache": (p, m) => ({
    scenario: `A ${p.model === "8b" ? "8B" : "70B"} model in ${p.weightBits}-bit weights on ${p.gpus} × ${p.gpuMemGB} GB GPUs, ${fmt.n(p.contextTokens)}-token max context, ${p.allocation === "paged" ? "PagedAttention" : "contiguous"} KV allocation; you need ${p.targetSeqs} conversations at once.`,
    outcome: m.maxSeqs < 1
      ? `It doesn't fit: the ${Math.round(m.weightsGB)} GB of weights leave no room for even one sequence's KV cache.`
      : `${fmt.n(m.maxSeqs)} sequences fit (${m.kvPerSeqGB.toFixed(2)} GB of KV cache each)${m.fits ? "" : ` - short of the ${p.targetSeqs} you need`}. ${pct(m.waste)} of reserved KV memory is never used.`,
    good: m.fits === 1,
    fix: p.allocation === "contiguous" ? "Switch to PagedAttention so each conversation only holds the blocks it actually uses." : p.kvBits === 16 ? "Store the KV cache in FP8 (half the memory per token), or add GPUs." : "Quantise the weights, shorten the max context, or add GPUs.",
    tradeoff: "Lower precision saves memory at a small quality cost; shorter max context limits long documents; more GPUs cost money and add communication overhead.",
  }),
  "semantic-cache": (p, m) => ({
    scenario: `${p.repeatPct}% of questions repeat an earlier one in other words. A question gets a cached answer when its embedding's cosine similarity to a cached question is at least ${p.threshold}.`,
    outcome: `${pct(m.hitRate)} of questions hit the cache, saving ${pct(m.costSaved)} of model cost (average latency ${fmt.ms(m.avgLatencyMs)}) - but ${fmt.pct2(m.wrongRate)} of all answers were cached for a different question.`,
    good: m.wrongRate <= 0.01 && m.hitRate >= 0.25,
    fix: m.wrongRate > 0.01 ? "Raise the threshold: look-alike questions with different answers are slipping through." : "Lower the threshold a little: you're missing genuine repeats.",
    tradeoff: "A higher threshold is safer but saves less; scope the cache by tenant and language, and don't cache personal or time-sensitive answers at all.",
  }),
  "model-cascade": (p, m) => ({
    scenario: p.mode === "cascade"
      ? `Every request goes to a small model first; answers with confidence below ${p.threshold} escalate to the large model. ${p.hardPct}% of requests are hard.`
      : `Every request goes to the ${p.mode} model. ${p.hardPct}% of requests are hard.`,
    outcome: `${pct(m.quality)} correct at ${pct(m.costVsLarge)} of the large-only cost, ${fmt.ms(m.avgLatencyMs)} on average${p.mode === "cascade" ? `; ${pct(m.escalated)} escalated` : ""}.`,
    good: m.quality >= 0.94 && m.costVsLarge <= 0.5,
    fix: p.mode === "large" ? "Try a cascade: most requests are easy and the small model gets them right." : p.mode === "small" ? "Escalate low-confidence answers to the large model (cascade)." : m.quality < 0.94 ? "Raise the threshold so more doubtful answers escalate." : "Lower the threshold so fewer requests pay for both models.",
    tradeoff: "Escalated requests pay for both models and wait for both; the cascade is only as good as the small model's confidence signal.",
  }),
  "rag-retrieval": (p, m) => ({
    scenario: `Help-centre articles split into ${p.chunkTokens}-token chunks with ${p.overlapPct}% overlap; the top ${p.topK} chunks${p.hybrid ? " from hybrid (BM25 + vector) search" : " from vector search"}${p.reranker ? ", reranked by a cross-encoder," : ""} go into the prompt.`,
    outcome: `The answer is in the prompt for ${pct(m.recall)} of questions, using ${fmt.n(m.contextTokens)} context tokens and ${usdShort(m.costPer1k)} per 1,000 queries.`,
    good: m.recall >= 0.9 && m.contextTokens <= 2500,
    fix: m.recall < 0.9 ? "Use chunks of a few hundred tokens with ~15-20% overlap, add hybrid search for exact terms, and rerank the top 50." : "Cut k: you're paying for context the model doesn't need.",
    tradeoff: "More chunks raise recall but cost tokens, latency and distract the model; a reranker adds ~100 ms and a little cost per query.",
  }),
  "ann-index": (p, m) => ({
    scenario: `${fmt.n(p.vectors)} vectors of ${p.dims} dimensions, searched ${p.mode === "exact" ? "exactly (brute force)" : `with HNSW (M = ${p.m}, efSearch = ${p.efSearch})`}.`,
    outcome: `Recall@10 is ${pct(m.recall)} at ${m.latencyMs < 10 ? `${m.latencyMs.toFixed(2)} ms` : fmt.ms(m.latencyMs)} per query on one core, using ${m.memoryGB.toFixed(1)} GB.`,
    good: m.recall >= 0.95 && m.latencyMs <= 5,
    fix: p.mode === "exact" ? "Switch to an HNSW index: it checks a few thousand vectors instead of all of them." : m.recall < 0.95 ? "Raise efSearch (or M) until recall is high enough." : "Lower efSearch to trade a little recall for speed.",
    tradeoff: "Higher efSearch and M raise recall but cost latency (and M costs memory); at very large scale, quantisation or disk-based indexes trade some recall for memory.",
  }),
  "agent-reliability": (p, m) => ({
    scenario: `An agent task needs ${p.steps} steps that each succeed ${pct(p.stepSuccess)} of the time${p.verify ? `, each verified and retried up to ${p.retries}×` : ", with no verification"}; step limit ${p.stepLimit >= 100 ? "off" : p.stepLimit}.`,
    outcome: `${pct(m.success)} of tasks end correct, ${pct(m.silentWrong)} end wrong while reporting success, ${pct(m.aborted)} hit the step limit. ${m.avgCalls.toFixed(1)} steps on average, ${fmt.n(m.p99Calls)} at p99; $${m.costPerTask.toFixed(3)} per task.`,
    good: m.success >= 0.85 && m.silentWrong <= 0.08 && m.p99Calls <= 30,
    fix: !p.verify ? "Verify each step (tests, schemas, a checker) and retry the ones that fail." : m.p99Calls > 30 ? "Set a step limit so looping runs stop instead of burning calls." : "Fewer steps, a better model per step, or more retries.",
    tradeoff: "Verification and retries add calls, cost and latency; a step limit fails a few long tasks that might have finished.",
  }),
  "staged-rollout": (p, m) => ({
    scenario: `A bad change ships ${p.strategy === "global" ? "to the whole fleet at once" : p.strategy === "canary" ? `to a ${p.canaryPct}% canary, then everyone after ${p.bakeMin} min` : `in ${p.waves} waves starting at ${p.canaryPct}%, ${p.bakeMin} min apart`}. It's detected after ${p.detectMin} min and rolled back ${p.autoRollback ? "automatically" : `by hand ${p.manualMin} min later`}.`,
    outcome: `At worst ${pct(m.peakAffected)} of the fleet was broken; impact was ${m.impactHours.toFixed(2)} whole-fleet hours${Number.isFinite(m.mitigatedMin) ? `, fully recovered after ${Math.round(m.mitigatedMin)} min` : " and broken hosts still need hands-on repair after 6 hours"}.`,
    good: m.peakAffected <= 0.05 && m.impactHours <= 0.1,
    fix: p.strategy === "global" ? "Release in stages: a small canary first, with bake time longer than your time to detect." : m.peakAffected > 0.05 ? "Make the bake time longer than detection, or the first stage smaller." : "Turn on automatic rollback.",
    tradeoff: "Staged rollouts take hours; urgent fixes (security content) need a fast path that is still staged, just quicker.",
  }),
};
