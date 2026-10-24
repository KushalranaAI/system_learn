import {
  BOT_IPS,
  KINDS,
  NAT_IP_RPS,
  NAT_SHARE,
  USER_IP_RPS,
  cacheCap,
  workerCap,
  dbSize,
  hopP99,
  nodeMonthlyUsd,
  nodeTitle,
  serverSize,
  shardFactor,
  consumerCap,
  PARTITION_CAP,
} from "./catalog";
import { SAGA_CAUSES, sagaOutcome } from "./saga";
import type {
  Conditions,
  EdgeResult,
  Graph,
  Issue,
  NodeResult,
  SimNode,
  SimResult,
  Traffic,
} from "./types";

/**
 * Steady-state flow solver.
 *
 * Traffic is a set of "bundles" (a request class, a rate, and the latency
 * accumulated so far). Bundles enter at the client and move along the graph in
 * topological order. Each node:
 *   1. adds up its inbound load and computes utilisation = load / capacity,
 *   2. serves min(load, capacity) and drops the rest (counted as failures),
 *   3. adds its own queueing latency (M/M/1 p99) to every bundle it serves,
 *   4. either completes a bundle (it answered the request) or routes it on.
 *
 * `simulate` runs the solver twice: the second pass reuses utilisations from
 * the first for the two places that depend on downstream state (cache-miss
 * latency and replication load on replicas).
 */

type Cls = "read" | "write" | "bot" | "job" | "event";

interface Bundle {
  cls: Cls;
  rps: number;
  lat: number;
  /** load-only traffic (cache lookups that miss) - never "completes" */
  probe?: boolean;
}

interface Memo {
  util: Record<string, number>;
  primaryWrites: number;
}

export const DEFAULT_CONDITIONS: Conditions = {
  down: [],
  cacheWarm: 1,
  promoted: false,
  dbFailover: false,
  backlogDrain: 0,
  lagDrain: {},
};

const sum = (bs: Bundle[]) => bs.reduce((a, b) => a + b.rps, 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;
export const fmtRps = (x: number) =>
  x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}k` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : `${Math.round(x)}`;

function solveOnce(graph: Graph, traffic: Traffic, cond: Conditions, memo?: Memo): { result: SimResult; memo: Memo } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = graph.edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  const outs = (id: string) => edges.filter((e) => e.from === id);
  const isDown = (id: string) => cond.down.includes(id);
  const title = (n: SimNode) => nodeTitle(n, graph.nodes);

  const nodes: Record<string, NodeResult> = {};
  for (const n of graph.nodes) nodes[n.id] = { load: 0, util: 0, served: 0, dropped: 0, p99Ms: 0, down: isDown(n.id) };
  const edgeRes: Record<string, EdgeResult> = {};
  for (const e of edges) edgeRes[e.id] = { rps: 0, dropShare: 0 };
  const issues: Issue[] = [];
  const issue = (severity: Issue["severity"], text: string, nodeId?: string) => issues.push({ severity, text, nodeId });

  const success = { read: 0, write: 0 };
  const samples: { rps: number; lat: number }[] = [];
  let legitLimited = 0;
  let botsBlocked = 0;
  let botsServed = 0;
  let queueIn = 0;
  let jobsDone = 0;
  let eventsIn = 0;
  let lagGrowth = 0;
  let inconsistent = 0;
  let sagaOrders = 0;
  const sagaCauses: Record<string, number> = {};
  let primaryWrites = 0;

  const legit = traffic.reads + traffic.writes;
  const empty = (): SimResult => ({
    legit, success: 0, successRate: legit > 0 ? 0 : 1, failed: legit, legitLimited: 0,
    bots: traffic.bots, botsBlocked: 0, botsServed: 0, p99: 0, lagMs: 0, stale: 0,
    queueIn: 0, jobsDone: 0, eventsIn: 0, lagGrowth: 0, inconsistent: 0, sagaOrders: 0, monthlyUsd: graph.nodes.reduce((a, n) => a + nodeMonthlyUsd(n), 0),
    nodes, edges: edgeRes, issues,
  });

  const client = graph.nodes.find((n) => n.kind === "client");
  if (!client) {
    issue("error", "Add a client - it's where requests come from.");
    return { result: empty(), memo: { util: {}, primaryWrites: 0 } };
  }

  // Which database takes writes right now.
  const graphPrimary = graph.nodes.find((n) => n.kind === "db" && n.config.role !== "replica");
  let primary = graphPrimary;
  if (graphPrimary && isDown(graphPrimary.id)) {
    const replica = graph.nodes.find((n) => n.kind === "db" && n.config.role === "replica" && !isDown(n.id));
    if (cond.dbFailover && cond.promoted && replica) {
      primary = replica;
      issue("info", `The primary database died. Failover promoted ${title(replica)} - it takes writes now.`, replica.id);
    } else if (cond.dbFailover && replica) {
      issue("error", "The primary database is down. Failover is detecting it and will promote a replica - writes fail until then.", graphPrimary.id);
    } else if (!replica) {
      issue("error", "The primary database is down and there is no replica to promote. Every write fails.", graphPrimary.id);
    } else {
      issue("error", "The primary database is down and nothing takes over - every write fails. Turn on automatic failover.", graphPrimary.id);
    }
  }

  // Topological order (the wiring rules keep the graph acyclic).
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const order: string[] = [];
  const ready = graph.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const e of outs(id)) {
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) ready.push(e.to);
    }
  }
  for (const n of graph.nodes) if (!order.includes(n.id)) order.push(n.id);

  const inbox = new Map<string, Bundle[]>();
  const send = (from: string, to: string, b: Bundle) => {
    if (b.rps <= 0) return;
    const e = edges.find((x) => x.from === from && x.to === to);
    if (e) edgeRes[e.id].rps += b.rps;
    const list = inbox.get(to) ?? [];
    list.push(b);
    inbox.set(to, list);
  };
  const complete = (b: Bundle) => {
    if (b.probe || b.rps <= 0) return;
    if (b.cls === "read" || b.cls === "write") {
      success[b.cls] += b.rps;
      samples.push({ rps: b.rps, lat: b.lat });
    } else if (b.cls === "bot") botsServed += b.rps;
    else if (b.cls === "job") jobsDone += b.rps;
  };

  inbox.set(client.id, [
    { cls: "read" as Cls, rps: traffic.reads, lat: 0 },
    { cls: "write" as Cls, rps: traffic.writes, lat: 0 },
    { cls: "bot" as Cls, rps: traffic.bots, lat: 0 },
  ].filter((b) => b.rps > 0));

  for (const id of order) {
    const n = byId.get(id)!;
    const r = nodes[id];
    const inb = inbox.get(id) ?? [];
    const total = sum(inb);
    r.load = total;

    if (n.kind !== "client" && total === 0) {
      if (!edges.some((e) => e.to === id) && !(n.kind === "db" && n.config.role === "replica" && graphPrimary))
        issue("warn", `${title(n)} isn't wired to anything upstream - it gets no traffic.`, id);
      if (n.kind !== "db") continue;
    }

    if (r.down) {
      r.dropped = total;
      continue;
    }

    // Consumer groups don't drop events - whatever they can't process this second waits as lag.
    if (n.kind === "consumer") {
      const kafkaEdge = edges.find((e) => e.to === id && byId.get(e.from)?.kind === "kafka");
      const topic = kafkaEdge ? byId.get(kafkaEdge.from)! : undefined;
      const P = Math.max(1, topic?.config.partitions ?? 1);
      const hot = Math.min(0.99, (topic?.config.hotKeyPct ?? 0) / 100);
      const C = Math.max(1, n.config.consumers ?? 1);
      const perPartitionCap = consumerCap() * Math.min(1, C / P);
      const inflow = total;
      const waiting = cond.lagDrain[id] ?? 0;
      let processed = 0;
      let worst = 0;
      for (let p = 0; p < P; p++) {
        const share = (1 - hot) / P + (p === 0 ? hot : 0);
        processed += Math.min((inflow + waiting) * share, perPartitionCap);
        worst = Math.max(worst, (inflow * share) / perPartitionCap);
      }
      r.util = worst;
      r.served = processed;
      r.dropped = 0;
      r.p99Ms = 0;
      r.idle = Math.max(0, C - P);
      r.lagGrowth = inflow - processed;
      lagGrowth += Math.max(0, r.lagGrowth);
      if (r.idle > 0) issue("info", `${title(n)}: ${r.idle} of ${C} consumers sit idle - a topic with ${P} partitions can feed at most ${P}.`, id);
      if (r.lagGrowth > 0.5) {
        const hotBound = hot > 0 && inflow * (hot + (1 - hot) / P) > perPartitionCap;
        issue(
          "warn",
          hotBound
            ? `${title(n)} falls behind by ${fmtRps(r.lagGrowth)} events/s: the hot key's partition gets more than one consumer can handle. More consumers won't help - spread the key.`
            : `${title(n)} falls behind by ${fmtRps(r.lagGrowth)} events/s - lag grows every second. Add consumers (and partitions if all are busy).`,
          id,
        );
      }
      const outsC = outs(id).map((e) => byId.get(e.to)!);
      const dbOut = outsC.find((k) => k.kind === "db" && k.id === primary?.id && !isDown(k.id));
      const cacheOut = outsC.find((k) => k.kind === "cache" && !isDown(k.id));
      if (dbOut) send(id, dbOut.id, { cls: "job", rps: processed, lat: 0 });
      if (cacheOut) send(id, cacheOut.id, { cls: "read", rps: processed, lat: 0, probe: true });
      continue;
    }

    // 1-3: utilisation, serve or drop, add latency.
    let util = 0;
    if (n.kind === "server") util = total / serverSize(n.config.size).cap;
    else if (n.kind === "db") {
      const reads = inb.filter((b) => b.cls === "read" || b.cls === "bot").reduce((a, b) => a + b.rps, 0);
      const writes = inb.filter((b) => b.cls === "write" || b.cls === "job").reduce((a, b) => a + b.rps, 0);
      const replicated = n.config.role === "replica" && primary?.id !== id ? memo?.primaryWrites ?? 0 : 0;
      const size = dbSize(n.config.size);
      const k = shardFactor(n.config.shards);
      util = reads / (size.readCap * k) + (writes + replicated) / (size.writeCap * k);
      r.reads = reads;
      r.writes = writes + replicated;
      r.load = total + replicated;
    } else if (n.kind === "worker") util = total / (workerCap() * Math.max(1, n.config.workers ?? 1));
    else if (n.kind === "cache") util = total / cacheCap();
    else if (n.kind === "kafka") util = total / (PARTITION_CAP * Math.max(1, n.config.partitions ?? 1));
    else if (n.kind !== "client") util = total / KINDS[n.kind].cap;

    const f = util > 1 ? 1 / util : 1;
    const hop = hopP99(KINDS[n.kind].ms, util);
    r.util = util;
    r.served = total * f;
    r.dropped = total * (1 - f);
    r.p99Ms = hop;
    const passed = inb.map((b) => ({ ...b, rps: b.rps * f, lat: b.lat + (b.cls === "job" || b.cls === "event" ? 0 : hop) }));

    const out = outs(id);
    const kids = out.map((e) => byId.get(e.to)!);
    const forwardAll = (bs: Bundle[], what: string) => {
      if (!out.length) {
        if (sum(bs) > 0) issue("error", `${title(n)} isn't wired to ${what} - its requests go nowhere.`, id);
        return;
      }
      for (const b of bs) send(id, out[0].to, b);
    };

    switch (n.kind) {
      case "client":
        forwardAll(passed, "anything");
        break;

      case "cdn": {
        const hit = n.config.hitRatio ?? 0.6;
        const rest: Bundle[] = [];
        for (const b of passed) {
          if (b.cls === "read") {
            complete({ ...b, rps: b.rps * hit });
            rest.push({ ...b, rps: b.rps * (1 - hit) });
          } else rest.push(b);
        }
        forwardAll(rest, "an origin (limiter, load balancer or API server)");
        break;
      }

      case "limiter": {
        const L = n.config.limitPerIp ?? 0;
        const botRps = passed.filter((b) => b.cls === "bot").reduce((a, b) => a + b.rps, 0);
        let botPass = 1;
        let legitLoss = 0;
        if (L > 0) {
          botPass = botRps > 0 ? Math.min(1, L / (botRps / BOT_IPS)) : 1;
          legitLoss = NAT_SHARE * Math.max(0, 1 - L / NAT_IP_RPS) + (1 - NAT_SHARE) * Math.max(0, 1 - L / USER_IP_RPS);
          if (legitLoss > 0.005)
            issue("warn", `At ${L} req/s per IP, ${(legitLoss * 100).toFixed(1)}% of real users get 429s - offices and mobile carriers share one IP.`, id);
          if (botRps > 0 && botPass > 0.2)
            issue("warn", `The scraper still gets ${pct(botPass)} of its traffic through at ${L} req/s per IP. Lower the limit.`, id);
        } else if (botRps > 0) issue("warn", "The rate limiter is off - set a per-IP limit in the inspector.", id);
        const rest: Bundle[] = [];
        for (const b of passed) {
          if (b.cls === "bot") {
            botsBlocked += b.rps * (1 - botPass);
            rest.push({ ...b, rps: b.rps * botPass });
          } else if (b.cls === "read" || b.cls === "write") {
            legitLimited += b.rps * legitLoss;
            rest.push({ ...b, rps: b.rps * (1 - legitLoss) });
          } else rest.push(b);
        }
        forwardAll(rest, "a load balancer or API server");
        break;
      }

      case "lb": {
        const hc = !!n.config.healthChecks;
        const targets = hc ? out.filter((e) => !isDown(e.to)) : out;
        if (!out.length) issue("error", "The load balancer isn't wired to any API server.", id);
        else if (!targets.length) issue("error", "Every API server behind the load balancer is down.", id);
        else if (!hc && out.some((e) => isDown(e.to)))
          issue("error", `An API server is down, but the load balancer still sends it 1/${out.length} of the traffic - those requests fail. Turn on health checks.`, id);
        else if (hc && out.some((e) => isDown(e.to)))
          issue("info", "Health checks took the dead API server out of rotation - the others carry its share.", id);
        for (const b of passed) for (const t of targets) send(id, t.to, { ...b, rps: b.rps / targets.length });
        break;
      }

      case "server": {
        const cache = kids.find((k) => k.kind === "cache");
        const queue = kids.find((k) => k.kind === "queue");
        const sagaKid = kids.find((k) => k.kind === "saga" && !isDown(k.id));
        const topic = kids.find((k) => k.kind === "kafka" && !isDown(k.id));
        const dbs = kids.filter((k) => k.kind === "db");
        const readDbs = dbs.filter((d) => !(cond.dbFailover && isDown(d.id)));
        if (!dbs.length && !cache) issue("error", `${title(n)} has no database - there's nowhere to read or store data.`, id);
        else if (!dbs.length && !sagaKid) issue("error", `${title(n)} has no database - every cache miss and write fails.`, id);
        let warnedWrite = false;
        for (const b of passed) {
          if (b.cls === "read" || b.cls === "bot") {
            let misses = b.rps;
            let missLat = b.lat;
            if (cache && !isDown(cache.id)) {
              const hitR = b.cls === "read" ? (cache.config.hitRatio ?? 0.8) * cond.cacheWarm : 0;
              send(id, cache.id, { ...b, rps: b.rps * hitR });
              misses = b.rps * (1 - hitR);
              send(id, cache.id, { ...b, rps: misses, probe: true });
              missLat = b.lat + hopP99(KINDS.cache.ms, memo?.util[cache.id] ?? 0);
            }
            if (readDbs.length) for (const d of readDbs) send(id, d.id, { ...b, rps: misses / readDbs.length, lat: missLat });
          } else if (b.cls === "write") {
            if (topic && !sagaKid) send(id, topic.id, { cls: "event", rps: b.rps, lat: 0 });
            if (sagaKid) send(id, sagaKid.id, b);
            else if (queue && !isDown(queue.id)) send(id, queue.id, b);
            else if (primary && dbs.some((d) => d.id === primary!.id) && !isDown(primary.id)) send(id, primary.id, b);
            else if (dbs.length && !warnedWrite && !(graphPrimary && isDown(graphPrimary.id))) {
              warnedWrite = true;
              issue("error", `${title(n)} isn't wired to the primary database - replicas are read-only, so its writes fail.`, id);
            }
          }
        }
        if (cache && isDown(cache.id) && passed.some((b) => b.cls === "read"))
          issue("warn", "The cache is down - every read falls through to the database.", cache.id);
        break;
      }

      case "cache":
        for (const b of passed) complete(b);
        break;

      case "db":
        for (const b of passed) complete(b);
        if (primary?.id === id) primaryWrites += passed.filter((b) => b.cls === "write" || b.cls === "job").reduce((a, b) => a + b.rps, 0);
        break;

      case "queue": {
        let jobs = cond.backlogDrain;
        for (const b of passed) {
          if (b.cls === "write") {
            complete(b);
            queueIn += b.rps;
            jobs += b.rps;
          }
        }
        const workers = kids.filter((k) => k.kind === "worker");
        if (!workers.length) {
          if (jobs > 0) issue("warn", "Nothing reads from the queue - jobs pile up forever. Wire it to workers.", id);
        } else for (const w of workers) send(id, w.id, { cls: "job", rps: jobs / workers.length, lat: 0 });
        break;
      }

      case "saga": {
        const steps = Math.max(1, n.config.sagaSteps ?? 3);
        const dbs = kids.filter((k) => k.kind === "db");
        const target = dbs.find((d) => d.id === primary?.id && !isDown(d.id));
        const topicOut = kids.find((k) => k.kind === "kafka" && !isDown(k.id));
        const outcome = sagaOutcome(n.config);
        if (!dbs.length) issue("error", "The saga has no database to run its steps against - every order fails.", id);
        else if (!target && !(graphPrimary && isDown(graphPrimary.id))) issue("error", "The saga isn't wired to the primary database.", id);
        for (const b of passed) {
          if (b.cls !== "write") continue;
          sagaOrders += b.rps;
          if (!target) continue;
          send(id, target.id, { cls: "write", rps: b.rps * steps, lat: b.lat, probe: true });
          const dbUtil = memo?.util[target.id] ?? 0;
          const dbF = dbUtil > 1 ? 1 / dbUtil : 1;
          complete({ ...b, rps: b.rps * dbF, lat: b.lat + steps * hopP99(KINDS.db.ms, dbUtil) });
          inconsistent += b.rps * dbF * outcome.inconsistent;
          for (const c of SAGA_CAUSES) sagaCauses[c] = (sagaCauses[c] ?? 0) + b.rps * dbF * outcome.causes[c];
          if (topicOut) send(id, topicOut.id, { cls: "event", rps: b.rps * dbF, lat: 0 });
        }
        break;
      }

      case "kafka": {
        const events = passed.filter((b) => b.cls === "event").reduce((a, b) => a + b.rps, 0);
        eventsIn += events;
        const groups = kids.filter((k) => k.kind === "consumer");
        if (!groups.length && events > 0) issue("info", `${title(n)} receives ${fmtRps(events)} events/s but no consumer group reads them yet.`, id);
        for (const g of groups) send(id, g.id, { cls: "event", rps: events, lat: 0 });
        break;
      }

      case "worker": {
        const dbs = kids.filter((k) => k.kind === "db");
        const target = dbs.find((d) => d.id === primary?.id && !isDown(d.id));
        if (!dbs.length) issue("error", "The workers have no database to write results to.", id);
        else if (!target && !(graphPrimary && isDown(graphPrimary.id))) issue("error", "The workers aren't wired to the primary database.", id);
        if (target) for (const b of passed) send(id, target.id, b);
        break;
      }
    }
  }

  // Aggregate.
  const ok = success.read + success.write;
  const failed = Math.max(0, legit - ok - legitLimited);

  const sorted = [...samples].sort((a, b) => b.lat - a.lat);
  let p99 = 0;
  let acc = 0;
  for (const s of sorted) {
    acc += s.rps;
    p99 = s.lat;
    if (acc >= 0.01 * ok) break;
  }

  let lagMs = 0;
  let stale = 0;
  const replicas = graph.nodes.filter((n) => n.kind === "db" && n.id !== primary?.id && !isDown(n.id));
  if (primary && replicas.length) {
    const wUtil = primaryWrites / (dbSize(primary.config.size).writeCap * shardFactor(primary.config.shards));
    lagMs = 20 / (1 - Math.min(0.95, wUtil));
    const replicaReads = replicas.reduce((a, d) => a + (nodes[d.id].reads ?? 0), 0);
    stale = replicaReads * 0.02 * Math.min(1, lagMs / 100);
  }

  for (const n of graph.nodes) {
    const r = nodes[n.id];
    if (r.down) {
      issue("error", `${title(n)} is down.`, n.id);
      continue;
    }
    if (n.kind === "worker") {
      if (r.util > 1) issue("warn", `The workers can't keep up - the queue grows by ${fmtRps(r.dropped)} jobs/s. Add workers.`, n.id);
      continue;
    }
    if (r.util > 1) issue("error", `${title(n)} is overloaded (${pct(r.util)}) and drops ${fmtRps(r.dropped)} req/s.`, n.id);
    else if (r.util > 0.85) issue("warn", `${title(n)} is at ${pct(r.util)} - past ~85%, requests queue up and latency climbs steeply.`, n.id);
  }
  if (replicas.length && primary && primaryWrites / (dbSize(primary.config.size).writeCap * shardFactor(primary.config.shards)) > 0.6)
    issue("info", "Replicas replay every write the primary takes - they add read capacity, not write capacity.");
  if (stale > 1) issue("info", `About ${fmtRps(stale)} reads/s see stale data: replicas are ~${Math.round(lagMs)} ms behind the primary.`);
  if (traffic.bots > 0 && botsServed > traffic.bots * 0.2 && !graph.nodes.some((n) => n.kind === "limiter"))
    issue("warn", `A scraper sends ${fmtRps(traffic.bots)} req/s for random URLs - they miss every cache and hit your database. Put a rate limiter in front.`);

  if (inconsistent > 0.01) {
    const worst = Object.entries(sagaCauses).sort((a, b) => b[1] - a[1])[0];
    issue("error", `${fmtRps(inconsistent)} orders/s end inconsistent - mostly "${worst[0]}". Turn on the saga's safeguards in the inspector.`);
  }

  for (const e of edges) {
    const t = nodes[e.to];
    edgeRes[e.id].dropShare = t.down ? 1 : t.load > 0 ? t.dropped / t.load : 0;
  }

  const order2 = { error: 0, warn: 1, info: 2 };
  const seen = new Set<string>();
  const uniq = issues
    .filter((i) => (seen.has(i.text) ? false : (seen.add(i.text), true)))
    .sort((a, b) => order2[a.severity] - order2[b.severity]);

  const result: SimResult = {
    legit,
    success: ok,
    successRate: legit > 0 ? ok / legit : 1,
    failed,
    legitLimited,
    bots: traffic.bots,
    botsBlocked,
    botsServed,
    p99: Math.round(p99),
    lagMs,
    stale,
    queueIn,
    jobsDone,
    eventsIn,
    lagGrowth,
    inconsistent,
    sagaOrders,
    monthlyUsd: graph.nodes.reduce((a, n) => a + nodeMonthlyUsd(n), 0),
    nodes,
    edges: edgeRes,
    issues: uniq,
  };
  const util: Record<string, number> = {};
  for (const [id, r] of Object.entries(nodes)) util[id] = r.util;
  return { result, memo: { util, primaryWrites } };
}

export function simulate(graph: Graph, traffic: Traffic, cond: Partial<Conditions> = {}): SimResult {
  const c = { ...DEFAULT_CONDITIONS, ...cond };
  const first = solveOnce(graph, traffic, c);
  return solveOnce(graph, traffic, c, first.memo).result;
}
