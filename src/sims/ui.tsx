import { CircleCheck, CircleX, Lightbulb, RotateCcw, Scale, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AiGuideCard } from "../ai/AiGuideCard";
import { simContext } from "../ai/context";
import { useAiExplanation } from "../ai/useAiExplanation";
import { EXPLAIN } from "./explain";
import { goalMet, type Goal, type ParamSpec, type Params, type SimDef } from "./types";

/* ---------------- charts ---------------- */

export interface Series {
  name: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

export function LineChart({
  series, height = 180, yMax, yLabel, xLabel = "time (s)", xStep = 1, markers = [], hLines = [], yFormat = (v: number) => `${Math.round(v)}`,
}: {
  series: Series[];
  height?: number;
  yMax?: number;
  yLabel?: string;
  xLabel?: string;
  xStep?: number;
  markers?: { x: number; label: string; color?: string }[];
  hLines?: { y: number; label: string; color?: string }[];
  yFormat?: (v: number) => string;
}) {
  const W = 640;
  const H = height;
  const L = 44;
  const R = 10;
  const T = 10;
  const B = 24;
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const top = yMax ?? Math.max(1e-9, ...series.flatMap((s) => s.values.filter(Number.isFinite)), ...hLines.map((h) => h.y)) * 1.08;
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - Math.min(v, top) / top) * (H - T - B);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number.isFinite(v) ? v : top).toFixed(1)}`).join(" ");
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="simchart" preserveAspectRatio="none">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(top * f)} y2={y(top * f)} className="grid" />
            <text x={L - 4} y={y(top * f) + 3} className="axis" textAnchor="end">{yFormat(top * f)}</text>
          </g>
        ))}
        {hLines.map((h) => (
          <g key={h.label}>
            <line x1={L} x2={W - R} y1={y(h.y)} y2={y(h.y)} stroke={h.color ?? "var(--muted)"} strokeDasharray="5 4" />
            <text x={W - R - 2} y={y(h.y) - 3} className="axis" textAnchor="end" fill={h.color ?? "var(--muted)"}>{h.label}</text>
          </g>
        ))}
        {markers.map((m) => (
          <g key={m.label + m.x}>
            <line x1={x(m.x)} x2={x(m.x)} y1={T} y2={H - B} stroke={m.color ?? "var(--bad)"} strokeDasharray="4 3" />
            <text x={x(m.x) + 3} y={T + 10} className="axis" fill={m.color ?? "var(--bad)"}>{m.label}</text>
          </g>
        ))}
        {series.map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "6 4" : undefined} vectorEffect="non-scaling-stroke" />
        ))}
        <text x={L} y={H - 6} className="axis">0</text>
        <text x={W - R} y={H - 6} className="axis" textAnchor="end">{Math.round((n - 1) * xStep)} · {xLabel}</text>
        {yLabel && <text x={4} y={T + 4} className="axis">{yLabel}</text>}
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}><i style={{ background: s.color }} /> {s.name}</span>
        ))}
      </div>
    </div>
  );
}

export function Bars({ values, labels, color = () => "var(--accent)", height = 150, refLine, refLabel, yFormat = (v: number) => `${Math.round(v)}` }: {
  values: number[];
  labels?: string[];
  color?: (v: number, i: number) => string;
  height?: number;
  refLine?: number;
  refLabel?: string;
  yFormat?: (v: number) => string;
}) {
  const W = 640;
  const H = height;
  const L = 44;
  const B = 18;
  const top = Math.max(1e-9, ...values, refLine ?? 0) * 1.1;
  const bw = (W - L - 6) / Math.max(1, values.length);
  const y = (v: number) => 6 + (1 - v / top) * (H - 6 - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="simchart" preserveAspectRatio="none">
      <text x={L - 4} y={y(top) + 8} className="axis" textAnchor="end">{yFormat(top)}</text>
      {values.map((v, i) => (
        <g key={i}>
          <rect x={L + i * bw + 1} y={y(v)} width={Math.max(1, bw - 2)} height={H - B - y(v)} fill={color(v, i)} rx={2} />
          {labels && values.length <= 40 && <text x={L + i * bw + bw / 2} y={H - 5} className="axis" textAnchor="middle">{labels[i]}</text>}
        </g>
      ))}
      {refLine !== undefined && (
        <g>
          <line x1={L} x2={W} y1={y(refLine)} y2={y(refLine)} stroke="var(--warm)" strokeDasharray="5 4" />
          {refLabel && <text x={W - 4} y={y(refLine) - 3} className="axis" textAnchor="end" fill="var(--warm)">{refLabel}</text>}
        </g>
      )}
    </svg>
  );
}

export function Histogram({ values, bins = 40, max, unit = "ms", marks = [] }: { values: number[]; bins?: number; max?: number; unit?: string; marks?: { v: number; label: string }[] }) {
  const hi = max ?? Math.max(1, ...values);
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((Math.min(v, hi) / hi) * bins))]++;
  const W = 640;
  const H = 150;
  const top = Math.max(...counts) * 1.1 || 1;
  const bw = (W - 10) / bins;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="simchart" preserveAspectRatio="none">
      {counts.map((c, i) => (
        <rect key={i} x={5 + i * bw} y={H - 20 - (c / top) * (H - 30)} width={bw - 1} height={(c / top) * (H - 30)} fill="var(--accent)" opacity={0.75} />
      ))}
      {marks.map((m) => {
        const xx = 5 + (Math.min(m.v, hi) / hi) * (W - 10);
        return (
          <g key={m.label}>
            <line x1={xx} x2={xx} y1={6} y2={H - 20} stroke="var(--warm)" strokeDasharray="4 3" />
            <text x={xx + 3} y={16} className="axis" fill="var(--warm)">{m.label}</text>
          </g>
        );
      })}
      <text x={5} y={H - 5} className="axis">0</text>
      <text x={W - 5} y={H - 5} className="axis" textAnchor="end">{Math.round(hi)} {unit}</text>
    </svg>
  );
}

export function Stats({ items }: { items: { label: string; value: string; tone?: "good" | "bad" | "warm" }[] }) {
  return (
    <div className="simstats">
      {items.map((i) => (
        <div key={i.label} className="stat">
          <span className="label">{i.label}</span>
          <span className={`value ${i.tone ?? ""}`}>{i.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="simnote small">{children}</p>;
}

/* ---------------- controls ---------------- */

function Control({ spec, value, onChange, locked }: { spec: ParamSpec; value: unknown; onChange: (v: number | string | boolean) => void; locked: boolean }) {
  if (spec.type === "toggle")
    return (
      <label className={`setting switch-row${locked ? " locked" : ""}`}>
        <span className="setting-text">
          <span className="setting-label">{spec.label}</span>
          {spec.hint && <span className="help">{spec.hint}</span>}
        </span>
        <input type="checkbox" className="switch" checked={!!value} disabled={locked} onChange={(e) => onChange(e.target.checked)} />
      </label>
    );
  if (spec.type === "select")
    return (
      <label className={`setting${locked ? " locked" : ""}`}>
        <span className="setting-label">{spec.label}</span>
        <select disabled={locked} value={String(value)} onChange={(e) => {
          const opt = spec.options!.find((o) => String(o.value) === e.target.value)!;
          onChange(opt.value);
        }}>
          {spec.options!.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
        {spec.hint && !locked && <span className="help">{spec.hint}</span>}
      </label>
    );
  const v = Number(value);
  const min = spec.min ?? 0;
  const max = spec.max ?? 100;
  const toPos = (x: number) => (spec.log ? (Math.log(Math.max(x, min || 1)) - Math.log(min || 1)) / (Math.log(max) - Math.log(min || 1)) * 1000 : ((x - min) / (max - min)) * 1000);
  const fromPos = (p: number) => {
    const raw = spec.log ? Math.exp(Math.log(min || 1) + (p / 1000) * (Math.log(max) - Math.log(min || 1))) : min + (p / 1000) * (max - min);
    const step = spec.step ?? 1;
    return Math.min(max, Math.max(min, Math.round(raw / step) * step));
  };
  return (
    <label className={`setting${locked ? " locked" : ""}`}>
      <span className="row between">
        <span className="setting-label">{spec.label}</span>
        <b className="setting-value">{Number.isInteger(v) ? v.toLocaleString() : v} {spec.unit ?? ""}</b>
      </span>
      {!locked && <input type="range" min={0} max={1000} value={toPos(v)} onChange={(e) => onChange(fromPos(+e.target.value))} />}
      {spec.hint && !locked && <span className="help">{spec.hint}</span>}
    </label>
  );
}

export function ParamControls({ specs, params, set, locked = [] }: { specs: ParamSpec[]; params: Params; set: (k: string, v: number | string | boolean) => void; locked?: string[] }) {
  return (
    <div className="simcontrols">
      {specs.map((s) => (
        <Control key={s.key} spec={s} value={params[s.key]} locked={locked.includes(s.key)} onChange={(v) => set(s.key, v)} />
      ))}
    </div>
  );
}

/* ---------------- runner ---------------- */

export function GoalList({ goals, metrics }: { goals: Goal[]; metrics: Record<string, number> }) {
  return (
    <ul className="checks goals-inline">
      {goals.map((g) => {
        const ok = goalMet(g, metrics);
        return (
          <li key={g.label} className={ok ? "ok" : "fail"}>
            {ok ? <CircleCheck size={16} /> : <CircleX size={16} />}
            <span className="check-text">{g.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function SimRunner({
  def, initial, locked = [], goals, onMetrics, compact,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: SimDef<any, any>;
  initial?: Params;
  locked?: string[];
  goals?: Goal[];
  onMetrics?: (m: Record<string, number>, params: Params) => void;
  compact?: boolean;
}) {
  const [params, setParams] = useState<Params>(() => ({ ...def.defaults, ...initial }));
  const result = useMemo(() => def.run(params), [def, params]);
  const metrics = useMemo(() => def.metrics(result), [def, result]);
  useEffect(() => {
    onMetrics?.(metrics, params);
  }, [metrics, params, onMetrics]);
  const set = (k: string, v: number | string | boolean) => setParams((p) => ({ ...p, [k]: v }));
  return (
    <div className={`simrunner${compact ? " compact" : ""}`}>
      <aside className="sim-controls">
        <div className="panel-head">
          <h4>Settings</h4>
          <button className="icon-btn sm" onClick={() => setParams({ ...def.defaults, ...initial })} title="Reset to the starting values" aria-label="Reset"><RotateCcw size={14} /></button>
        </div>
        <ParamControls specs={def.params} params={params} set={set} locked={locked} />
      </aside>
      <section className="sim-results">
        {goals && goals.length > 0 && <GoalList goals={goals} metrics={metrics} />}
        <SimGuide def={def} params={params} metrics={metrics} goals={goals} />
        <Stats items={def.metricSpecs.map((m) => ({ label: m.label, value: m.format(metrics[m.key]) }))} />
        <div className="sim-view">{def.View({ p: params, r: result })}</div>
      </section>
    </div>
  );
}

/** Plain-language guide shown above every simulation: the scenario, what happened, what to try, and the trade-off. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function SimGuide({ def, params, metrics, goals }: { def: SimDef<any, any>; params: Params; metrics: Record<string, number>; goals?: Goal[] }) {
  const fn = EXPLAIN[def.id];
  const e = fn ? fn(params, metrics) : null;
  const goalsMet = goals?.length ? goals.every((g) => goalMet(g, metrics)) : undefined;
  const ctx = useMemo(
    () =>
      e
        ? simContext(def.title, def.blurb, params, metrics, Object.fromEntries(def.metricSpecs.map((m) => [m.key, m.label])), { scenario: e.scenario, outcome: e.outcome }, goals?.map((g) => ({ label: g.label, met: goalMet(g, metrics) })))
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def, params, metrics, goals],
  );
  const ai = useAiExplanation("Explain this simulation run: the scenario in plain words, what the results show, what to change if the goals aren't met or the results look bad, and the trade-off.", ctx);
  if (!e) return null;
  if (ai.status === "done" || (ai.data && ai.status !== "error")) return <AiGuideCard {...ai} />;
  const good = goalsMet ?? e.good;
  return (
    <>
    <AiGuideCard {...ai} />
    <div className={`insight ${good ? "good" : "bad"}`}>
      <p className="insight-scenario">{e.scenario}</p>
      <p className="insight-main">{good ? <CircleCheck size={17} /> : <TriangleAlert size={17} />}<span>{e.outcome}</span></p>
      {!good && e.fix && <p className="insight-row"><Lightbulb size={15} /><span><b>Try</b> {e.fix}</span></p>}
      <p className="insight-row muted"><Scale size={15} /><span><b>Trade-off</b> {e.tradeoff}</span></p>
    </div>
    </>
  );
}
