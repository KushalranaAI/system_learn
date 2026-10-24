import { Pause, Play, RotateCcw, Siren, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { TIMELINE, fmtRps, nodeTitle, summarize, type Incident, type SimNode, type Tick } from "../engine";
import { useWorkspace } from "../state/workspace";

function encode(i: Incident): string {
  return i.type === "nodeDown" ? `down:${i.nodeId}` : i.type === "spike" ? `spike:${i.factor}` : i.type;
}
function decode(v: string): Incident {
  if (v.startsWith("down:")) return { type: "nodeDown", nodeId: v.slice(5) };
  if (v.startsWith("spike:")) return { type: "spike", factor: +v.slice(6) };
  return { type: v as "none" | "cacheFlush" } as Incident;
}

function Chart({ ticks, index }: { ticks: Tick[]; index: number }) {
  const W = 600;
  const H = 120;
  const pad = 26;
  const n = ticks.length;
  const x = (t: number) => pad + (t / (n - 1)) * (W - pad * 2);
  const ok = ticks.map((k) => (k.res.legit ? Math.min(1, k.res.success / k.res.legit) : 1));
  const maxP = Math.max(100, ...ticks.map((k) => k.res.p99));
  const yOk = (v: number) => 8 + (1 - v) * (H - 24);
  const yP = (v: number) => 8 + (1 - v / maxP) * (H - 24);
  const line = (vals: number[], y: (v: number) => number) =>
    vals.slice(0, index + 1).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1={x(TIMELINE.at)} x2={x(TIMELINE.at)} y1={4} y2={H - 14} className="chart-incident" />
      <text x={x(TIMELINE.at) + 4} y={14} className="chart-text">failure</text>
      <line x1={pad} x2={W - pad} y1={yOk(0.99)} y2={yOk(0.99)} className="chart-grid" />
      <text x={2} y={yOk(0.99) + 3} className="chart-text">99%</text>
      <path d={line(ok, yOk)} className="chart-ok" />
      <path d={line(ticks.map((k) => k.res.p99), yP)} className="chart-p99" />
      <line x1={x(index)} x2={x(index)} y1={4} y2={H - 14} className="chart-head" />
      <text x={pad} y={H - 2} className="chart-text">0s</text>
      <text x={W - pad - 16} y={H - 2} className="chart-text">{n}s</text>
      <text x={W - 170} y={14} className="chart-text"><tspan className="ok">━ success</tspan>  <tspan className="p99">━ p99 (max {maxP} ms)</tspan></text>
    </svg>
  );
}

function incidentStory(incident: Incident, nodes: SimNode[], res: { retries: boolean; dbFailover: boolean }): string {
  const at = TIMELINE.at;
  const retry = res.retries ? " Clients retry failed requests, which adds load." : " Clients don't retry.";
  switch (incident.type) {
    case "none":
      return `Nothing fails: ${TIMELINE.seconds} s of steady traffic. Pick an incident to see how the design copes.`;
    case "spike":
      return `At t=${at} s traffic jumps ${incident.factor}× and stays there - like a TV ad or a viral post. Does anything run out of capacity?${retry}`;
    case "cacheFlush":
      return `At t=${at} s the cache restarts empty. Every read misses and hits the database at once (a stampede); the cache refills only as fast as the database answers.${retry}`;
    case "nodeDown": {
      const n = nodes.find((x) => x.id === incident.nodeId);
      const name = n ? nodeTitle(n, nodes) : "a component";
      if (n?.kind === "db" && n.config.role !== "replica")
        return `At t=${at} s ${name} dies. Reads can continue from replicas; writes need a new primary - ${res.dbFailover ? `automatic failover promotes a replica after ${TIMELINE.failoverSeconds} s` : "and failover is OFF, so they fail until it's back"}.${retry}`;
      if (n?.kind === "server") return `At t=${at} s ${name} dies. Can the load balancer route around it, and do the others have room for its share?${retry}`;
      return `At t=${at} s ${name} dies.${retry}`;
    }
  }
}

export function TimelinePanel() {
  const nodes = useWorkspace((s) => s.graph.nodes);
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
    }, 180);
    return () => clearInterval(t);
  }, [playback.playing, playback.ticks, setPlayback]);

  const summary = useMemo(() => (playback.ticks ? summarize(playback.ticks) : null), [playback.ticks]);
  const done = playback.ticks && playback.index >= playback.ticks.length - 1;
  useEffect(() => {
    if (done) useWorkspace.getState().setRightTab("guide");
  }, [done]);

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <label className="incident-select" title="What goes wrong at t=10s">
          <Siren size={15} />
          <select value={encode(incident)} onChange={(e) => setIncident(decode(e.target.value))} aria-label="Incident">
            <option value="none">No incident - steady traffic</option>
            <option value="spike:3">Traffic spike (3x)</option>
            <option value="spike:10">Viral moment (10x)</option>
            <option value="cacheFlush">Cache restart (cold cache)</option>
            {nodes
              .filter((n) => n.kind !== "client")
              .map((n) => (
                <option key={n.id} value={`down:${n.id}`}>
                  Kill: {nodeTitle(n, nodes)}
                </option>
              ))}
          </select>
        </label>
        <label className="chip-toggle" title="Failed requests are retried, which adds load">
          <input type="checkbox" className="switch sm" checked={resilience.retries} onChange={(e) => setResilience({ retries: e.target.checked })} />
          Clients retry
        </label>
        <label className="chip-toggle" title="Promote a replica when the primary database dies">
          <input type="checkbox" className="switch sm" checked={resilience.dbFailover} onChange={(e) => setResilience({ dbFailover: e.target.checked })} />
          DB failover
        </label>
        <span className="grow" />
        {playback.ticks ? (
          <div className="player">
            <button className="icon-btn" onClick={() => (done ? setPlayback({ index: 0, playing: true }) : setPlayback({ playing: !playback.playing }))} title={playback.playing ? "Pause (Space)" : done ? "Replay" : "Resume (Space)"}>
              {playback.playing ? <Pause size={17} /> : done ? <RotateCcw size={17} /> : <Play size={17} />}
            </button>
            <input
              type="range"
              min={0}
              max={playback.ticks.length - 1}
              value={playback.index}
              onChange={(e) => setPlayback({ index: +e.target.value, playing: false })}
              aria-label="Timeline position"
            />
            <span className="player-time">{playback.index}s / {playback.ticks.length - 1}s</span>
            <button className="btn small ghost" onClick={stopPlayback} title="Return to the live simulation"><X size={14} /> Live</button>
          </div>
        ) : (
          <button className="btn primary" onClick={runIncident}>
            <Play size={15} /> Run {TIMELINE.seconds}s timeline
          </button>
        )}
      </div>
      {playback.ticks ? (
        <div className="timeline-body">
          <Chart ticks={playback.ticks} index={playback.index} />
          {summary && done ? (
            <div className="summary">
              <div className="sum-tile"><small>Worst second</small><b className={summary.worstSuccess >= 0.99 ? "good" : "bad"}>{(summary.worstSuccess * 100).toFixed(1)}%</b></div>
              <div className="sum-tile"><small>Recovery</small><b>{summary.recoverySeconds === null ? "never" : `${summary.recoverySeconds}s`}</b></div>
              <div className="sum-tile"><small>Failed requests</small><b>{fmtRps(summary.failedTotal)}</b></div>
              <div className="sum-tile" title="Of a 99.9% monthly SLO"><small>Error budget</small><b className={summary.budgetUsed > 0.25 ? "bad" : ""}>{(summary.budgetUsed * 100).toFixed(1)}%</b></div>
              {summary.finalBacklog > 0 && <div className="sum-tile"><small>Backlog</small><b>{fmtRps(summary.finalBacklog)}</b></div>}
              <p className="sum-note">The full story and fixes are in the Guide tab.</p>
            </div>
          ) : (
            <div className="summary"><p className="sum-note">Playing… press Space to pause.</p></div>
          )}
        </div>
      ) : (
        <p className="timeline-hint">{incidentStory(incident, nodes, resilience)}</p>
      )}
    </div>
  );
}
