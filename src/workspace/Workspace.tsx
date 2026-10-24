import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Compass, Info, SlidersHorizontal, TrendingUp } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { NodeKind } from "../engine";
import { useWorkspace } from "../state/workspace";
import { Board } from "./Board";
import { Hud } from "./Hud";
import { Inspector } from "./Inspector";
import { GuidePanel } from "./GuidePanel";
import { Palette } from "./Palette";
import { SimProvider, useSim } from "./sim";
import { TimelinePanel } from "./TimelinePanel";
import { TrafficPanel } from "./TrafficPanel";

function Toast() {
  const toast = useWorkspace((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  return visible && toast ? (
    <div className="toast" role="status" onClick={() => setVisible(false)}>
      <Info size={16} /> <span>{toast.text}</span>
    </div>
  ) : null;
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
      const s = useWorkspace.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) (e.preventDefault(), s.undo());
      else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) (e.preventDefault(), s.redo());
      else if (!mod && e.key.toLowerCase() === "p") s.togglePresenter();
      else if (!mod && e.key.toLowerCase() === "l") s.layout();
      else if (e.key === "Escape" && s.presenter) s.togglePresenter();
      else if (e.key === " " && s.playback.ticks) {
        e.preventDefault();
        s.setPlayback({ playing: !s.playback.playing });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function RightTabs({ trafficLocked }: { trafficLocked?: boolean }) {
  const tab = useWorkspace((s) => s.rightTab);
  const setTab = useWorkspace((s) => s.setRightTab);
  const sim = useSim();
  const problems = sim.issues.filter((i) => i.severity !== "info").length;
  const tabs = [
    { id: "guide", label: "Guide", icon: Compass, badge: problems },
    { id: "component", label: "Component", icon: SlidersHorizontal, badge: 0 },
    { id: "traffic", label: "Traffic", icon: TrendingUp, badge: 0 },
  ] as const;
  return (
    <>
      <div className="tabs" role="tablist">
        {tabs.map(({ id, label, icon: Icon, badge }) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            <Icon size={15} /> {label}
            {badge > 0 && <span className="tab-badge">{badge}</span>}
          </button>
        ))}
      </div>
      <div className="tabbody">
        {tab === "guide" && <GuidePanel />}
        {tab === "component" && <Inspector />}
        {tab === "traffic" && <TrafficPanel locked={trafficLocked} />}
      </div>
    </>
  );
}

export interface WorkspaceProps {
  left?: ReactNode;
  palette?: NodeKind[];
  trafficLocked?: boolean;
  showTimeline?: boolean;
  /** what the left panel holds, for the collapse button's label */
  leftLabel?: string;
}

export function Workspace({ left, palette, trafficLocked, showTimeline = true, leftLabel = "panel" }: WorkspaceProps) {
  const presenter = useWorkspace((s) => s.presenter);
  // lab instructions hold the Run button, so they start open even on narrow screens (as an overlay)
  const [leftOpen, setLeftOpen] = useState(() => leftLabel === "instructions" || typeof window === "undefined" || window.innerWidth >= 1100);
  useShortcuts();
  const showLeft = !!left && leftOpen && !presenter;
  return (
    <ReactFlowProvider>
      <SimProvider>
        <div className={`ws${presenter ? " presenter" : ""}${showLeft ? "" : " no-left"}`}>
          {showLeft && <aside className="ws-left">{left}</aside>}
          <main className="ws-main">
            <Hud left={left ? { open: leftOpen, toggle: () => setLeftOpen((o) => !o), label: leftLabel } : undefined} />
            <div className="ws-stage">
              {!presenter && <Palette kinds={palette} />}
              <div className="ws-board">
                <Board />
                <Toast />
                {presenter && <div className="presenter-hint">Presenter mode · press P or Esc to exit</div>}
              </div>
            </div>
            {showTimeline && <TimelinePanel />}
          </main>
          {!presenter && (
            <aside className="ws-right">
              <RightTabs trafficLocked={trafficLocked} />
            </aside>
          )}
        </div>
      </SimProvider>
    </ReactFlowProvider>
  );
}
