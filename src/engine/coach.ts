import { KINDS, nodeTitle } from "./catalog";
import type { Advice } from "./explain";
import type { Incident } from "./timeline";
import type { Graph, NodeKind, SimEdge, SimNode } from "./types";
import { CAN_SEND_TO, wireRefusal } from "./wiring";

/**
 * The coach: one concrete next step for the learner, worked out from the canvas alone (no AI).
 * It walks the same path a teacher would: build the request path, wire it, load it, break it.
 */

export type Stage = "build" | "wire" | "load" | "break";
export const STAGES: { id: Stage; label: string }[] = [
  { id: "build", label: "Build" },
  { id: "wire", label: "Wire" },
  { id: "load", label: "Load" },
  { id: "break", label: "Break" },
];

export type CoachAction =
  | { type: "add"; kind: NodeKind; label: string }
  /** remove some wires and add others in one undoable change */
  | { type: "rewire"; remove: string[]; add: [string, string][]; label: string }
  | { type: "traffic"; label: string }
  | { type: "incident"; incident: Incident; label: string }
  | { type: "run"; label: string };

export interface CoachStep {
  stage: Stage | "fix";
  title: string;
  why: string;
  /** how to do it by hand, so the learner learns the gesture rather than only pressing the button */
  how?: string;
  /** component to point at on the rail */
  addKind?: NodeKind;
  /** wire to point at on the canvas */
  wire?: { from: string; to: string };
  action?: CoachAction;
}

export interface CoachInput {
  graph: Graph;
  advice: Advice[];
  incident: Incident;
  /** the components the learner may add (labs restrict it) */
  palette: NodeKind[];
  /** false in labs: only the build and wire steps apply there */
  tour: boolean;
  trafficLocked?: boolean;
  done: { traffic?: boolean; ran?: boolean };
}

export interface Coach {
  step: CoachStep | null;
  /** which stages are complete, for the progress strip */
  complete: Record<Stage, boolean>;
}

/** Kinds that forward everything to exactly one place (mirrors the wiring rules). */
const SINGLE_OUT: NodeKind[] = ["client", "cdn", "limiter"];
/** Who should feed a component, nearest first: an LB feeds servers before the client does. */
const UPSTREAM_PREF: NodeKind[] = ["lb", "limiter", "cdn", "client", "server", "saga", "agent", "queue", "worker", "kafka", "consumer"];
/** Where a component should send, best first, when the default wiring order isn't the teaching order. */
const DOWNSTREAM_PREF: Partial<Record<NodeKind, NodeKind[]>> = { server: ["db", "llm", "agent"] };
/** The component to add when nothing on the canvas can take a component's output. */
const NEXT_KIND: Partial<Record<NodeKind, NodeKind>> = {
  client: "server", cdn: "server", limiter: "server", lb: "server", server: "db",
  queue: "worker", worker: "db", kafka: "consumer", consumer: "db", saga: "db", agent: "llm",
};

const lc = (k: NodeKind) => KINDS[k].label.toLowerCase();
const article = (k: NodeKind) => (/^[aeiou]/i.test(KINDS[k].label) ? "an" : "a");
const DRAG = "Drag from the dot on the right edge of the first card to the second card.";

function addStep(kind: NodeKind, why: string, stage: Stage = "build"): CoachStep {
  return {
    stage,
    title: `Add ${article(kind)} ${KINDS[kind].label}`,
    why,
    how: `Click ${KINDS[kind].short} on the left rail, or drag it onto the canvas.`,
    addKind: kind,
    action: { type: "add", kind, label: `Add ${KINDS[kind].short}` },
  };
}

/** The first wiring problem on the canvas, or null when every component is connected sensibly. */
function wiringStep(g: Graph, palette: NodeKind[]): CoachStep | null {
  const title = (n: SimNode) => nodeTitle(n, g.nodes);
  const outs = (id: string) => g.edges.filter((e) => e.from === id);
  const hasIn = (id: string) => g.edges.some((e) => e.to === id);
  const rank = (k: NodeKind) => {
    const i = UPSTREAM_PREF.indexOf(k);
    return i < 0 ? 99 : i;
  };
  const wire = (from: SimNode, to: SimNode, why: string): CoachStep => ({
    stage: "wire",
    title: `Wire ${title(from)} → ${title(to)}`,
    why,
    how: DRAG,
    wire: { from: from.id, to: to.id },
    action: { type: "rewire", remove: [], add: [[from.id, to.id]], label: "Wire it for me" },
  });

  // 1. A component nothing sends to: requests can never reach it.
  for (const n of g.nodes) {
    if (n.kind === "client" || hasIn(n.id)) continue;
    const feeders = g.nodes.filter((s) => CAN_SEND_TO[s.kind].includes(n.kind)).sort((a, b) => rank(a.kind) - rank(b.kind));
    const free = feeders.find((s) => wireRefusal(g, s.id, n.id) === null);
    if (free) return wire(free, n, `Nothing sends requests to ${title(n)} yet, so it sits idle. Wires follow the requests, left to right.`);

    // Every possible feeder already sends to one place (a client sends to exactly one component).
    const busy = feeders.find((s) => SINGLE_OUT.includes(s.kind) && outs(s.id).length);
    if (busy) {
      const old: SimEdge = outs(busy.id)[0];
      const oldTo = g.nodes.find((x) => x.id === old.to)!;
      if (n.kind === "server" && oldTo.kind === "server") {
        if (!palette.includes("lb")) continue;
        const lb = g.nodes.find((x) => x.kind === "lb");
        if (!lb) return addStep("lb", `${title(busy)} sends to one place, so a second API server gets nothing. A load balancer splits the traffic across all of them.`, "wire");
        continue; // the LB itself is handled as its own unwired component
      }
      if (CAN_SEND_TO[n.kind].includes(oldTo.kind))
        return {
          stage: "wire",
          title: `Put ${title(n)} between ${title(busy)} and ${title(oldTo)}`,
          why: `${title(busy)} sends to one place and already sends to ${title(oldTo)}. ${title(n)} belongs in the middle of that path.`,
          how: `Click the ${title(busy)} → ${title(oldTo)} wire and press Delete, then wire ${title(busy)} → ${title(n)} → ${title(oldTo)}.`,
          wire: { from: busy.id, to: n.id },
          action: { type: "rewire", remove: [old.id], add: [[busy.id, n.id], [n.id, oldTo.id]], label: "Put it in between" },
        };
    }
    // Nothing on the canvas can feed it: add what normally does.
    const up = (Object.keys(CAN_SEND_TO) as NodeKind[])
      .filter((k) => CAN_SEND_TO[k].includes(n.kind) && palette.includes(k) && k !== "client")
      .sort((a, b) => rank(b) - rank(a))[0];
    if (up) return addStep(up, `${KINDS[n.kind].label} only receives work from ${article(up)} ${lc(up)}, and there isn't one yet.`, "wire");
  }

  // 2. A component that receives requests but sends them nowhere. (A consumer group may end the path:
  //    its own processing is the work, and many designs only watch its lag.)
  for (const n of g.nodes) {
    if (!CAN_SEND_TO[n.kind].length || n.kind === "consumer") continue;
    const prefs = DOWNSTREAM_PREF[n.kind] ?? CAN_SEND_TO[n.kind];
    const mine = outs(n.id).map((e) => g.nodes.find((x) => x.id === e.to)?.kind);
    if (n.kind === "server" ? mine.some((k) => k && prefs.includes(k)) : mine.length) continue;
    if (n.kind !== "client" && !hasIn(n.id)) continue;
    const target = prefs.flatMap((k) => g.nodes.filter((x) => x.kind === k)).find((t) => wireRefusal(g, n.id, t.id) === null);
    const why =
      n.kind === "server"
        ? `${title(n)} runs your code but has nowhere to keep data, so every request fails.`
        : `${title(n)} receives requests but passes them nowhere, so they're lost.`;
    if (target) return wire(n, target, why);
    const next = NEXT_KIND[n.kind];
    if (next && palette.includes(next)) return addStep(next, why, n.kind === "client" ? "build" : "wire");
  }
  return null;
}

/** The single most useful next step, plus how far through the build → wire → load → break path the learner is. */
export function coach({ graph: g, advice, incident, palette, tour, trafficLocked, done }: CoachInput): Coach {
  const has = (k: NodeKind) => g.nodes.some((n) => n.kind === k);
  const built = has("client") && has("server") && (has("db") || has("llm") || has("agent"));
  const wiring = g.nodes.length ? wiringStep(g, palette) : null;
  const problems = advice.filter((a) => a.severity !== "info");
  const complete: Record<Stage, boolean> = {
    build: built,
    wire: built && !wiring,
    load: !!done.traffic,
    break: !!done.ran,
  };
  const can = (k: NodeKind) => palette.includes(k) && !has(k);

  let step: CoachStep | null = null;
  if (!has("client") && can("client")) step = addStep("client", "Every request starts with a user. The client stands for all of them.");
  else if (!has("server") && can("server")) step = addStep("server", "Something has to run your code for each request.");
  else if (wiring) step = wiring;
  else if (!has("db") && !has("llm") && !has("agent") && can("db")) step = addStep("db", "Data has to survive restarts, so it lives in a database.");
  else if (!tour) step = null;
  else if (problems.length)
    step = {
      stage: "fix",
      title: "Fix what's failing",
      why: `${problems[0].problem}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""} The fixes below say why it happens, what to try and what it costs.`,
    };
  else if (!done.traffic && !trafficLocked)
    step = {
      stage: "load",
      title: "Raise the traffic until something turns red",
      why: "A design is only healthy at a given load. Its breaking point shows you its bottleneck.",
      how: "Open the Traffic tab and drag the Reads slider up. Watch the cards fill.",
      action: { type: "traffic", label: "Open Traffic" },
    };
  else if (incident.type === "none" && !done.ran)
    step = {
      stage: "break",
      title: "Break something on purpose",
      why: "Real systems lose machines and get sudden spikes. See whether yours survives one.",
      how: "Pick an incident in the bar under the canvas, then press Run.",
      action: { type: "incident", incident: { type: "spike", factor: 3 }, label: "Try a 3× spike" },
    };
  else if (incident.type !== "none" && !done.ran)
    step = {
      stage: "break",
      title: "Press Run to play the incident",
      why: "The timeline replays 60 seconds second by second, so you see when and where it breaks.",
      how: "Press Run in the bar under the canvas. Space pauses.",
      action: { type: "run", label: "Run it" },
    };
  return { step, complete };
}
