import { createContext, useContext, useMemo, type ReactNode } from "react";
import { simulate, type SimResult } from "../engine";
import { useWorkspace } from "../state/workspace";

const SimCtx = createContext<SimResult | null>(null);

/** Runs the simulator once per change and shares the result with every node and edge. */
export function SimProvider({ children }: { children: ReactNode }) {
  const graph = useWorkspace((s) => s.graph);
  const traffic = useWorkspace((s) => s.traffic);
  const down = useWorkspace((s) => s.down);
  const resilience = useWorkspace((s) => s.resilience);
  const playback = useWorkspace((s) => s.playback);
  const profileId = useWorkspace((s) => s.profileId);
  const steady = useMemo(
    () => simulate(graph, traffic, { down, dbFailover: resilience.dbFailover, promoted: resilience.dbFailover }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, traffic, down, resilience.dbFailover, profileId],
  );
  const value = playback.ticks ? playback.ticks[Math.min(playback.index, playback.ticks.length - 1)].res : steady;
  return <SimCtx.Provider value={value}>{children}</SimCtx.Provider>;
}

export function useSim(): SimResult {
  const v = useContext(SimCtx);
  if (!v) throw new Error("useSim outside SimProvider");
  return v;
}

export const utilColor = (u: number) =>
  u >= 1 ? "var(--bad)" : u >= 0.85 ? "var(--hot)" : u >= 0.7 ? "var(--warm)" : "var(--good)";
