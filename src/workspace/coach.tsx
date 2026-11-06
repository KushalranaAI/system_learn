import { createContext, useContext, useMemo, type ReactNode } from "react";
import { PALETTE, coach as runCoach, explainDesign, type Coach, type CoachAction, type Guide, type NodeKind } from "../engine";
import { useWorkspace } from "../state/workspace";
import { useSim } from "./sim";

interface CoachValue {
  guide: Guide;
  coach: Coach;
  /** whether the build → wire → load → break strip is shown (the sandbox, not labs) */
  tour: boolean;
}

const CoachCtx = createContext<CoachValue | null>(null);

/**
 * Works out the design guide and the coach's next step once per change, for the guide panel,
 * the component rail and the canvas to share.
 */
export function CoachProvider({ children, palette = PALETTE, tour, trafficLocked }: { children: ReactNode; palette?: NodeKind[]; tour: boolean; trafficLocked?: boolean }) {
  const graph = useWorkspace((s) => s.graph);
  const traffic = useWorkspace((s) => s.traffic);
  const resilience = useWorkspace((s) => s.resilience);
  const incident = useWorkspace((s) => s.incident);
  const profileId = useWorkspace((s) => s.profileId);
  const done = useWorkspace((s) => s.guideDone);
  const live = !useWorkspace((s) => s.playback.ticks);
  const sim = useSim();
  const guide = useMemo(
    () => explainDesign(graph, traffic, sim, resilience),
    // during playback, keep the steady-state guide
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, traffic, resilience, profileId, live ? sim : null],
  );
  const coach = useMemo(
    () => runCoach({ graph, advice: guide.advice, incident, palette, tour, trafficLocked, done }),
    [graph, guide, incident, palette, tour, trafficLocked, done],
  );
  const value = useMemo(() => ({ guide, coach, tour }), [guide, coach, tour]);
  return <CoachCtx.Provider value={value}>{children}</CoachCtx.Provider>;
}

export function useCoach(): CoachValue {
  const v = useContext(CoachCtx);
  if (!v) throw new Error("useCoach outside CoachProvider");
  return v;
}

/** Carry out a coach step's button. */
export function runCoachAction(a: CoachAction) {
  const s = useWorkspace.getState();
  switch (a.type) {
    case "add": {
      // place it right of the rightmost card, so a coached design reads left to right like the requests flow
      const last = [...s.graph.nodes].sort((x, y) => y.x - x.x)[0];
      s.addNode(a.kind, last ? { x: last.x + 260, y: last.y } : undefined);
      // adding selects the new card, which opens the Component tab; stay on the guide so the next step shows
      return s.setRightTab("guide");
    }
    case "rewire":
      return s.rewire(a.remove, a.add);
    case "traffic":
      return s.setRightTab("traffic");
    case "incident":
      return s.setIncident(a.incident);
    case "run":
      return s.runIncident();
  }
}
