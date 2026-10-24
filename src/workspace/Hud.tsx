import { LayoutGrid, MonitorPlay, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Redo2, Rows3, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { fmtRps } from "../engine";
import { useWorkspace } from "../state/workspace";
import { useSim } from "./sim";

function Metric({ label, children, tone = "", hint }: { label: string; children: ReactNode; tone?: string; hint?: string }) {
  return (
    <div className="metric" title={hint}>
      <span className="label">{label}</span>
      <span className={`value ${tone}`}>{children}</span>
    </div>
  );
}

/** The status bar above the canvas: the live numbers, plus canvas tools. */
export function Hud({ left, right }: { left?: { open: boolean; toggle: () => void; label: string }; right?: { open: boolean; toggle: () => void } }) {
  const sim = useSim();
  const playback = useWorkspace((s) => s.playback);
  const presenter = useWorkspace((s) => s.presenter);
  const detailed = useWorkspace((s) => s.detailed);
  const past = useWorkspace((s) => s.past.length);
  const future = useWorkspace((s) => s.future.length);
  const profileId = useWorkspace((s) => s.profileId);
  const { undo, redo, layout, toggleDetailed, togglePresenter } = useWorkspace.getState();
  const tick = playback.ticks?.[playback.index];
  const rate = sim.successRate;
  const rateCls = rate >= 0.999 ? "good" : rate >= 0.99 ? "warm" : "bad";
  const p99Cls = sim.p99 <= 100 ? "good" : sim.p99 <= 300 ? "warm" : "bad";
  return (
    <div className="hud">
      {left && !presenter && (
        <button className="icon-btn" onClick={left.toggle} title={left.open ? `Hide ${left.label}` : `Show ${left.label}`} aria-label={left.open ? `Hide ${left.label}` : `Show ${left.label}`}>
          {left.open ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      )}
      <div className="metrics">
        <Metric label="Success" tone={sim.legit ? rateCls : ""} hint="Share of real users' requests answered">
          {sim.legit ? `${(rate * 100).toFixed(rate >= 0.999 ? 2 : 1)}%` : "-"}
        </Metric>
        <Metric label="p99 latency" tone={sim.success ? p99Cls : ""} hint="99 of 100 requests finish faster than this">
          {sim.success ? `${sim.p99} ms` : "-"}
        </Metric>
        <Metric label="Throughput">{fmtRps(sim.success)}/s</Metric>
        <Metric label="Cost">${sim.monthlyUsd.toLocaleString()}/mo</Metric>
        {sim.bots > 0 && (
          <Metric label="Bots blocked" tone={sim.botsBlocked / sim.bots > 0.95 ? "good" : "bad"}>
            {Math.round((sim.botsBlocked / sim.bots) * 100)}%
          </Metric>
        )}
        {sim.legitLimited > 0.5 && <Metric label="Users 429'd" tone="bad">{fmtRps(sim.legitLimited)}/s</Metric>}
        {sim.lagMs > 0 && <Metric label="Replica lag">{Math.round(sim.lagMs)} ms</Metric>}
        {sim.sagaOrders > 0 && (
          <Metric label="Inconsistent" tone={sim.inconsistent > 0.01 ? "bad" : "good"}>
            {sim.inconsistent > 0.01 ? `${fmtRps(sim.inconsistent)}/s` : "none"}
          </Metric>
        )}
        {sim.eventsIn > 0 && (
          <Metric label="Consumer lag" tone={sim.lagGrowth > 0.5 ? "bad" : "good"}>
            {tick ? fmtRps(tick.lag) : sim.lagGrowth > 0.5 ? `+${fmtRps(sim.lagGrowth)}/s` : "keeping up"}
          </Metric>
        )}
        {tick && (
          <Metric label="Timeline" tone="accent">
            t={tick.t}s{tick.backlog > 0 ? ` · ${fmtRps(tick.backlog)} queued` : ""}
          </Metric>
        )}
      </div>
      <span className="grow" />
      {!presenter && (
        <div className="tools">
          {profileId === "measured" && <span className="pill accent" title="Capacities measured on this computer">My machine</span>}
          <button className="icon-btn" onClick={undo} disabled={!past} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={17} /></button>
          <button className="icon-btn" onClick={redo} disabled={!future} title="Redo (Ctrl+Y)" aria-label="Redo"><Redo2 size={17} /></button>
          <span className="tool-sep" />
          <button className="icon-btn" onClick={layout} title="Tidy the layout (L)" aria-label="Tidy layout"><LayoutGrid size={17} /></button>
          <button className={`icon-btn${detailed ? " on" : ""}`} onClick={toggleDetailed} title={detailed ? "Show fewer numbers on cards" : "Show more numbers on cards"} aria-pressed={detailed} aria-label="Detailed cards"><Rows3 size={17} /></button>
          {right && (
            <button className={`icon-btn${right.open ? " on" : ""}`} onClick={right.toggle} title={right.open ? "Hide the guide panel" : "Show the guide panel"} aria-pressed={right.open} aria-label={right.open ? "Hide guide panel" : "Show guide panel"}>
              {right.open ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
            </button>
          )}
          <button className="icon-btn" onClick={togglePresenter} title="Presenter mode for recording (P)" aria-label="Presenter mode"><MonitorPlay size={17} /></button>
        </div>
      )}
    </div>
  );
}
