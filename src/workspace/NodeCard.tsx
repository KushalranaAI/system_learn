import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import {
  CAN_SEND_TO,
  KINDS,
  cacheCap,
  consumerCap,
  PARTITION_CAP,
  VECTOR_READ_CAP,
  agentEffectiveSteps,
  llmCap,
  llmModel,
  sagaOutcome,
  workerCap,
  dbSize,
  fmtRps,
  nodeTitle,
  serverSize,
  shardFactor,
  type SimNode,
} from "../engine";
import { useWorkspace } from "../state/workspace";
import { KindIcon } from "../ui/icons";
import { useSim, utilColor } from "./sim";

export function capacityOf(n: SimNode): { cap: number; unit: string } {
  switch (n.kind) {
    case "server":
      return { cap: serverSize(n.config.size).cap, unit: "req/s" };
    case "db":
      return { cap: dbSize(n.config.size).readCap * shardFactor(n.config.shards), unit: "reads/s" };
    case "worker":
      return { cap: workerCap() * (n.config.workers ?? 1), unit: "jobs/s" };
    case "kafka":
      return { cap: PARTITION_CAP * (n.config.partitions ?? 1), unit: "events/s" };
    case "consumer":
      return { cap: consumerCap() * (n.config.consumers ?? 1), unit: "events/s" };
    case "saga":
      return { cap: KINDS.saga.cap, unit: "orders/s" };
    case "cache":
      return { cap: cacheCap(), unit: "ops/s" };
    case "llm":
      return { cap: llmCap(n.config), unit: "calls/s" };
    case "vectordb":
      return { cap: VECTOR_READ_CAP * (n.config.replicas ?? 1), unit: "queries/s" };
    case "agent":
      return { cap: KINDS.agent.cap, unit: "tasks/s" };
    default:
      return { cap: KINDS[n.kind].cap, unit: "req/s" };
  }
}

export function subtitleOf(n: SimNode): string {
  const c = n.config;
  switch (n.kind) {
    case "server":
      return serverSize(c.size).label;
    case "db":
      return `${c.role === "replica" ? "read replica" : "primary"} · ${(c.shards ?? 1) > 1 ? `${c.shards} shards × ` : ""}${dbSize(c.size).label}`;
    case "cache":
    case "cdn":
      return `${Math.round((c.hitRatio ?? 0) * 100)}% hit ratio`;
    case "limiter":
      return c.limitPerIp ? `${c.limitPerIp} req/s per IP` : "off - no limit set";
    case "lb":
      return c.healthChecks ? "health checks on" : "health checks off";
    case "worker":
      return `${c.workers ?? 1} worker${(c.workers ?? 1) > 1 ? "s" : ""}`;
    case "queue":
      return "async · replies instantly";
    case "kafka":
      return `${c.partitions ?? 1} partitions${c.hotKeyPct ? ` · hot key ${c.hotKeyPct}%` : ""}`;
    case "consumer":
      return `${c.consumers ?? 1} consumer${(c.consumers ?? 1) > 1 ? "s" : ""}`;
    case "saga": {
      const on = [c.compensate, c.queryTimeouts, c.idempotencyKeys, c.outbox, c.dedupeConsumers].filter(Boolean).length;
      return `${c.sagaSteps ?? 3} steps · ${on}/5 safeguards`;
    }
    case "llm":
      return `${c.replicas ?? 1} × ${llmModel(c.model).label.split(" · ")[0]}${c.batching === false ? " · no batching" : ""}`;
    case "vectordb":
      return `${c.replicas ?? 1} replica${(c.replicas ?? 1) > 1 ? "s" : ""} · ANN index`;
    case "agent":
      return `~${agentEffectiveSteps(c).toFixed(1)} model calls/task${c.stepLimit ? " · step limit" : ""}`;
    default:
      return "sends traffic";
  }
}

function NodeCardImpl({ id, selected }: NodeProps) {
  const nodes = useWorkspace((s) => s.graph.nodes);
  const detailed = useWorkspace((s) => s.detailed);
  const n = nodes.find((x) => x.id === id);
  const sim = useSim();
  if (!n) return null;
  const r = sim.nodes[id];
  const spec = KINDS[n.kind];
  const { cap, unit } = capacityOf(n);
  const util = r?.util ?? 0;
  const down = r?.down;
  const isClient = n.kind === "client";
  const showSub = detailed || ["saga", "kafka", "consumer", "server", "db", "cache", "cdn", "limiter", "llm", "vectordb", "agent"].includes(n.kind);
  const alert =
    n.kind === "consumer" && (r?.lagGrowth ?? 0) > 0.5
      ? `Lag +${fmtRps(r!.lagGrowth!)}/s`
      : n.kind === "saga" && sagaOutcome(n.config).inconsistent > 0
        ? `${Math.round(sagaOutcome(n.config).inconsistent * 1000) / 10}% orders inconsistent`
        : r && r.dropped > 0.5
          ? `Dropping ${fmtRps(r.dropped)}/s`
          : null;
  return (
    <div
      className={`node${selected ? " selected" : ""}${down ? " down" : ""}${util >= 1 ? " overloaded" : util >= 0.85 ? " hot" : ""}${detailed ? " detailed" : ""}`}
      style={{ ["--kind" as string]: spec.color }}
    >
      {!isClient && <Handle type="target" position={Position.Left} />}
      <div className="node-head">
        <KindIcon kind={n.kind} size={15} />
        <div className="node-name">
          <span className="node-title">{nodeTitle(n, nodes)}</span>
          {showSub && !isClient && <span className="node-sub">{subtitleOf(n)}</span>}
        </div>
        {down && <span className="node-badge">DOWN</span>}
      </div>
      {isClient ? (
        <div className="node-load client">
          <b>{fmtRps(sim.legit + sim.bots)}</b> <span className="muted">req/s sent</span>
        </div>
      ) : (
        <>
          <div className="node-load">
            <span>
              <b>{fmtRps(n.kind === "db" ? r?.reads ?? 0 : r?.load ?? 0)}</b>
              {detailed && Number.isFinite(cap) && cap > 0 && <span className="muted"> / {fmtRps(cap)}</span>} <span className="muted">{unit}</span>
            </span>
            <b className="util-num" style={{ color: utilColor(util) }}>{Math.round(util * 100)}%</b>
          </div>
          <div className="bar">
            <div style={{ width: `${Math.min(100, util * 100)}%`, background: utilColor(util) }} />
          </div>
          {detailed && (
            <div className="node-foot">
              {n.kind === "db" && (r?.writes ?? 0) > 0 ? <span>{fmtRps(r!.writes!)} writes/s</span> : <span />}
              {r && r.load > 0 && n.kind !== "worker" && <span>p99 {r.p99Ms < 10 ? r.p99Ms.toFixed(1) : Math.round(r.p99Ms)} ms</span>}
            </div>
          )}
          {alert && <div className="node-alert">{alert}</div>}
        </>
      )}
      {CAN_SEND_TO[n.kind].length > 0 && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

export const NodeCard = memo(NodeCardImpl);
