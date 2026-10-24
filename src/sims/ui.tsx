import { CircleCheck, CircleX, Lightbulb, RotateCcw, Scale, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AiGuideCard } from "../ai/AiGuideCard";
import { simContext } from "../ai/context";
import { useChatSource } from "../chat/store";
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

/** Width of the element in CSS pixels, so charts draw at 1:1 and text stays readable at any panel size. */
function useWidth(fallback = 640): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!el) return;
    const measure = () => setW(Math.max(260, Math.round(el.clientWidth)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

/** The smallest "round" number ≥ v (1, 1.2, 1.5, 2, 3, 4, 5, 6, 8 × 10ⁿ), whose half is round too, so axis ticks read cleanly. */
export function niceCeil(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  const m = v / e;
  const step = [1, 1.2, 1.5, 2, 3, 4, 5, 6, 8, 10].find((s) => s >= m - 1e-9) ?? 10;
  return step * e;
}

/** Estimated width of a label in the 11px axis font, used to keep labels from colliding. */
const textW = (s: string) => s.length * 6.2;

/** Evenly spaced tick positions (indices) that leave room for their labels. */
function tickIndices(n: number, plotW: number, label: (i: number) => string): number[] {
  if (n <= 1) return [0];
  const widest = Math.max(textW(label(0)), textW(label(n - 1)), textW(label(Math.floor((n - 1) / 2))));
  const fit = Math.max(2, Math.min(7, Math.floor(plotW / (widest + 28)) + 1));
  // A whole-number step keeps ticks evenly spaced (1, 4, 16, 64, 256 rather than 1, 4, 8, 32...).
  const step = Math.max(1, Math.ceil((n - 1) / (fit - 1)));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += step) out.push(i);
  if (n - 1 - out[out.length - 1] < step / 2 && out.length > 1) out.pop();
  out.push(n - 1);
  return out;
}

export function LineChart({
  series, height = 200, yMax, yLabel, xLabel = "time (s)", xStep = 1, xFormat, markers = [], hLines = [], yFormat = (v: number) => `${Math.round(v)}`,
}: {
  series: Series[];
  height?: number;
  yMax?: number;
  yLabel?: string;
  xLabel?: string;
  xStep?: number;
  /** label for the point at index i (default: i × xStep) */
  xFormat?: (i: number) => string;
  markers?: { x: number; label: string; color?: string }[];
  hLines?: { y: number; label: string; color?: string }[];
  yFormat?: (v: number) => string;
}) {
  const [ref, W] = useWidth();
  const H = height;
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const top = yMax ?? niceCeil(Math.max(1e-9, ...series.flatMap((s) => s.values.filter(Number.isFinite)), ...hLines.map((h) => h.y)) * 1.04);
  const ticksY = [0, 0.5, 1].map((f) => yFormat(top * f));
  const L = Math.max(36, ...ticksY.map(textW)) + 10;
  const R = 14;
  const labelled = markers.filter((m) => m.label);
  // Marker labels get a strip above the plot so they never sit on the data.
  const T = labelled.length ? (labelled.length > 1 ? 38 : 26) : 14;
  const B = 24;
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - Math.min(v, top) / top) * (H - T - B);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number.isFinite(v) ? v : top).toFixed(1)}`).join(" ");
  const fx = xFormat ?? ((i: number) => { const v = i * xStep; return Number.isInteger(v) ? `${v}` : v.toFixed(xStep < 0.1 ? 2 : 1); });
  const xt = tickIndices(n, W - L - R, fx);
  return (
    <figure className="chart-wrap" ref={ref}>
      {yLabel && <figcaption className="chart-ylabel">{yLabel}</figcaption>}
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="simchart">
        {[0, 0.5, 1].map((f, k) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(top * f)} y2={y(top * f)} className="grid" />
            <text x={L - 8} y={y(top * f) + 4} className="axis" textAnchor="end">{ticksY[k]}</text>
          </g>
        ))}
        {hLines.map((h) => (
          <line key={h.label} x1={L} x2={W - R} y1={y(h.y)} y2={y(h.y)} stroke={h.color ?? "var(--muted)"} strokeDasharray="5 4" />
        ))}
        {(() => {
          let lastEnd = -Infinity;
          let row = 0;
          return [...markers].sort((a, b) => a.x - b.x).map((m) => {
            const mx = x(m.x);
            const flip = mx + textW(m.label) + 8 > W - R;
            const start = flip ? mx - textW(m.label) - 4 : mx + 4;
            row = start < lastEnd + 8 ? 1 - row : 0;
            if (m.label) lastEnd = start + textW(m.label);
            return (
              <g key={m.label + m.x}>
                <line x1={mx} x2={mx} y1={m.label ? 4 + row * 12 : T} y2={H - B} stroke={m.color ?? "var(--bad)"} strokeDasharray="4 3" />
                {m.label && <text x={flip ? mx - 5 : mx + 5} y={13 + row * 12} className="axis label-bg" textAnchor={flip ? "end" : "start"} fill={m.color ?? "var(--bad)"}>{m.label}</text>}
              </g>
            );
          });
        })()}
        {series.map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "6 4" : undefined} />
        ))}
        {hLines.map((h) => {
          const near = (i: number) => series.some((s) => Math.abs(y(s.values[Math.min(i, s.values.length - 1)] ?? 0) - y(h.y)) < 18);
          const left = near(n - 1) && !near(0);
          // Above the line unless that would leave the plot.
          const ty = y(h.y) - 5 < T + 10 ? y(h.y) + 14 : y(h.y) - 5;
          return <text key={h.label} x={left ? L + 6 : W - R - 4} y={ty} className="axis label-bg" textAnchor={left ? "start" : "end"} fill={h.color ?? "var(--muted)"}>{h.label}</text>;
        })}
        {xt.map((i, k) => (
          <text key={i} x={x(i)} y={H - 7} className="axis" textAnchor={k === 0 ? "start" : k === xt.length - 1 ? "end" : "middle"}>{fx(i)}</text>
        ))}
      </svg>
      <div className="chart-foot">
        <div className="legend">
          {series.map((s) => (
            <span key={s.name}><i style={{ background: s.color }} /> {s.name}</span>
          ))}
        </div>
        {xLabel && <span className="chart-xlabel">{xLabel}</span>}
      </div>
    </figure>
  );
}

export function Bars({ values, labels, color = () => "var(--accent)", height = 170, refLine, refLabel, yLabel, xLabel, yFormat = (v: number) => `${Math.round(v)}` }: {
  values: number[];
  yLabel?: string;
  xLabel?: string;
  labels?: string[];
  color?: (v: number, i: number) => string;
  height?: number;
  refLine?: number;
  refLabel?: string;
  yFormat?: (v: number) => string;
}) {
  const [ref, W] = useWidth();
  const H = height;
  const top = niceCeil(Math.max(1e-9, ...values, refLine ?? 0) * 1.06);
  const L = Math.max(30, textW(yFormat(top))) + 10;
  const R = 8;
  const T = 10;
  const B = labels ? 22 : 8;
  const bw = (W - L - R) / Math.max(1, values.length);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  // Show every k-th label so neighbours never overlap.
  const widest = Math.max(0, ...(labels ?? []).map(textW));
  const every = labels ? Math.max(1, Math.ceil((widest + 8) / Math.max(1, bw))) : 1;
  return (
    <figure className="chart-wrap" ref={ref}>
      {yLabel && <figcaption className="chart-ylabel">{yLabel}</figcaption>}
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="simchart">
        <line x1={L} x2={W - R} y1={y(top)} y2={y(top)} className="grid" />
        <line x1={L} x2={W - R} y1={y(top / 2)} y2={y(top / 2)} className="grid" />
        <text x={L - 8} y={y(top / 2) + 4} className="axis" textAnchor="end">{yFormat(top / 2)}</text>
        <text x={L - 8} y={y(top) + 4} className="axis" textAnchor="end">{yFormat(top)}</text>
        <text x={L - 8} y={y(0)} className="axis" textAnchor="end">0</text>
        {values.map((v, i) => (
          <g key={i}>
            <rect x={L + i * bw + Math.min(2, bw * 0.1)} y={y(v)} width={Math.max(1, bw - Math.min(4, bw * 0.2))} height={Math.max(0, y(0) - y(v))} fill={color(v, i)} rx={Math.min(3, bw / 4)} />
            {labels && i % every === 0 && <text x={L + i * bw + bw / 2} y={H - 6} className="axis" textAnchor="middle">{labels[i]}</text>}
          </g>
        ))}
        {refLine !== undefined && (
          <g>
            <line x1={L} x2={W - R} y1={y(refLine)} y2={y(refLine)} stroke="var(--warm)" strokeDasharray="5 4" />
            {refLabel && <text x={W - R - 4} y={y(refLine) - 5} className="axis label-bg" textAnchor="end" fill="var(--warm)">{refLabel}</text>}
          </g>
        )}
      </svg>
      {xLabel && <div className="chart-foot"><span className="chart-xlabel">{xLabel}</span></div>}
    </figure>
  );
}

export function Histogram({ values, bins = 40, max, unit = "ms", marks = [] }: { values: number[]; bins?: number; max?: number; unit?: string; marks?: { v: number; label: string }[] }) {
  const [ref, W] = useWidth();
  const hi = max ?? Math.max(1, ...values);
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((Math.min(v, hi) / hi) * bins))]++;
  const H = 170;
  const P = 10;
  const T = 26;
  const B = 24;
  const top = Math.max(...counts) * 1.1 || 1;
  const bw = (W - 2 * P) / bins;
  // Marks close together take turns on two label rows.
  let lastEnd = -Infinity;
  let row = 0;
  return (
    <div className="chart-wrap" ref={ref}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="simchart">
        {counts.map((c, i) => (
          <rect key={i} x={P + i * bw} y={H - B - (c / top) * (H - T - B)} width={Math.max(1, bw - 1)} height={(c / top) * (H - T - B)} fill="var(--accent)" opacity={0.75} />
        ))}
        {[...marks].sort((a, b) => a.v - b.v).map((m) => {
          const xx = P + (Math.min(m.v, hi) / hi) * (W - 2 * P);
          const flip = xx + textW(m.label) + 6 > W - P;
          const start = flip ? xx - textW(m.label) - 4 : xx + 4;
          row = start < lastEnd + 6 ? 1 - row : 0;
          lastEnd = start + textW(m.label);
          return (
            <g key={m.label}>
              <line x1={xx} x2={xx} y1={6} y2={H - B} stroke="var(--warm)" strokeDasharray="4 3" />
              <text x={flip ? xx - 4 : xx + 4} y={14 + row * 12} className="axis label-bg" textAnchor={flip ? "end" : "start"} fill="var(--warm)">{m.label}</text>
            </g>
          );
        })}
        <text x={P} y={H - 7} className="axis">0</text>
        <text x={W / 2} y={H - 7} className="axis" textAnchor="middle">{Math.round(hi / 2)} {unit}</text>
        <text x={W - P} y={H - 7} className="axis" textAnchor="end">{Math.round(hi)} {unit}</text>
      </svg>
    </div>
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
  useChatSource(`simulation:${def.id}`, {
    label: `Simulation · ${def.title}`,
    suggestions: ["What is this simulation showing me?", "What should I change to improve the result?", "Why does the result change when I move these sliders?"],
    build: () => {
      const e = EXPLAIN[def.id]?.(params, metrics);
      return simContext(
        def.title,
        def.blurb,
        params,
        metrics,
        Object.fromEntries(def.metricSpecs.map((m) => [m.key, m.label])),
        { scenario: e?.scenario ?? "", outcome: e?.outcome ?? "" },
        goals?.map((g) => ({ label: g.label, met: goalMet(g, metrics) })),
      );
    },
  });
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
