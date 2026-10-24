import { Copy, MousePointerClick, Power, Trash2 } from "lucide-react";
import { KINDS, LLM_MODELS, RUNAWAY_STEPS, SHARD_EFFICIENCY, agentEffectiveSteps, dbSizes, fmtRps, nodeMonthlyUsd, nodeTitle, sagaOutcome, serverSizes, SAGA_CAUSES, type NodeConfig } from "../engine";
import { useWorkspace } from "../state/workspace";
import { KindIcon } from "../ui/icons";
import { capacityOf } from "./NodeCard";
import { useSim, utilColor } from "./sim";

function Toggle({ on, set, label, help }: { on?: boolean; set: (v: boolean) => void; label: string; help: string }) {
  return (
    <label className="setting switch-row">
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        <span className="help">{help}</span>
      </span>
      <input type="checkbox" className="switch" checked={!!on} onChange={(e) => set(e.target.checked)} />
    </label>
  );
}

function Slider({ label, value, min, max, set, help, unit = "" }: { label: string; value: number; min: number; max: number; set: (v: number) => void; help?: string; unit?: string }) {
  return (
    <label className="setting">
      <span className="row between"><span className="setting-label">{label}</span><b className="setting-value">{value}{unit}</b></span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => set(+e.target.value)} />
      {help && <span className="help">{help}</span>}
    </label>
  );
}

const SHORTCUTS = [
  ["Drag", "from a card's right dot to wire it"],
  ["Del", "remove the selected card or wire"],
  ["L", "tidy the layout"],
  ["P", "presenter mode"],
  ["Ctrl Z", "undo"],
];

export function Inspector() {
  const selected = useWorkspace((s) => s.selected);
  const nodes = useWorkspace((s) => s.graph.nodes);
  const down = useWorkspace((s) => s.down);
  const { updateConfig, removeNode, toggleDown, duplicateNode } = useWorkspace.getState();
  const sim = useSim();
  const n = nodes.find((x) => x.id === selected);

  if (!n)
    return (
      <div className="inspector-empty">
        <span className="empty-icon"><MousePointerClick size={20} /></span>
        <b>Select a component</b>
        <p>Click any card on the canvas to see what it does and change its settings.</p>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
          ))}
        </dl>
      </div>
    );

  const spec = KINDS[n.kind];
  const r = sim.nodes[n.id];
  const c = n.config;
  const { cap, unit } = capacityOf(n);
  const set = (patch: NodeConfig) => updateConfig(n.id, patch);
  const saga = n.kind === "saga" ? sagaOutcome(c) : null;

  return (
    <div className="inspector">
      <header className="inspector-head">
        <KindIcon kind={n.kind} size={18} className="lg" />
        <div className="grow">
          <h3>{nodeTitle(n, nodes)}</h3>
          <span className="muted small">{spec.label} · ${nodeMonthlyUsd(n)}/mo</span>
        </div>
      </header>
      <p className="inspector-blurb">{spec.blurb}</p>

      {r && n.kind !== "client" && (
        <div className="gauge">
          <div className="row between">
            <b style={{ color: utilColor(r.util) }}>{Math.round(r.util * 100)}% busy</b>
            <span className="muted small">{fmtRps(r.load)} of {Number.isFinite(cap) && cap ? fmtRps(cap) : "∞"} {unit}</span>
          </div>
          <div className="bar"><div style={{ width: `${Math.min(100, r.util * 100)}%`, background: utilColor(r.util) }} /></div>
          {(r.load > 0 || r.dropped > 0.5) && (
            <div className="gauge-chips">
              {n.kind !== "consumer" && n.kind !== "worker" && r.load > 0 && <span className="pill">p99 {r.p99Ms.toFixed(1)} ms</span>}
              {r.dropped > 0.5 && <span className="pill bad">drops {fmtRps(r.dropped)}/s</span>}
            </div>
          )}
        </div>
      )}

      <div className="settings">
        {n.kind === "server" && (
          <label className="setting">
            <span className="setting-label">Machine size</span>
            <select value={c.size} onChange={(e) => set({ size: e.target.value })}>
              {serverSizes().map((s) => <option key={s.id} value={s.id}>{s.label} - {fmtRps(s.cap)} req/s - ${s.usd}/mo</option>)}
            </select>
            <span className="help">Bigger machines handle more, but throughput grows slower than cores. Need more? Duplicate this server and put a load balancer in front.</span>
          </label>
        )}

        {n.kind === "db" && (
          <>
            <label className="setting">
              <span className="setting-label">Role</span>
              <select value={c.role ?? "primary"} onChange={(e) => set({ role: e.target.value as "primary" | "replica" })}>
                <option value="primary">Primary (reads + writes)</option>
                <option value="replica">Read replica (reads only)</option>
              </select>
              <span className="help">Replicas copy every write from the primary and add read capacity. With automatic failover, a replica takes over if the primary dies.</span>
            </label>
            <label className="setting">
              <span className="setting-label">Machine size</span>
              <select value={c.size} onChange={(e) => set({ size: e.target.value })}>
                {dbSizes().map((s) => <option key={s.id} value={s.id}>{s.label} - {fmtRps(s.readCap)} reads or {fmtRps(s.writeCap)} writes/s - ${s.usd}/mo</option>)}
              </select>
            </label>
            <Slider label="Shards" value={c.shards ?? 1} min={1} max={16} set={(v) => set({ shards: v })}
              help={`Split the data by key over N machines: reads and writes both scale (~${Math.round(SHARD_EFFICIENCY * 100)}% per shard), cost is N×. Cross-shard queries get harder.`} />
          </>
        )}

        {(n.kind === "cache" || n.kind === "cdn") && (
          <Slider label="Hit ratio" value={Math.round((c.hitRatio ?? 0) * 100)} min={0} max={95} unit="%" set={(v) => set({ hitRatio: v / 100 })}
            help={n.kind === "cache" ? "How often the answer is already in memory. Hot, repeated reads give 80-95%. Every miss goes to the database." : "Share of reads the edge can answer: images, scripts, public pages."} />
        )}

        {n.kind === "limiter" && (
          <label className="setting">
            <span className="row between"><span className="setting-label">Limit per IP</span><span className="muted small">req/s · 0 = off</span></span>
            <input type="number" min={0} value={c.limitPerIp ?? 0} onChange={(e) => set({ limitPerIp: Math.max(0, +e.target.value) })} />
            <span className="help">A normal user sends ~2 req/s; an office or mobile carrier shares one IP at ~40 req/s. A scraper sends thousands.</span>
          </label>
        )}

        {n.kind === "lb" && (
          <Toggle on={c.healthChecks} set={(v) => set({ healthChecks: v })} label="Health checks" help="Stop sending traffic to servers that are down. Without them, a dead server still gets its share - and those requests fail." />
        )}

        {n.kind === "worker" && (
          <Slider label="Worker processes" value={c.workers ?? 1} min={1} max={40} set={(v) => set({ workers: v })} help="More workers drain the queue faster - as long as the database can take their writes." />
        )}

        {n.kind === "kafka" && (
          <>
            <Slider label="Partitions" value={c.partitions ?? 1} min={1} max={128} set={(v) => set({ partitions: v })}
              help="The unit of parallelism and ordering. A consumer group can use at most one consumer per partition. Changing the count later reshuffles keys." />
            <Slider label="Hot key share" value={c.hotKeyPct ?? 0} min={0} max={50} unit="%" set={(v) => set({ hotKeyPct: v })}
              help="Events with one key (a celebrity, a huge tenant) all land in one partition - and only one consumer can read it." />
          </>
        )}

        {n.kind === "consumer" && (
          <>
            <Slider label="Consumers in the group" value={c.consumers ?? 1} min={1} max={128} set={(v) => set({ consumers: v })}
              help="Each consumer reads one or more partitions. More consumers than partitions just sit idle." />
            {r && (
              <p className={`result-line ${(r.lagGrowth ?? 0) > 0.5 ? "bad" : "good"}`}>
                {(r.lagGrowth ?? 0) > 0.5 ? `Falling behind by ${fmtRps(r.lagGrowth!)} events/s.` : "Keeping up."}
                {(r.idle ?? 0) > 0 && <span className="muted"> {r.idle} idle.</span>}
              </p>
            )}
          </>
        )}

        {n.kind === "saga" && saga && (
          <>
            <Slider label="Steps per order" value={c.sagaSteps ?? 3} min={1} max={6} set={(v) => set({ sagaSteps: v })} help="Each step is a local transaction (reserve stock, charge, confirm) - more steps mean more database writes per order." />
            <h4 className="settings-sub">Safeguards</h4>
            <Toggle on={c.compensate} set={(v) => set({ compensate: v })} label="Compensating actions" help="If a later step fails, undo the earlier ones (release stock, cancel the order)." />
            <Toggle on={c.queryTimeouts} set={(v) => set({ queryTimeouts: v })} label="Resolve payment timeouts" help="A timeout means 'unknown', not 'declined': retry or ask the provider what happened." />
            <Toggle on={c.idempotencyKeys} set={(v) => set({ idempotencyKeys: v })} label="Idempotency keys" help="Retried payment calls return the first result instead of charging again." />
            <Toggle on={c.outbox} set={(v) => set({ outbox: v })} label="Transactional outbox" help="Write the event in the same transaction as the order, so a crash can't lose it." />
            <Toggle on={c.dedupeConsumers} set={(v) => set({ dedupeConsumers: v })} label="Consumers dedupe events" help="Events can arrive twice; consumers skip ids they've already processed." />
            <p className={`result-line ${saga.inconsistent > 0 ? "bad" : "good"}`}>
              {saga.inconsistent > 0
                ? `${(saga.inconsistent * 100).toFixed(1)}% of orders end inconsistent: ${SAGA_CAUSES.filter((k) => saga.causes[k] > 0).map((k) => `${k} ${(saga.causes[k] * 100).toFixed(1)}%`).join(", ")}.`
                : "Every order either completes or is cleanly cancelled."}
            </p>
          </>
        )}
        {n.kind === "llm" && (
          <>
            <label className="setting">
              <span className="setting-label">Model</span>
              <select value={c.model ?? "small"} onChange={(e) => set({ model: e.target.value })}>
                {LLM_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} - {m.cap} req/s per replica - ${m.usd.toLocaleString()}/mo</option>)}
              </select>
              <span className="help">Bigger models answer harder questions but need more GPUs per copy and serve fewer requests on each. Route easy prompts to a small model.</span>
            </label>
            <Slider label="Replicas" value={c.replicas ?? 1} min={1} max={64} set={(v) => set({ replicas: v })} help="Each replica is a full copy of the model on its own GPUs. Capacity and cost both grow linearly." />
            <Toggle on={c.batching !== false} set={(v) => set({ batching: v })} label="Continuous batching" help="Many requests share each forward pass of the model (vLLM-style): several times the throughput for a little more latency per request." />
          </>
        )}

        {n.kind === "vectordb" && (
          <Slider label="Replicas" value={c.replicas ?? 1} min={1} max={32} set={(v) => set({ replicas: v })} help="Each replica holds the whole index in memory and answers nearest-neighbour queries. Upserts (new embeddings) cost every replica." />
        )}

        {n.kind === "agent" && (
          <>
            <Slider label="Steps per task" value={c.agentSteps ?? 4} min={1} max={15} set={(v) => set({ agentSteps: v })} help="Each step is a model call: plan, call a tool, read the result. Ten steps cost ten times the GPU and add ten model latencies." />
            <Toggle on={c.stepLimit} set={(v) => set({ stepLimit: v })} label="Step limit" help={`Stop a task after its step budget. Without one, a few confused tasks loop up to ${RUNAWAY_STEPS} steps.`} />
            <p className={`result-line ${c.stepLimit ? "good" : "bad"}`}>{agentEffectiveSteps(c).toFixed(1)} model calls per task on average.</p>
          </>
        )}
      </div>

      <div className="inspector-actions">
        {n.kind !== "client" && <button className="btn small" onClick={() => duplicateNode(n.id)} title="Add a copy with the same wires"><Copy size={14} /> Duplicate</button>}
        {n.kind !== "client" && (
          <button className={`btn small ${down.includes(n.id) ? "warn" : ""}`} onClick={() => toggleDown(n.id)} title="Simulate this component failing">
            <Power size={14} /> {down.includes(n.id) ? "Bring back up" : "Take down"}
          </button>
        )}
        <span className="grow" />
        <button className="icon-btn danger" onClick={() => removeNode(n.id)} title="Delete (Del)" aria-label="Delete component"><Trash2 size={16} /></button>
      </div>
    </div>
  );
}
