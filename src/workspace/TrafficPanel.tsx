import { Bot, Lock, PenLine, Eye } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fmtRps, type Traffic } from "../engine";
import { useWorkspace } from "../state/workspace";

const MAX_EXP = 6; // slider tops out at 1,000,000 req/s
const toPos = (v: number) => (v <= 0 ? 0 : Math.round((Math.log10(v) / MAX_EXP) * 1000));
const fromPos = (p: number) => (p <= 0 ? 0 : Math.round(10 ** ((p / 1000) * MAX_EXP)));
const nice = (v: number) => {
  if (v < 10) return v;
  const mag = 10 ** Math.floor(Math.log10(v) - 1);
  return Math.round(v / mag) * mag;
};

function Row({ label, k, hint, icon: Icon, locked }: { label: string; k: keyof Traffic; hint: string; icon: LucideIcon; locked?: boolean }) {
  const v = useWorkspace((s) => s.traffic[k]);
  const setTraffic = useWorkspace((s) => s.setTraffic);
  return (
    <label className="traffic-row">
      <span className="row between">
        <span className="traffic-label"><Icon size={15} /> {label}</span>
        {locked ? (
          <b className="traffic-value">{fmtRps(v)}/s</b>
        ) : (
          <span className="num-wrap">
            <input className="num" type="number" min={0} value={v} onChange={(e) => setTraffic({ [k]: Math.max(0, +e.target.value) } as Partial<Traffic>)} />
            <span className="muted small">/s</span>
          </span>
        )}
      </span>
      {!locked && (
        <input type="range" min={0} max={1000} value={toPos(v)} onChange={(e) => setTraffic({ [k]: nice(fromPos(+e.target.value)) } as Partial<Traffic>)} />
      )}
      <span className="help">{hint}</span>
    </label>
  );
}

function Scale() {
  const traffic = useWorkspace((s) => s.traffic);
  const setTraffic = useWorkspace((s) => s.setTraffic);
  const by = (f: number) => setTraffic({ reads: Math.round(traffic.reads * f), writes: Math.round(traffic.writes * f), bots: Math.round(traffic.bots * f) });
  return (
    <div className="scale">
      <span className="tag">Scale all</span>
      <div className="segmented small">
        <button onClick={() => by(0.5)} title="Halve the traffic">÷2</button>
        <button onClick={() => by(2)} title="Double the traffic">×2</button>
        <button onClick={() => by(10)} title="A viral moment">×10</button>
      </div>
    </div>
  );
}

export function TrafficPanel({ locked }: { locked?: boolean }) {
  const bots = useWorkspace((s) => s.traffic.bots);
  const setTraffic = useWorkspace((s) => s.setTraffic);
  return (
    <div className="traffic">
      {locked ? (
        <p className="locked-note"><Lock size={14} /> The lab fixes the traffic so every design is tested the same way.</p>
      ) : (
        <Scale />
      )}
      <Row label="Reads" k="reads" icon={Eye} hint="Page views, lookups, redirects" locked={locked} />
      <Row label="Writes" k="writes" icon={PenLine} hint="Creates and updates - they always reach the primary DB (or a queue)" locked={locked} />
      <Row label="Bot traffic" k="bots" icon={Bot} hint="A scraper hitting random URLs from a few IPs" locked={locked} />
      {!locked && (
        <label className="setting switch-row">
          <span className="setting-text">
            <span className="setting-label">Unleash a scraper</span>
            <span className="help">Adds 30k bot req/s. Can your design tell them apart from users?</span>
          </span>
          <input type="checkbox" className="switch" checked={bots > 0} onChange={() => setTraffic({ bots: bots ? 0 : 30000 })} />
        </label>
      )}
    </div>
  );
}
