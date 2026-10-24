import { fmt, type SimDef } from "./types";
import { LineChart, Note } from "./ui";

type P = {
  producerRps: number;
  partitions: number;
  consumers: number;
  perConsumerRps: number;
  hotKeyPct: number;
  saltHotKey: boolean;
  crash: boolean;
  rebalance: "eager" | "cooperative";
};

interface R {
  totalLag: number[];
  hotLag: number[];
  finalLag: number;
  maxLagAge: number;
  idle: number;
  activeConsumers: number;
}

const T = 120;
const CRASH_AT = 40;

/**
 * A partitioned log, one second per tick. Keys hash to partitions; one "hot key" can concentrate traffic on
 * partition 0. Each partition is owned by one consumer in the group; a consumer's throughput is shared by its
 * partitions in proportion to their backlog. A crash triggers a rebalance: eager pauses the whole group,
 * cooperative only pauses the partitions that move.
 */
export function runKafka(p: P): R {
  const parts = Math.max(1, p.partitions);
  const inflow = new Array(parts).fill(0);
  const hot = p.saltHotKey ? 0 : (p.hotKeyPct / 100) * p.producerRps;
  for (let i = 0; i < parts; i++) inflow[i] = (p.producerRps - hot) / parts + (i === 0 ? hot : 0);
  const lag = new Array(parts).fill(0);
  let consumers = Math.max(1, p.consumers);
  const out: R = { totalLag: [], hotLag: [], finalLag: 0, maxLagAge: 0, idle: Math.max(0, consumers - parts), activeConsumers: Math.min(consumers, parts) };
  const assign = (c: number) => Array.from({ length: parts }, (_, i) => i % c);
  let owner = assign(consumers);
  const pausedUntil = new Array(parts).fill(-1);
  for (let t = 0; t < T; t++) {
    if (p.crash && t === CRASH_AT && consumers > 1) {
      const dead = consumers - 1;
      consumers -= 1;
      const next = assign(consumers);
      for (let i = 0; i < parts; i++) {
        const moved = next[i] !== owner[i] || owner[i] === dead;
        if (p.rebalance === "eager") pausedUntil[i] = t + 10;
        else if (moved) pausedUntil[i] = t + 3;
      }
      owner = next;
    }
    for (let i = 0; i < parts; i++) lag[i] += inflow[i];
    for (let c = 0; c < consumers; c++) {
      const mine = owner.map((o, i) => (o === c && pausedUntil[i] <= t ? i : -1)).filter((i) => i >= 0);
      const demand = mine.reduce((a, i) => a + lag[i], 0);
      if (!demand) continue;
      const cap = Math.min(p.perConsumerRps, demand);
      for (const i of mine) lag[i] -= cap * (lag[i] / demand);
    }
    const total = lag.reduce((a, b) => a + b, 0);
    out.totalLag.push(total);
    out.hotLag.push(lag[0]);
    for (let i = 0; i < parts; i++) out.maxLagAge = Math.max(out.maxLagAge, lag[i] / Math.max(1e-9, inflow[i]));
  }
  out.finalLag = out.totalLag[T - 1];
  return out;
}

export const kafkaLog: SimDef<P, R> = {
  id: "kafka-log",
  title: "Partitions, consumer groups and lag",
  module: 15,
  lessons: ["15.2", "15.3", "15.5"],
  blurb: "Producers write 20,000 events/s into a partitioned topic. Size partitions and consumers, survive a consumer crash and rebalance, and deal with a hot key.",
  params: [
    { key: "producerRps", label: "Producer rate", type: "number", min: 1000, max: 100000, step: 1000, unit: "events/s" },
    { key: "partitions", label: "Partitions", type: "number", min: 1, max: 128 },
    { key: "consumers", label: "Consumers in the group", type: "number", min: 1, max: 128 },
    { key: "perConsumerRps", label: "Throughput per consumer", type: "number", min: 100, max: 5000, step: 100, unit: "events/s" },
    { key: "hotKeyPct", label: "Traffic from one hot key", type: "number", min: 0, max: 50, unit: "%" },
    { key: "saltHotKey", label: "Salt the hot key across partitions (gives up its ordering)", type: "toggle" },
    { key: "crash", label: `A consumer crashes at t=${CRASH_AT}s`, type: "toggle" },
    { key: "rebalance", label: "Rebalance protocol", type: "select", options: [{ value: "eager", label: "Eager (whole group pauses ~10 s)" }, { value: "cooperative", label: "Cooperative (only moved partitions pause ~3 s)" }] },
  ],
  defaults: { producerRps: 20000, partitions: 8, consumers: 8, perConsumerRps: 1000, hotKeyPct: 0, saltHotKey: false, crash: false, rebalance: "eager" },
  run: runKafka,
  metrics: (r) => ({ finalLag: r.finalLag, maxLagAge: r.maxLagAge, idle: r.idle }),
  metricSpecs: [
    { key: "finalLag", label: "Lag at the end", format: fmt.n },
    { key: "maxLagAge", label: "Worst lag (seconds behind)", format: fmt.s },
    { key: "idle", label: "Idle consumers", format: fmt.n },
  ],
  View: ({ p, r }) => (
    <>
      <LineChart
        yLabel="events behind"
        yFormat={fmt.n}
        series={[
          { name: "Total lag", color: "var(--warm)", values: r.totalLag },
          { name: "Partition 0 (hot key) lag", color: "var(--bad)", values: r.hotLag, dashed: true },
        ]}
        markers={p.crash ? [{ x: CRASH_AT, label: "consumer crashes" }] : []}
      />
      <Note>
        Group capacity = {r.activeConsumers} active consumers × {p.perConsumerRps.toLocaleString()} = {(r.activeConsumers * p.perConsumerRps).toLocaleString()} events/s
        {r.idle > 0 ? ` (${r.idle} consumers idle - only one consumer can own a partition)` : ""}. Lag only falls when capacity beats the inflow on <i>every</i> partition.
      </Note>
    </>
  ),
};
