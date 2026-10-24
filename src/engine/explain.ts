import { KINDS, LLM_MODELS, agentEffectiveSteps, dbSize, dbSizes, llmModel, nodeTitle, serverSizes } from "./catalog";
import { sagaOutcome, SAGA_CAUSES } from "./saga";
import { fmtRps, simulate } from "./solve";
import { TIMELINE, summarize, type Incident, type Resilience, type Tick } from "./timeline";
import type { Graph, SimNode, SimResult, Traffic } from "./types";

/** A one-click change the UI can apply for the learner. */
export type Action =
  | { kind: "duplicate"; nodeId: string; label: string }
  | { kind: "config"; nodeId: string; patch: SimNode["config"]; label: string }
  | { kind: "failover"; label: string };

export interface Advice {
  problem: string;
  why: string;
  fix: string;
  tradeoff: string;
  severity: "bad" | "warn" | "info";
  action?: Action;
}

export interface WhatIf {
  scenario: string;
  success: number;
  verdict: string;
}

export interface Guide {
  tone: "good" | "warn" | "bad" | "empty";
  headline: string;
  path: string[];
  bottleneck?: string;
  advice: Advice[];
  whatIfs: WhatIf[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function bigger<T extends { id: string }>(list: T[], id?: string): T | undefined {
  const i = list.findIndex((s) => s.id === id);
  return i >= 0 && i < list.length - 1 ? list[i + 1] : undefined;
}

/** Describe the request paths through the design in one or two sentences. */
function describePaths(g: Graph): string[] {
  const has = (k: string) => g.nodes.filter((n) => n.kind === k);
  const out: string[] = [];
  const servers = has("server").length;
  const parts = [
    "Client",
    ...(has("cdn").length ? ["CDN"] : []),
    ...(has("limiter").length ? ["rate limiter"] : []),
    ...(has("lb").length ? ["load balancer"] : []),
    servers ? `${servers} API server${servers > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  if (servers) {
    const cache = has("cache")[0];
    const dbs = has("db");
    const reps = dbs.filter((d) => d.config.role === "replica").length;
    out.push(
      `Reads go ${parts.join(" → ")}${cache ? ` → cache (${pct(cache.config.hitRatio ?? 0)} hits)` : ""}${dbs.length ? ` → ${cache ? "misses to " : ""}${dbs.length > 1 ? `${dbs.length} databases (${reps} replica${reps === 1 ? "" : "s"})` : "the database"}` : ""}.`,
    );
    const saga = has("saga")[0];
    const queue = has("queue")[0];
    out.push(
      saga
        ? `Writes (orders) run as a saga of ${saga.config.sagaSteps ?? 3} database steps each.`
        : queue
          ? "Writes go to a queue and get an instant reply; workers apply them to the database later."
          : "Writes go to the primary database.",
    );
    const agent = has("agent")[0];
    const llm = has("llm")[0];
    const vec = has("vectordb")[0];
    if (agent) out.push(`Prompts run as agent tasks of ~${agentEffectiveSteps(agent.config).toFixed(1)} model calls each${vec ? ", each step looking up context in the vector database" : ""}.`);
    else if (llm) out.push(`Prompts${vec ? " retrieve context from the vector database, then" : ""} go to ${llm.config.replicas ?? 1} replica(s) of the ${llmModel(llm.config.model).label.split(" · ")[0].toLowerCase()} model.`);
    const topic = has("kafka")[0];
    if (topic) out.push(`Every write is also published to Kafka (${topic.config.partitions ?? 1} partitions), read by ${has("consumer").length} consumer group(s).`);
  } else if (g.nodes.length) out.push("There's no API server yet, so nothing can handle requests.");
  return out;
}

/** Explain a steady-state result: what's happening, what's wrong, how to fix it, and what it costs. */
export function explainDesign(g: Graph, traffic: Traffic, res: SimResult, resilience?: Resilience): Guide {
  const nodes = g.nodes;
  const title = (n: SimNode) => nodeTitle(n, nodes);
  const advice: Advice[] = [];
  if (!nodes.length) return { tone: "empty", headline: "Start by adding a Client, an API server and a Database, then wire them left to right.", path: [], advice: [], whatIfs: [] };

  const client = nodes.find((n) => n.kind === "client");
  if (!client) advice.push({ severity: "bad", problem: "There's no client.", why: "The client is where requests start.", fix: "Add a Client from the toolbar.", tradeoff: "None - every design needs one." });
  if (!nodes.some((n) => n.kind === "server"))
    advice.push({ severity: "bad", problem: "There's no API server.", why: "Something has to run your code for each request.", fix: "Add an API server and wire Client → API server → Database.", tradeoff: "None yet - start simple." });
  if (!nodes.some((n) => n.kind === "db") && nodes.some((n) => n.kind === "server") && !nodes.some((n) => n.kind === "llm" || n.kind === "agent"))
    advice.push({ severity: "bad", problem: "There's no database.", why: "Data has to survive restarts, so it lives in a database.", fix: "Add a Database and wire every API server to it.", tradeoff: "None yet." });

  // Overloaded and hot components, worst first.
  const loaded = nodes
    .map((n) => ({ n, r: res.nodes[n.id] }))
    .filter(({ r, n }) => r && !r.down && n.kind !== "client")
    .sort((a, b) => b.r.util - a.r.util);
  for (const { n, r } of loaded) {
    if (r.util <= 0.85 || n.kind === "consumer") continue;
    const over = r.util > 1;
    const sev = over ? "bad" : "warn";
    const head = over ? `${title(n)} is overloaded (${pct(r.util)}).` : `${title(n)} is running hot (${pct(r.util)}).`;
    const whyHot = over ? `It receives ${fmtRps(r.load)}/s but can only handle about ${fmtRps(r.load / r.util)}/s, so it drops the rest.` : "Past ~85% busy, requests queue up and latency climbs steeply (and there's no room for a spike or a failure).";
    if (n.kind === "server") {
      const up = bigger(serverSizes(), n.config.size);
      advice.push({
        severity: sev, problem: head, why: whyHot,
        fix: up ? `Move it to a bigger machine (${up.label}), or add more API servers behind a load balancer.` : "It's already the biggest machine - add more API servers behind a load balancer.",
        tradeoff: "A bigger machine is simple but costs more per request and has a ceiling. More servers need a load balancer, health checks and stateless servers - but survive one dying.",
        action: up ? { kind: "config", nodeId: n.id, patch: { size: up.id }, label: `Upgrade to ${up.label}` } : { kind: "duplicate", nodeId: n.id, label: "Add another API server" },
      });
    } else if (n.kind === "db") {
      const readHeavy = (r.reads ?? 0) / Math.max(1, r.reads! + (r.writes ?? 0)) > 0.7;
      const up = bigger(dbSizes(), n.config.size);
      advice.push({
        severity: sev, problem: head, why: whyHot + ` It handles ${fmtRps(r.reads ?? 0)} reads and ${fmtRps(r.writes ?? 0)} writes per second.`,
        fix: readHeavy
          ? "Mostly reads: add a cache in front (cheapest), or read replicas wired to every server, or a bigger machine."
          : "Mostly writes: replicas won't help (they replay every write). Use a bigger machine, move writes to a queue, or shard the data (Shards in the inspector).",
        tradeoff: readHeavy
          ? "A cache adds staleness and invalidation work; replicas add replication lag (users may not see their own writes)."
          : "Bigger machines have a ceiling; queues make writes eventual; sharding complicates queries across shards.",
        action: up ? { kind: "config", nodeId: n.id, patch: { size: up.id }, label: `Upgrade to ${dbSize(up.id).label}` } : { kind: "config", nodeId: n.id, patch: { shards: (n.config.shards ?? 1) + 1 }, label: "Add a shard" },
      });
    } else if (n.kind === "worker") {
      advice.push({
        severity: "warn", problem: `${title(n)} can't keep up - the queue grows.`, why: "Jobs arrive faster than the workers finish them, so a backlog builds.",
        fix: "Add worker processes - as long as the database has room for their writes.", tradeoff: "More workers move load onto the database; a backlog that drains after a burst is often fine.",
        action: { kind: "config", nodeId: n.id, patch: { workers: (n.config.workers ?? 1) + 2 }, label: "Add 2 workers" },
      });
    } else if (n.kind === "llm") {
      const smaller = LLM_MODELS[LLM_MODELS.findIndex((m) => m.id === (n.config.model ?? "small")) - 1];
      advice.push({
        severity: sev, problem: head,
        why: `${whyHot} GPUs are the scarcest, most expensive part of the design.`,
        fix: n.config.batching === false
          ? "Turn on continuous batching first - it multiplies what each replica serves."
          : `Answer repeats from a semantic cache, route easy prompts to a smaller model${smaller ? ` (${smaller.label.split(" · ")[0]})` : ""}, cut agent steps - or add replicas.`,
        tradeoff: "Replicas cost thousands each per month. Caching risks a stale or slightly wrong answer; a smaller model answers hard questions worse.",
        action: n.config.batching === false
          ? { kind: "config", nodeId: n.id, patch: { batching: true }, label: "Turn on batching" }
          : { kind: "config", nodeId: n.id, patch: { replicas: Math.ceil((n.config.replicas ?? 1) * Math.min(2, r.util * 1.25)) }, label: "Add replicas" },
      });
    } else if (n.kind === "vectordb") {
      advice.push({ severity: sev, problem: head, why: whyHot, fix: "Add replicas, or cache retrieval results for repeated questions.", tradeoff: "Every replica holds the whole index in memory and must apply every upsert.", action: { kind: "config", nodeId: n.id, patch: { replicas: (n.config.replicas ?? 1) + 1 }, label: "Add a replica" } });
    } else if (n.kind === "kafka") {
      advice.push({ severity: sev, problem: head, why: "Each partition accepts a limited write rate.", fix: "Add partitions.", tradeoff: "More partitions mean more parallelism but more files and leader elections, and changing the count reshuffles keys.", action: { kind: "config", nodeId: n.id, patch: { partitions: (n.config.partitions ?? 1) * 2 }, label: "Double the partitions" } });
    } else {
      advice.push({ severity: sev, problem: head, why: whyHot, fix: `Give ${KINDS[n.kind].label.toLowerCase()} more capacity or send it less traffic.`, tradeoff: "Capacity costs money; less traffic usually means caching or filtering earlier." });
    }
  }

  // Consumer lag, sagas, bots, down nodes.
  for (const n of nodes.filter((x) => x.kind === "consumer")) {
    const r = res.nodes[n.id];
    if (!r || (r.lagGrowth ?? 0) <= 0.5) continue;
    const topicEdge = g.edges.find((e) => e.to === n.id);
    const topic = nodes.find((x) => x.id === topicEdge?.from);
    const P = topic?.config.partitions ?? 1;
    const C = n.config.consumers ?? 1;
    const hot = (topic?.config.hotKeyPct ?? 0) > 0;
    advice.push({
      severity: "warn", problem: `${title(n)} falls behind by ${fmtRps(r.lagGrowth ?? 0)} events/s.`,
      why: hot ? "One hot key sends a big share of events to a single partition, and only one consumer can read a partition." : C >= P ? `All ${P} partitions already have a consumer - the group can't use more consumers than partitions.` : "The group can't process events as fast as they're published, so lag grows every second.",
      fix: hot ? "Spread the hot key (salt it) or give it its own topic. More consumers won't help." : C >= P ? "Add partitions to the topic, then more consumers." : "Add consumers to the group.",
      tradeoff: hot ? "Spreading a key gives up ordering for that key." : "More consumers cost money; more partitions add overhead and reshuffle keys.",
      action: hot ? undefined : C >= P && topic ? { kind: "config", nodeId: topic.id, patch: { partitions: P * 2 }, label: "Double the partitions" } : { kind: "config", nodeId: n.id, patch: { consumers: Math.min(P, C * 2) }, label: `Use ${Math.min(P, C * 2)} consumers` },
    });
  }
  for (const n of nodes.filter((x) => x.kind === "saga")) {
    const o = sagaOutcome(n.config);
    if (o.inconsistent <= 0) continue;
    const worst = SAGA_CAUSES.filter((c) => o.causes[c] > 0).sort((a, b) => o.causes[b] - o.causes[a]);
    const fixes: Record<string, [string, SimNode["config"]]> = {
      "stock leaked": ["Turn on compensating actions (release stock, cancel the order).", { compensate: true }],
      "charged, no order": ["On a payment timeout, query or retry instead of treating it as a decline.", { queryTimeouts: true }],
      "charged twice": ["Send an idempotency key with payment calls.", { idempotencyKeys: true }],
      "paid, never shipped": ["Publish events through a transactional outbox.", { outbox: true }],
      "shipped twice": ["Make consumers dedupe by event id.", { dedupeConsumers: true }],
    };
    const [fix, patch] = fixes[worst[0]];
    advice.push({
      severity: "bad", problem: `${fmtRps(res.inconsistent)} orders/s end inconsistent (${pct(o.inconsistent)} of orders).`,
      why: `Causes: ${worst.map((c) => `${c} ${pct(o.causes[c])}`).join(", ")}.`,
      fix, tradeoff: "Each safeguard adds a little work (a table, a lookup, a relay) - far cheaper than refunds and support tickets.",
      action: { kind: "config", nodeId: n.id, patch, label: "Turn it on" },
    });
  }
  if (traffic.bots > 0 && res.botsServed > traffic.bots * 0.2)
    advice.push({ severity: "warn", problem: `Bot traffic reaches your servers (${fmtRps(res.botsServed)} req/s).`, why: "A scraper asks for random URLs from a few IPs; they miss every cache and hit the database.", fix: nodes.some((n) => n.kind === "limiter") ? "Lower the rate limiter's per-IP limit (around 50-100 req/s)." : "Add a rate limiter at the edge: Client → Rate limiter → Load balancer.", tradeoff: "A per-IP limit below ~40 req/s also blocks offices and mobile carriers that share one IP." });
  if (res.legitLimited > 0.5)
    advice.push({ severity: "warn", problem: `The rate limiter blocks ${fmtRps(res.legitLimited)} real requests/s.`, why: "Many real users share one IP (offices, mobile carriers).", fix: "Raise the per-IP limit above ~40 req/s.", tradeoff: "A higher limit lets a little more abusive traffic through." });
  const lb = nodes.find((n) => n.kind === "lb");
  for (const n of nodes.filter((x) => res.nodes[x.id]?.down)) {
    advice.push({ severity: "bad", problem: `${title(n)} is down.`, why: "You took it down to see what happens.", fix: n.kind === "server" && lb && !lb.config.healthChecks ? "Turn on the load balancer's health checks so it stops sending traffic there." : n.kind === "db" ? "Add a read replica and turn on automatic failover." : "Bring it back up, or add a redundant copy.", tradeoff: "Redundancy costs money and needs spare capacity on the survivors.", action: n.kind === "server" && lb && !lb.config.healthChecks ? { kind: "config", nodeId: lb.id, patch: { healthChecks: true }, label: "Turn on health checks" } : undefined });
  }
  if (res.stale > 1) advice.push({ severity: "info", problem: `About ${fmtRps(res.stale)} reads/s see slightly old data.`, why: `Replicas are ~${Math.round(res.lagMs)} ms behind the primary.`, fix: "Send a user's reads to the primary for a few seconds after they write (read-your-writes).", tradeoff: "More load on the primary for those reads." });

  // What-ifs, computed by re-running the simulation.
  const whatIfs: WhatIf[] = [];
  if (res.legit > 0 && client && nodes.some((n) => n.kind === "server")) {
    const base = { dbFailover: resilience?.dbFailover ?? false, promoted: resilience?.dbFailover ?? false };
    const double = simulate(g, { ...traffic, reads: traffic.reads * 2, writes: traffic.writes * 2 }, base);
    whatIfs.push({ scenario: "Traffic doubles", success: double.successRate, verdict: double.successRate < 0.99 ? `Breaks first at: ${worstNode(g, double)}.` : double.p99 > 300 ? `Survives, but slow (p99 ${double.p99} ms) - ${worstNode(g, double)}.` : `Still fine (p99 ${double.p99} ms).` });
    if (nodes.some((n) => n.kind === "cache")) {
      const cold = simulate(g, traffic, { ...base, cacheWarm: 0 });
      whatIfs.push({ scenario: "The cache restarts empty", success: cold.successRate, verdict: cold.successRate >= 0.99 ? "The database can absorb the misses." : `The database is swamped by misses (${worstNode(g, cold)}).` });
    }
    const servers = nodes.filter((n) => n.kind === "server");
    if (servers.length) {
      const dead = simulate(g, traffic, { ...base, down: [servers[0].id] });
      whatIfs.push({ scenario: `${title(servers[0])} dies`, success: dead.successRate, verdict: servers.length === 1 ? "Single point of failure - everything stops." : dead.successRate >= 0.99 ? "The others carry its share." : lb && !lb.config.healthChecks ? "The load balancer keeps sending it traffic - turn on health checks." : "The rest can't carry the load (no spare capacity)." });
    }
    const primary = nodes.find((n) => n.kind === "db" && n.config.role !== "replica");
    if (primary) {
      const dbDead = simulate(g, traffic, { ...base, down: [primary.id], promoted: base.dbFailover });
      const replicas = nodes.filter((n) => n.kind === "db" && n.config.role === "replica").length;
      whatIfs.push({ scenario: "The primary database dies", success: dbDead.successRate, verdict: !replicas ? "No replica - reads and writes fail until it's back." : !base.dbFailover ? "Reads continue from replicas, but writes fail - turn on automatic failover." : "A replica takes over after ~15 s." });
    }
  }

  // Headline.
  const bad = advice.some((a) => a.severity === "bad") || res.successRate < 0.99;
  const warn = advice.some((a) => a.severity === "warn");
  const hottest = loaded.find(({ n }) => n.kind !== "consumer");
  const headroom = hottest && hottest.r.util > 0 ? 1 / hottest.r.util : Infinity;
  let headline: string;
  if (res.legit === 0) headline = "No traffic yet - set some reads and writes in the Traffic tab.";
  else if (bad && res.successRate >= 0.99) headline = `Requests succeed, but ${(advice.find((a) => a.severity === "bad") ?? advice[0]).problem.replace(/^./, (c) => c.toLowerCase())}`;
  else if (bad) headline = `${pct(res.successRate)} of requests succeed - ${advice[0]?.problem ?? "something is failing."}`;
  else if (warn) headline = `Working (${pct(res.successRate)} success, p99 ${res.p99} ms), but ${advice[0].problem.charAt(0).toLowerCase()}${advice[0].problem.slice(1)}`;
  else headline = `Healthy: ${pct(res.successRate)} success, p99 ${res.p99} ms, $${res.monthlyUsd.toLocaleString()}/month.${Number.isFinite(headroom) ? ` Traffic can grow about ${headroom >= 10 ? "10×+" : `${headroom.toFixed(1)}×`} before ${title(hottest!.n)} saturates.` : ""}`;

  return {
    tone: res.legit === 0 ? "empty" : bad ? "bad" : warn ? "warn" : "good",
    headline,
    path: describePaths(g),
    bottleneck: hottest ? `${title(hottest.n)} is the busiest component (${pct(hottest.r.util)}).` : undefined,
    advice,
    whatIfs,
  };
}

function worstNode(g: Graph, r: SimResult): string {
  const w = g.nodes.filter((n) => r.nodes[n.id] && n.kind !== "consumer").sort((a, b) => r.nodes[b.id].util - r.nodes[a.id].util)[0];
  return w ? `${nodeTitle(w, g.nodes)} at ${pct(r.nodes[w.id].util)}` : "unknown";
}

/** Narrate a 60-second incident timeline after it has run. */
export function explainTimeline(g: Graph, traffic: Traffic, ticks: Tick[], incident: Incident, resilience: Resilience): { story: string[]; advice: Advice[]; tone: Guide["tone"] } {
  const s = summarize(ticks);
  const story: string[] = [];
  const advice: Advice[] = [];
  const at = TIMELINE.at;
  const name = (id: string) => {
    const n = g.nodes.find((x) => x.id === id);
    return n ? nodeTitle(n, g.nodes) : "a component";
  };
  const killed = incident.type === "nodeDown" ? g.nodes.find((n) => n.id === incident.nodeId) : undefined;
  const what =
    incident.type === "nodeDown" ? `${name(incident.nodeId)} died` : incident.type === "cacheFlush" ? "the cache restarted empty" : incident.type === "spike" ? `traffic jumped ${incident.factor}×` : "nothing went wrong";
  story.push(`For ${at} s everything ran normally. At t=${at} s ${what}.`);
  const worstT = ticks.reduce((w, k, i) => (k.res.success / Math.max(1, k.res.legit) < ticks[w].res.success / Math.max(1, ticks[w].res.legit) ? i : w), 0);
  if (s.worstSuccess >= 0.99) story.push(`Users barely noticed: even the worst second had ${pct(s.worstSuccess)} success (p99 peaked at ${s.worstP99} ms).`);
  else story.push(`Success fell to ${pct(s.worstSuccess)} at t=${ticks[worstT].t} s - ${worstNode(g, ticks[worstT].res)} was the weak point.`);
  if (resilience.retries && s.worstSuccess < 0.99) story.push(`Clients retried failed requests, adding up to ${pct(Math.max(...ticks.map((k) => k.res.legit)) / Math.max(1, ticks[0].res.legit) - 1)} extra load on top of the problem.`);
  if (s.recoverySeconds === null) story.push("It never recovered within the 60 seconds.");
  else if (s.worstSuccess < 0.99) story.push(`It recovered ${s.recoverySeconds} s after the failure.`);
  story.push(`Failed requests: ${fmtRps(s.failedTotal)} - ${pct(s.budgetUsed)} of a month's 99.9% error budget.`);
  if (s.finalBacklog > 0) story.push(`${fmtRps(s.finalBacklog)} jobs were still waiting in the queue at the end.`);
  if (s.finalLag > 0) story.push(`Consumers ended ${fmtRps(s.finalLag)} events behind.`);

  if (s.worstSuccess < 0.99) {
    const lb = g.nodes.find((n) => n.kind === "lb");
    if (killed?.kind === "server") {
      if (g.nodes.filter((n) => n.kind === "server").length === 1)
        advice.push({ severity: "bad", problem: "Your only API server was a single point of failure.", why: "With one server, its death is a full outage.", fix: "Run 2+ servers behind a load balancer with health checks.", tradeoff: "More servers cost more and need to be stateless.", action: { kind: "duplicate", nodeId: killed.id, label: "Add another API server" } });
      else if (lb && !lb.config.healthChecks)
        advice.push({ severity: "bad", problem: "The load balancer kept sending traffic to the dead server.", why: "Without health checks it can't tell a server is gone.", fix: "Turn on health checks.", tradeoff: "Detection takes a few seconds; a flapping server may be removed and re-added.", action: { kind: "config", nodeId: lb.id, patch: { healthChecks: true }, label: "Turn on health checks" } });
      else advice.push({ severity: "warn", problem: "The surviving servers didn't have room for the dead one's share.", why: "Redundancy needs spare capacity (N+1).", fix: "Add a server or use bigger ones so the rest stay under ~85% after a loss.", tradeoff: "You pay for capacity that sits idle most of the time.", action: { kind: "duplicate", nodeId: killed.id, label: "Add another API server" } });
    } else if (killed?.kind === "db") {
      const replica = g.nodes.some((n) => n.kind === "db" && n.config.role === "replica");
      if (!replica) advice.push({ severity: "bad", problem: "There was no replica to take over.", why: "With one database, its death stops every read and write.", fix: "Add a read replica (wired to every server) and turn on automatic failover.", tradeoff: "A replica doubles database cost; async replicas can lose the last few writes on failover." });
      else if (!resilience.dbFailover) advice.push({ severity: "bad", problem: "Nothing promoted the replica.", why: "Reads kept working from the replica, but every write failed.", fix: "Turn on automatic DB failover.", tradeoff: "Failover takes ~15 s and must guard against split brain.", action: { kind: "failover", label: "Turn on automatic failover" } });
      else advice.push({ severity: "info", problem: "Writes failed during the ~15 s failover window.", why: "Detecting the failure and promoting a replica takes time.", fix: "Make writes retry idempotently; faster detection shortens the window.", tradeoff: "Too-fast detection fails over on blips (flapping)." });
    } else if (incident.type === "cacheFlush")
      advice.push({ severity: "bad", problem: "The database couldn't absorb the cache misses.", why: "With the cache empty, every read hits the database at once - a stampede - and the cache refills slowly while the database is overloaded.", fix: "Give the database headroom for warm-up (bigger, or a read replica), coalesce misses, and warm hot keys after restarts.", tradeoff: "Headroom costs money most of the time; coalescing adds code." });
    else if (incident.type === "spike")
      advice.push({ severity: "bad", problem: `The design had no room for a ${incident.factor}× spike.`, why: `${worstNode(g, ticks[worstT].res)} ran out of capacity.`, fix: "Keep more headroom (bigger or more machines), put a CDN or cache in front, queue writes, or rate-limit low-priority traffic.", tradeoff: "Headroom is paid for every day; rate limiting turns some users away during the spike." });
  }
  void traffic;
  return { story, advice, tone: s.worstSuccess >= 0.99 ? "good" : s.recoverySeconds === null ? "bad" : "warn" };
}

/** Describe a lab test before it runs, in plain words. */
export function describeTest(traffic: Traffic, incident?: { type: string; kind?: string; role?: string; factor?: number }): string {
  const parts = [`We'll send ${fmtRps(traffic.reads)} reads/s and ${fmtRps(traffic.writes)} writes/s${traffic.bots ? `, plus ${fmtRps(traffic.bots)} req/s from a scraper` : ""}.`];
  if (incident && incident.type !== "none") {
    const what =
      incident.type === "killKind" ? `the ${incident.role === "primary" ? "primary database" : incident.kind === "server" ? "first API server" : incident.kind} dies` : incident.type === "cacheFlush" ? "the cache restarts empty" : incident.type === "spike" ? `traffic jumps ${incident.factor}×` : "something fails";
    parts.push(`It runs for ${TIMELINE.seconds} s; at t=${TIMELINE.at} s ${what}. Failed requests are retried by clients.`);
  } else parts.push("Traffic stays steady; we check the design at full load.");
  return parts.join(" ");
}

