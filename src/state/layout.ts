import type { Graph, NodeKind } from "../engine";

const RANK: Record<NodeKind, number> = {
  client: 0,
  cdn: 1,
  limiter: 2,
  lb: 3,
  server: 4,
  cache: 5,
  queue: 5,
  worker: 6,
  saga: 5,
  kafka: 5,
  consumer: 6,
  db: 7,
  agent: 5,
  llm: 6,
  vectordb: 7,
};

/** Layered left-to-right layout by request order; empty ranks are skipped. */
export function autoLayout(g: Graph): Graph {
  const used = [...new Set(g.nodes.map((n) => RANK[n.kind]))].sort((a, b) => a - b);
  const col = new Map(used.map((r, i) => [r, i]));
  const byCol = new Map<number, string[]>();
  for (const n of g.nodes) {
    const c = col.get(RANK[n.kind])!;
    byCol.set(c, [...(byCol.get(c) ?? []), n.id]);
  }
  const tallest = Math.max(1, ...[...byCol.values()].map((v) => v.length));
  const rowH = 120;
  return {
    ...g,
    nodes: g.nodes.map((n) => {
      const c = col.get(RANK[n.kind])!;
      const ids = byCol.get(c)!;
      const i = ids.indexOf(n.id);
      const offset = ((tallest - ids.length) * rowH) / 2;
      return { ...n, x: 40 + c * 235, y: 40 + offset + i * rowH };
    }),
  };
}
