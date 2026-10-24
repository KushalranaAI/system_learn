import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Compass, Info, Maximize2, Minimize2, SlidersHorizontal, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { designContext, timelineContext } from "../ai/context";
import { explainDesign, nodeTitle, type NodeKind } from "../engine";
import { useChatSource } from "../chat/store";
import { useWorkspace } from "../state/workspace";
import { Board } from "./Board";
import { Hud } from "./Hud";
import { Inspector } from "./Inspector";
import { GuidePanel } from "./GuidePanel";
import { Palette } from "./Palette";
import { LEFT, RIGHT, Resizer, usePanels } from "./panels";
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

/** Tells the chat what is on the canvas: the design, traffic, incident and live results. Read only when a question is sent. */
function WorkspaceChatSource() {
  const sim = useSim();
  const nodeCount = useWorkspace((s) => s.graph.nodes.length);
  const selectedName = useWorkspace((s) => {
    const n = s.graph.nodes.find((x) => x.id === s.selected);
    return n ? nodeTitle(n, s.graph.nodes) : null;
  });
  const simRef = useRef(sim);
  simRef.current = sim;
  useChatSource("canvas", {
    label: nodeCount > 1 ? `Your design · ${nodeCount} components` : "An empty canvas",
    suggestions:
      nodeCount > 1
        ? [
            "Why is my design failing, or what breaks first?",
            "What happens if traffic doubles?",
            ...(selectedName ? [`Explain the ${selectedName} I selected`] : ["How could I cut the cost?"]),
            "Explain this design like I'm new to system design",
          ]
        : ["How do I start building a system?", "What does a load balancer do?", "Which components should I add first?"],
    build: () => {
      const s = useWorkspace.getState();
      if (s.graph.nodes.length === 0) return { note: "The canvas is empty." };
      const res = simRef.current;
      const guide = explainDesign(s.graph, s.traffic, res, s.resilience);
      const base = designContext(s.graph, s.traffic, res, s.resilience, guide);
      const sel = s.graph.nodes.find((n) => n.id === s.selected);
      const ctx = s.playback.ticks ? timelineContext(base, s.playback.ticks, s.incident, []) : base;
      return {
        ...ctx,
        selectedComponent: sel ? nodeTitle(sel, s.graph.nodes) : null,
        takenDown: s.down,
        timelinePlayback: s.playback.ticks ? { atSecond: s.playback.index, of: s.playback.ticks.length - 1, playing: s.playback.playing } : null,
        capacityProfile: s.profileId === "measured" ? "measured on the learner's own machine" : "reference teaching numbers",
        selectedIncident: s.incident,
      };
    },
  });
  return null;
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

function RightTabs({ trafficLocked, wide, onWide }: { trafficLocked?: boolean; wide: boolean; onWide: () => void }) {
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
        <button className="icon-btn sm tabs-wide" onClick={onWide} title={wide ? "Make the panel narrower" : "Make the panel wider for easier reading"} aria-label={wide ? "Narrower panel" : "Wider panel"}>
          {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
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
  const panels = usePanels();
  useShortcuts();
  const showLeft = !!left && leftOpen && !presenter;
  const showRight = panels.rightOpen && !presenter;
  const wide = panels.rightW >= 480;
  return (
    <ReactFlowProvider>
      <SimProvider>
        <WorkspaceChatSource />
        <div
          className={`ws${presenter ? " presenter" : ""}${showLeft ? "" : " no-left"}${showRight ? "" : " no-right"}`}
          style={{ ["--left-w" as string]: `${panels.leftW}px`, ["--right-w" as string]: `${panels.rightW}px` }}
        >
          {showLeft && <aside className="ws-left">{left}</aside>}
          {showLeft && <Resizer side="left" width={panels.leftW} min={LEFT.min} max={LEFT.max} otherWidth={showRight ? panels.rightW : 0} onChange={panels.setLeftW} onReset={() => panels.setLeftW(LEFT.def)} />}
          <main className="ws-main">
            <Hud
              left={left ? { open: leftOpen, toggle: () => setLeftOpen((o) => !o), label: leftLabel } : undefined}
              right={{ open: panels.rightOpen, toggle: panels.toggleRight }}
            />
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
          {showRight && (
            <Resizer side="right" width={panels.rightW} min={RIGHT.min} max={RIGHT.max} otherWidth={showLeft ? panels.leftW : 0} onChange={panels.setRightW} onReset={() => panels.setRightW(RIGHT.def)} />
          )}
          {showRight && (
            <aside className="ws-right">
              <RightTabs trafficLocked={trafficLocked} wide={wide} onWide={() => panels.setRightW(wide ? RIGHT.def : RIGHT.wide)} />
            </aside>
          )}
        </div>
      </SimProvider>
    </ReactFlowProvider>
  );
}
