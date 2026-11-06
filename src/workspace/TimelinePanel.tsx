import { ArrowRight, Pause, Play, RotateCcw, Siren, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  GOAL,
  SLOW_MS,
  TIMELINE,
  answered,
  describeSecond,
  fmtBudget,
  fmtPct,
  fmtRps,
  incidentLabel,
  keyMoments,
  nodeTitle,
  summarize,
  type Incident,
  type SimNode,
  type Tick,
} from "../engine";
import { useWorkspace } from "../state/workspace";

/** One replay second every this many ms: slow enough to read the caption as it changes. */
const STEP_MS = 250;

function encode(i: Incident): string {
  return i.type === "nodeDown" ? `down:${i.nodeId}` : i.type === "spike" ? `spike:${i.factor}` : i.type;
}
function decode(v: string): Incident {
  if (v.startsWith("down:")) return { type: "nodeDown", nodeId: v.slice(5) };
  if (v.startsWith("spike:")) return { type: "spike", factor: +v.slice(6) };
  return { type: v as "none" | "cacheFlush" } as Incident;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const niceMax = (v: number) => [100, 200, 500, 1000, 2000, 5000].find((m) => m >= v) ?? Math.ceil(v / 1000) * 1000;

/**
 * Two charts on one time axis: did requests get answered (higher is better), and how long did the
 * slowest ones wait (lower is better). Drawn at the real pixel width so text stays crisp.
 */
function ReplayChart({ ticks, index, label, onSeek }: { ticks: Tick[]; index: number; label: string; onSeek: (i: number) => void }) {
  const [ref, W] = useWidth();
  const clip = useId().replace(/:/g, "");
  const n = ticks.length;
  const L = 52;
  const R = 12;
  const A = { top: 20, h: 58 };
  const B = { top: 102, h: 44 };
  const H = 172;
  const x = (t: number) => L + (t / (n - 1)) * (W - L - R);

  const rates = ticks.map(answered);
  const worst = Math.min(...rates);
  // the tightest scale that still shows the worst second, so a small dip is visible
  const lo = [0.98, 0.95, 0.9, 0.75, 0.5, 0].find((c) => c <= Math.min(0.98, worst - 0.003)) ?? 0;
  const yA = (v: number) => A.top + (1 - (Math.max(lo, v) - lo) / (1 - lo)) * A.h;
  const pMax = niceMax(Math.max(SLOW_MS * 1.25, ...ticks.map((k) => k.res.p99)));
  const yB = (v: number) => B.top + (1 - Math.min(v, pMax) / pMax) * B.h;

  const upTo = (vals: number[], y: (v: number) => number) => vals.slice(0, index + 1).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const okLine = upTo(rates, yA);
  const okArea = `${okLine} L${x(index).toFixed(1)},${yA(GOAL)} L${x(0)},${yA(GOAL)} Z`;
  const p99Line = upTo(ticks.map((k) => k.res.p99), yB);
  const { worst: worstAt, recovered } = keyMoments(ticks);
  const at = TIMELINE.at;
  const incidentText = `▲ ${at}s: ${label}`;
  const covered = (t: number) => x(t) > x(at) - 14 && x(t) < x(at) + incidentText.length * 6.2 + 12;

  const seek = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = Math.round(((e.clientX - box.left - L) / (W - L - R)) * (n - 1));
    onSeek(Math.max(0, Math.min(n - 1, t)));
  };

  return (
    <div ref={ref} className="replay-chart">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), seek(e))}
        onPointerMove={(e) => e.buttons && seek(e)}
        tabIndex={0}
        onKeyDown={(e) => {
          const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (d) (e.preventDefault(), onSeek(Math.max(0, Math.min(n - 1, index + d * (e.shiftKey ? 10 : 1)))));
        }}
        role="img"
        aria-label={`Replay chart: requests answered and slowest wait over ${n} seconds. Click, drag or use the arrow keys to move through time.`}
      >
        <defs>
          <clipPath id={`${clip}-ok`}><rect x={0} y={0} width={W} height={yA(GOAL)} /></clipPath>
          <clipPath id={`${clip}-bad`}><rect x={0} y={yA(GOAL)} width={W} height={H} /></clipPath>
          <clipPath id={`${clip}-fast`}><rect x={0} y={yB(SLOW_MS)} width={W} height={H} /></clipPath>
          <clipPath id={`${clip}-slow`}><rect x={0} y={0} width={W} height={yB(SLOW_MS)} /></clipPath>
        </defs>

        {/* the incident: shaded from the moment it hits */}
        <rect x={x(at)} y={A.top - 4} width={x(n - 1) - x(at)} height={B.top + B.h - A.top + 4} className="rc-band" />
        <line x1={x(at)} x2={x(at)} y1={A.top - 4} y2={B.top + B.h} className="rc-incident" />

        {/* pane 1: requests answered */}
        <text x={L} y={11} className="rc-title">Requests answered <tspan className="rc-sub">· higher is better</tspan></text>
        <line x1={L} x2={W - R} y1={yA(1)} y2={yA(1)} className="rc-grid" />
        <line x1={L} x2={W - R} y1={yA(GOAL)} y2={yA(GOAL)} className="rc-goal" />
        <line x1={L} x2={W - R} y1={A.top + A.h} y2={A.top + A.h} className="rc-axis-line" />
        {yA(GOAL) - yA(1) >= 11 && <text x={L - 6} y={yA(1) + 4} className="rc-y">100%</text>}
        <text x={L - 6} y={yA(GOAL) + 4} className="rc-y goal">99%</text>
        <text x={L - 6} y={A.top + A.h + 4} className="rc-y">{Math.round(lo * 100)}%</text>
        <path d={okArea} className="rc-area" clipPath={`url(#${clip}-ok)`} />
        <path d={okArea} className="rc-area bad" clipPath={`url(#${clip}-bad)`} />
        <path d={okLine} className="rc-ok" clipPath={`url(#${clip}-ok)`} />
        <path d={okLine} className="rc-ok bad" clipPath={`url(#${clip}-bad)`} />

        {/* pane 2: slowest 1% wait */}
        <text x={L} y={B.top - 9} className="rc-title">Slowest 1% wait (p99) <tspan className="rc-sub">· lower is better</tspan></text>
        <line x1={L} x2={W - R} y1={yB(pMax)} y2={yB(pMax)} className="rc-grid" />
        <line x1={L} x2={W - R} y1={yB(SLOW_MS)} y2={yB(SLOW_MS)} className="rc-goal warn" />
        <line x1={L} x2={W - R} y1={yB(0)} y2={yB(0)} className="rc-axis-line" />
        <text x={L - 6} y={yB(pMax) + 4} className="rc-y">{pMax >= 1000 ? `${pMax / 1000} s` : `${pMax} ms`}</text>
        <text x={L - 6} y={yB(SLOW_MS) + 4} className="rc-y warn">{SLOW_MS} ms</text>
        <text x={L - 6} y={yB(0) + 4} className="rc-y">0</text>
        <path d={p99Line} className="rc-p99" clipPath={`url(#${clip}-fast)`} />
        <path d={p99Line} className="rc-p99 slow" clipPath={`url(#${clip}-slow)`} />

        {/* key moments, revealed as the replay reaches them */}
        {worstAt !== null && index >= worstAt && (
          <g>
            <circle cx={x(worstAt)} cy={yA(rates[worstAt])} r={4} className="rc-dot bad" />
            <text x={x(worstAt) + (worstAt > n * 0.75 ? -8 : 8)} y={yA(rates[worstAt]) > A.top + A.h - 16 ? yA(rates[worstAt]) - 8 : yA(rates[worstAt]) + 16} className={`rc-note bad${worstAt > n * 0.75 ? " end" : ""}`}>
              worst: {fmtPct(rates[worstAt])}
            </text>
          </g>
        )}
        {recovered !== null && index >= recovered && (
          <g>
            <line x1={x(recovered)} x2={x(recovered)} y1={A.top} y2={B.top + B.h} className="rc-recovered" />
            <text x={x(recovered) + (recovered > n * 0.75 ? -5 : 5)} y={A.top + 10} className={`rc-note good${recovered > n * 0.75 ? " end" : ""}`}>back to normal</text>
          </g>
        )}

        {/* playhead */}
        <line x1={x(index)} x2={x(index)} y1={A.top - 4} y2={B.top + B.h} className="rc-head" />
        <circle cx={x(index)} cy={yA(rates[index])} r={3.5} className={`rc-dot ${rates[index] >= GOAL ? "good" : "bad"}`} />
        <circle cx={x(index)} cy={yB(ticks[index].res.p99)} r={3.5} className={`rc-dot ${ticks[index].res.p99 > SLOW_MS ? "bad" : "warm"}`} />

        {/* time axis, with the incident called out where it happens */}
        {Array.from({ length: Math.floor((n - 1) / 10) + 1 }, (_, i) => i * 10).map((t) =>
          covered(t) ? null : <text key={t} x={x(t)} y={H - 4} className="rc-x">{t}s</text>,
        )}
        <text x={x(at)} y={H - 4} className="rc-x incident">{incidentText}</text>
      </svg>
    </div>
  );
}

function incidentStory(incident: Incident, nodes: SimNode[], res: { retries: boolean; dbFailover: boolean }): string {
  const at = TIMELINE.at;
  const retry = res.retries ? " Failed requests get retried, which adds load." : " Failed requests are not retried.";
  switch (incident.type) {
    case "none":
      return `Nothing fails: ${TIMELINE.seconds} s of steady traffic. A baseline to compare against.`;
    case "spike":
      return `At ${at} s traffic jumps ${incident.factor}× and stays there, like a TV ad or a viral post. Does anything run out of room?${retry}`;
    case "cacheFlush":
      return `At ${at} s the cache restarts empty. Every read misses and hits the database at once (a stampede); the cache refills only as fast as the database answers.${retry}`;
    case "nodeDown": {
      const n = nodes.find((x) => x.id === incident.nodeId);
      const name = n ? nodeTitle(n, nodes) : "a component";
      if (n?.kind === "db" && n.config.role !== "replica")
        return `At ${at} s ${name} dies. Reads can continue from replicas; writes need a new primary: ${res.dbFailover ? `failover promotes a replica after ${TIMELINE.failoverSeconds} s` : "DB failover is off, so they fail until it's back"}.${retry}`;
      if (n?.kind === "server") return `At ${at} s ${name} dies. Can the load balancer route around it, and do the others have room for its share?${retry}`;
      return `At ${at} s ${name} dies.${retry}`;
    }
  }
}

const PHASES = [
  ["0–10 s", "normal traffic"],
  ["10 s", "it goes wrong"],
  ["10–60 s", "does it cope and recover?"],
];

/** What one second of the replay means, in words. */
function NowCard({ ticks, index, incident }: { ticks: Tick[]; index: number; incident: Incident }) {
  const graph = useWorkspace((s) => s.graph);
  const resilience = useWorkspace((s) => s.resilience);
  const m = describeSecond(graph, ticks, index, incident, resilience);
  const k = ticks[index];
  const rate = answered(k);
  return (
    <div className="replay-now" aria-live="polite">
      <div className="row between">
        <span className="replay-t">t = {k.t} s</span>
        <span className={`pill ${m.tone}`}>{m.label}</span>
      </div>
      <b className="replay-headline">{m.headline}</b>
      {m.why.length > 0 && <ul>{m.why.slice(0, 3).map((w) => <li key={w}>{w}</li>)}</ul>}
      <div className="replay-stats">
        <span><small>Answered</small><b className={rate >= GOAL ? "good" : "bad"}>{fmtPct(rate)}</b></span>
        <span><small>Slowest 1%</small><b className={k.res.p99 > SLOW_MS ? "bad" : ""}>{k.res.p99} ms</b></span>
        <span><small>Requests/s</small><b>{fmtRps(k.res.legit)}</b></span>
      </div>
    </div>
  );
}

/** The result of the whole run, each number with what it means. */
function ResultCard({ ticks }: { ticks: Tick[] }) {
  const s = useMemo(() => summarize(ticks), [ticks]);
  const ok = s.worstSuccess >= GOAL;
  const tiles = [
    { label: "Worst second", value: fmtPct(s.worstSuccess), cls: ok ? "good" : "bad", note: "of requests answered" },
    ok
      ? { label: "Slowest wait", value: `${s.worstP99} ms`, cls: s.worstP99 > SLOW_MS ? "bad" : "", note: "peak p99 (slowest 1%)" }
      : { label: "Back to normal", value: s.recoverySeconds === null ? "never" : `after ${s.recoverySeconds} s`, cls: s.recoverySeconds === null ? "bad" : "", note: s.recoverySeconds === null ? "still failing at 60 s" : "above 99% again" },
    { label: "Failed requests", value: fmtRps(s.failedTotal), cls: s.failedTotal > 0.5 ? "bad" : "good", note: "users who saw an error" },
    { label: "Error budget", value: fmtBudget(s.budgetUsed), cls: s.budgetUsed > 0.25 ? "bad" : "", note: "of a month's, used up", tip: "A 99.9% success target allows about 43 minutes of errors a month. This is the share of that allowance this one incident used." },
  ];
  return (
    <div className="replay-result">
      <div className="row between">
        <b className="replay-headline">{ok ? "It held up. Users barely noticed." : s.recoverySeconds === null ? "It broke and didn't recover." : "It broke, then recovered."}</b>
      </div>
      <div className="replay-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="sum-tile" title={"tip" in t ? t.tip : t.note}>
            <small>{t.label}</small>
            <b className={t.cls}>{t.value}</b>
            <span>{t.note}</span>
          </div>
        ))}
      </div>
      {s.finalBacklog > 0.5 && <p className="hint">{fmtRps(s.finalBacklog)} jobs were still queued at the end.</p>}
      <button className="btn small" onClick={() => useWorkspace.getState().setRightTab("guide")}>
        Why it happened and how to fix it <ArrowRight size={14} />
      </button>
    </div>
  );
}

export function TimelinePanel() {
  const graph = useWorkspace((s) => s.graph);
  const nodes = graph.nodes;
  const incident = useWorkspace((s) => s.incident);
  const resilience = useWorkspace((s) => s.resilience);
  const playback = useWorkspace((s) => s.playback);
  const { setIncident, setResilience, runIncident, setPlayback, stopPlayback } = useWorkspace.getState();

  useEffect(() => {
    if (!playback.playing || !playback.ticks) return;
    const t = setInterval(() => {
      const s = useWorkspace.getState().playback;
      if (!s.ticks) return;
      if (s.index >= s.ticks.length - 1) setPlayback({ playing: false });
      else setPlayback({ index: s.index + 1 });
    }, STEP_MS);
    return () => clearInterval(t);
  }, [playback.playing, playback.ticks, setPlayback]);

  const done = !!playback.ticks && playback.index >= playback.ticks.length - 1;
  useEffect(() => {
    if (done) useWorkspace.getState().setRightTab("guide");
  }, [done]);

  const label = incidentLabel(incident, graph);
  const killable = nodes.filter((n) => n.kind !== "client");

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <span className="timeline-title"><Siren size={15} /> Stress test</span>
        <label className="incident-select">
          <span className="muted small">At {TIMELINE.at} s:</span>
          <select value={encode(incident)} onChange={(e) => setIncident(decode(e.target.value))} aria-label="What goes wrong">
            <option value="none">Nothing - steady traffic (baseline)</option>
            <optgroup label="More traffic">
              <option value="spike:3">Traffic spike (3×)</option>
              <option value="spike:10">Viral moment (10×)</option>
            </optgroup>
            <optgroup label="Something breaks">
              <option value="cacheFlush">Cache restart (cold cache)</option>
              {killable.map((n) => (
                <option key={n.id} value={`down:${n.id}`}>Kill: {nodeTitle(n, nodes)}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="chip-toggle" title="Users' apps retry a failed request. More realistic, but retries add load right when the system is struggling.">
          <input type="checkbox" className="switch sm" checked={resilience.retries} onChange={(e) => setResilience({ retries: e.target.checked })} />
          Clients retry
        </label>
        <label className="chip-toggle" title="If the primary database dies, promote a replica to take its place after a short detection delay.">
          <input type="checkbox" className="switch sm" checked={resilience.dbFailover} onChange={(e) => setResilience({ dbFailover: e.target.checked })} />
          DB failover
        </label>
        <span className="grow" />
        {playback.ticks ? (
          <div className="player">
            <button
              className="icon-btn"
              onClick={() => (done ? setPlayback({ index: 0, playing: true }) : setPlayback({ playing: !playback.playing }))}
              title={playback.playing ? "Pause (Space)" : done ? "Replay" : "Resume (Space)"}
              aria-label={playback.playing ? "Pause" : done ? "Replay" : "Resume"}
            >
              {playback.playing ? <Pause size={17} /> : done ? <RotateCcw size={17} /> : <Play size={17} />}
            </button>
            <span className="player-time">{playback.index} s <span className="muted">/ {playback.ticks.length - 1} s</span></span>
            <button className="btn small ghost" onClick={stopPlayback} title="Close the replay and go back to the live simulation"><X size={14} /> Close</button>
          </div>
        ) : (
          <button className="btn primary" onClick={runIncident} title={`Replay ${TIMELINE.seconds} seconds, second by second`}>
            <Play size={15} /> Run {TIMELINE.seconds} s test
          </button>
        )}
      </div>
      {playback.ticks ? (
        <div className="timeline-body">
          <ReplayChart ticks={playback.ticks} index={playback.index} label={label} onSeek={(i) => setPlayback({ index: i, playing: false })} />
          {done ? <ResultCard ticks={playback.ticks} /> : <NowCard ticks={playback.ticks} index={playback.index} incident={incident} />}
        </div>
      ) : (
        <div className="timeline-preview">
          <ol className="timeline-phases">
            {PHASES.map(([t, what], i) => (
              <li key={t} className={i === 1 ? "hit" : ""}><b>{t}</b> {i === 1 && incident.type !== "none" ? label : what}</li>
            ))}
          </ol>
          <p className="timeline-hint">{incidentStory(incident, nodes, resilience)}</p>
        </div>
      )}
    </div>
  );
}
