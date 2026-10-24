import { create } from "zustand";
import {
  KINDS,
  runTimeline,
  wireRefusal,
  type Graph,
  type Incident,
  type NodeConfig,
  type NodeKind,
  type Resilience,
  type Tick,
  type Traffic,
  type Action,
} from "../engine";
import { autoLayout } from "./layout";
import { applyProfile, saveProfileId, type ProfileId } from "./profile";

export interface Playback {
  ticks: Tick[] | null;
  index: number;
  playing: boolean;
}

interface WorkspaceState {
  graph: Graph;
  traffic: Traffic;
  resilience: Resilience;
  incident: Incident;
  down: string[];
  selected: string | null;
  past: Graph[];
  future: Graph[];
  playback: Playback;
  presenter: boolean;
  toast: { text: string; at: number } | null;
  profileId: ProfileId;
  rightTab: "guide" | "component" | "traffic";
  detailed: boolean;

  load: (graph: Graph, traffic?: Traffic) => void;
  commit: (graph: Graph) => void;
  addNode: (kind: NodeKind, at?: { x: number; y: number }) => void;
  moveNode: (id: string, x: number, y: number) => void;
  dragDone: () => void;
  connect: (from: string, to: string) => void;
  removeEdge: (id: string) => void;
  removeNode: (id: string) => void;
  updateConfig: (id: string, patch: NodeConfig) => void;
  select: (id: string | null) => void;
  setTraffic: (t: Partial<Traffic>) => void;
  setResilience: (r: Partial<Resilience>) => void;
  setIncident: (i: Incident) => void;
  toggleDown: (id: string) => void;
  undo: () => void;
  redo: () => void;
  layout: () => void;
  runIncident: () => void;
  setPlayback: (p: Partial<Playback>) => void;
  stopPlayback: () => void;
  togglePresenter: () => void;
  notify: (text: string) => void;
  /** switch capacity profile; `remember` stores it as the sandbox preference */
  setProfile: (id: ProfileId, remember?: boolean) => void;
  setRightTab: (t: WorkspaceState["rightTab"]) => void;
  toggleDetailed: () => void;
  /** clone a component together with its incoming and outgoing wires (e.g. add another API server) */
  duplicateNode: (id: string) => void;
  applyAction: (a: Action) => void;
}

const uid = (kind: string) => `${kind}-${Math.random().toString(36).slice(2, 7)}`;
const clone = (g: Graph): Graph => JSON.parse(JSON.stringify(g));
const NO_PLAYBACK: Playback = { ticks: null, index: 0, playing: false };

let dragStart: Graph | null = null;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  graph: { nodes: [], edges: [] },
  traffic: { reads: 500, writes: 5, bots: 0 },
  resilience: { retries: true, dbFailover: false },
  incident: { type: "none" },
  down: [],
  selected: null,
  past: [],
  future: [],
  playback: NO_PLAYBACK,
  presenter: false,
  toast: null,
  profileId: "reference",
  rightTab: "guide",
  detailed: false,

  load: (graph, traffic) =>
    set({
      graph: clone(graph),
      ...(traffic ? { traffic } : {}),
      past: [],
      future: [],
      selected: null,
      down: [],
      incident: { type: "none" },
      playback: NO_PLAYBACK,
    }),

  commit: (graph) =>
    set((s) => ({ graph, past: [...s.past.slice(-80), s.graph], future: [], playback: NO_PLAYBACK })),

  addNode: (kind, at) => {
    const g = get().graph;
    const count = g.nodes.length;
    const pos = at ?? { x: 120 + (count % 4) * 60, y: 80 + (count % 5) * 50 };
    const n = { id: uid(kind), kind, x: pos.x, y: pos.y, config: { ...KINDS[kind].defaults } };
    if (kind === "db" && g.nodes.some((m) => m.kind === "db" && m.config.role !== "replica")) n.config.role = "replica";
    get().commit({ ...g, nodes: [...g.nodes, n] });
    set({ selected: n.id });
  },

  moveNode: (id, x, y) => {
    if (!dragStart) dragStart = get().graph;
    set((s) => ({ graph: { ...s.graph, nodes: s.graph.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) } }));
  },
  dragDone: () => {
    if (dragStart) set((s) => ({ past: [...s.past.slice(-80), dragStart!], future: [] }));
    dragStart = null;
  },

  connect: (from, to) => {
    const g = get().graph;
    const refusal = wireRefusal(g, from, to);
    if (refusal) return get().notify(refusal);
    get().commit({ ...g, edges: [...g.edges, { id: uid("e"), from, to }] });
  },

  removeEdge: (id) => {
    const g = get().graph;
    get().commit({ ...g, edges: g.edges.filter((e) => e.id !== id) });
  },

  removeNode: (id) => {
    const g = get().graph;
    get().commit({ nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) });
    set((s) => ({ selected: s.selected === id ? null : s.selected, down: s.down.filter((d) => d !== id) }));
  },

  updateConfig: (id, patch) => {
    const g = get().graph;
    get().commit({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)) });
  },

  select: (id) => set((s) => ({ selected: id, rightTab: id ? "component" : s.rightTab === "component" ? "guide" : s.rightTab })),
  setRightTab: (rightTab) => set({ rightTab }),
  toggleDetailed: () => set((s) => ({ detailed: !s.detailed })),
  duplicateNode: (id) => {
    const g = get().graph;
    const n = g.nodes.find((x) => x.id === id);
    if (!n) return;
    const copy = { ...n, id: uid(n.kind), x: n.x + 30, y: n.y + 110, config: { ...n.config } };
    const edges = [
      ...g.edges,
      ...g.edges
        .filter((e) => e.to === id && !["client", "cdn", "limiter"].includes(g.nodes.find((x) => x.id === e.from)?.kind ?? ""))
        .map((e) => ({ id: uid("e"), from: e.from, to: copy.id })),
      ...g.edges.filter((e) => e.from === id).map((e) => ({ id: uid("e"), from: copy.id, to: e.to })),
    ];
    // a client/CDN/limiter sends to one place: if it fed the original server directly, the copy needs a load balancer
    get().commit({ nodes: [...g.nodes, copy], edges });
    set({ selected: copy.id });
    const single = g.edges.find((e) => e.to === id && ["client", "cdn", "limiter"].includes(g.nodes.find((x) => x.id === e.from)?.kind ?? ""));
    if (single && n.kind === "server") get().notify("Added a second API server. The client sends to one place - add a load balancer in front of both to split traffic.");
  },
  applyAction: (a) => {
    const s = get();
    if (a.kind === "duplicate") s.duplicateNode(a.nodeId);
    else if (a.kind === "config") s.updateConfig(a.nodeId, a.patch);
    else if (a.kind === "failover") s.setResilience({ dbFailover: true });
    s.notify(`Applied: ${a.label}`);
  },
  setTraffic: (t) => set((s) => ({ traffic: { ...s.traffic, ...t }, playback: NO_PLAYBACK })),
  setResilience: (r) => set((s) => ({ resilience: { ...s.resilience, ...r }, playback: NO_PLAYBACK })),
  setIncident: (incident) => set({ incident, playback: NO_PLAYBACK }),
  toggleDown: (id) => set((s) => ({ down: s.down.includes(id) ? s.down.filter((d) => d !== id) : [...s.down, id], playback: NO_PLAYBACK })),

  undo: () => {
    const { past, graph, future } = get();
    if (!past.length) return;
    set({ graph: past[past.length - 1], past: past.slice(0, -1), future: [graph, ...future], playback: NO_PLAYBACK });
  },
  redo: () => {
    const { past, graph, future } = get();
    if (!future.length) return;
    set({ graph: future[0], future: future.slice(1), past: [...past, graph], playback: NO_PLAYBACK });
  },

  layout: () => get().commit(autoLayout(get().graph)),

  runIncident: () => {
    const { graph, traffic, incident, resilience } = get();
    const ticks = runTimeline(graph, traffic, incident, resilience);
    set({ playback: { ticks, index: 0, playing: true } });
  },
  setPlayback: (p) => set((s) => ({ playback: { ...s.playback, ...p } })),
  stopPlayback: () => set({ playback: NO_PLAYBACK }),
  togglePresenter: () => set((s) => ({ presenter: !s.presenter })),
  notify: (text) => set({ toast: { text, at: Date.now() } }),
  setProfile: (id, remember) => {
    applyProfile(id);
    if (remember) saveProfileId(id);
    set((s) => ({ profileId: id, graph: { ...s.graph }, playback: NO_PLAYBACK }));
  },
}));
