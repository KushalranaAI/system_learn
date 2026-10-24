import { KINDS, PALETTE, nodeMonthlyUsd, type NodeKind } from "../engine";
import { useWorkspace } from "../state/workspace";
import { KindIcon } from "../ui/icons";

/** The component rail: click to add, or drag onto the canvas. */
export function Palette({ kinds = PALETTE }: { kinds?: NodeKind[] }) {
  const addNode = useWorkspace((s) => s.addNode);
  const graph = useWorkspace((s) => s.graph);
  return (
    <nav className="rail" aria-label="Components">
      <span className="rail-title">Add</span>
      {kinds.map((k) => {
        const spec = KINDS[k];
        const disabled = k === "client" && graph.nodes.some((n) => n.kind === "client");
        const usd = nodeMonthlyUsd({ id: "", kind: k, x: 0, y: 0, config: spec.defaults });
        return (
          <button
            key={k}
            className="rail-item"
            disabled={disabled}
            draggable={!disabled}
            onDragStart={(e) => e.dataTransfer.setData("application/x-node-kind", k)}
            onClick={() => addNode(k)}
            title={`${spec.label}${disabled ? " (one per design)" : ""}\n${spec.blurb}${usd ? `\nFrom $${usd}/mo` : ""}`}
          >
            <KindIcon kind={k} size={16} />
            <span>{spec.short}</span>
          </button>
        );
      })}
    </nav>
  );
}
