import { KINDS } from "./catalog";
import type { Graph, NodeKind } from "./types";

/** Which node kinds each kind may send requests to. Wires follow the requests. */
export const CAN_SEND_TO: Record<NodeKind, NodeKind[]> = {
  client: ["cdn", "limiter", "lb", "server"],
  cdn: ["limiter", "lb", "server"],
  limiter: ["lb", "server"],
  lb: ["server"],
  server: ["cache", "db", "queue", "kafka", "saga"],
  queue: ["worker"],
  worker: ["db"],
  saga: ["db", "kafka"],
  kafka: ["consumer"],
  consumer: ["db", "cache"],
  cache: [],
  db: [],
};

/** Kinds that forward everything to exactly one place. */
const SINGLE_OUT: NodeKind[] = ["client", "cdn", "limiter"];

const the = (k: NodeKind) => `the ${KINDS[k].label.toLowerCase()}`;

/** Returns null when the wire is allowed, otherwise a short teaching message. */
export function wireRefusal(graph: Graph, fromId: string, toId: string): string | null {
  if (fromId === toId) return "A component can't send requests to itself.";
  const from = graph.nodes.find((n) => n.id === fromId);
  const to = graph.nodes.find((n) => n.id === toId);
  if (!from || !to) return "Unknown component.";
  if (graph.edges.some((e) => e.from === fromId && e.to === toId)) return "These two are already wired.";

  if (!CAN_SEND_TO[from.kind].includes(to.kind)) {
    if (to.kind === "client") return "Requests start at the client - wire from the client, not into it.";
    if (CAN_SEND_TO[to.kind].includes(from.kind)) return `Wires follow the requests: drag from ${the(to.kind)} to ${the(from.kind)}.`;
    if (to.kind === "db" && from.kind !== "server" && from.kind !== "worker")
      return "Only code talks to the database - route through an API server.";
    if (to.kind === "cache") return "Only an API server reads from the cache - it runs the code that checks it.";
    if (from.kind === "server" && to.kind === "server") return "API servers don't call each other here. Put a load balancer in front of them.";
    if (from.kind === "lb" && to.kind === "lb") return "A load balancer forwards to API servers, not to another load balancer.";
    if (to.kind === "limiter") return "The rate limiter sits at the edge - wire the client (or CDN) into it.";
    if (to.kind === "worker") return "Workers take jobs from a queue - wire a queue to them.";
    if (to.kind === "consumer") return "Consumer groups read from a Kafka topic - wire the topic to them.";
    if (to.kind === "kafka") return "Services publish events to Kafka - wire an API server or a saga to it.";
    if (to.kind === "saga") return "An API server starts the saga for each order - wire a server to it.";
    if (to.kind === "queue") return "API servers put jobs on a queue - wire a server to it.";
    return `${KINDS[from.kind].label} can't send requests to ${the(to.kind)}.`;
  }

  if (SINGLE_OUT.includes(from.kind) && graph.edges.some((e) => e.from === fromId)) {
    const servers = graph.nodes.filter((n) => n.kind === "server").length;
    if (to.kind === "server" && servers > 1)
      return `${KINDS[from.kind].label} sends to one place. To split traffic across ${servers} API servers, add a load balancer.`;
    return `${KINDS[from.kind].label} sends to one place, and it's already wired. Delete that wire first.`;
  }

  if ((from.kind === "server" || from.kind === "saga") && (to.kind === "cache" || to.kind === "queue" || to.kind === "kafka" || to.kind === "saga")) {
    const existing = graph.edges.filter((e) => e.from === fromId).map((e) => graph.nodes.find((n) => n.id === e.to)?.kind);
    if (existing.includes(to.kind)) return `This API server already uses a ${KINDS[to.kind].label.toLowerCase()}.`;
  }
  return null;
}
