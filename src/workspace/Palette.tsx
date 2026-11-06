import { KINDS, PALETTE, nodeMonthlyUsd, type NodeKind } from "../engine";
import { useWorkspace } from "../state/workspace";
import { KindIcon } from "../ui/icons";
import { useCoach } from "./coach";

/** The component rail: click to add, or drag onto the canvas. The coach's suggested component is highlighted. */
export function Palette({ kinds = PALETTE }: { kinds?: NodeKind[] }) {
  const addNode = useWorkspace((s) => s.addNode);
  const graph = useWorkspace((s) => s.graph);
  const step = useCoach().coach.step;
  return (
    <nav className="rail" aria-label="Components">
      <span className="rail-title">Add</span>
      {kinds.map((k) => {
        const spec = KINDS[k];
        const disabled = k === "client" && graph.nodes.some((n) => n.kind === "client");
        const suggested = !disabled && step?.addKind === k;
        const usd = nodeMonthlyUsd({ id: "", kind: k, x: 0, y: 0, config: spec.defaults });
        const tip = [
          suggested ? `Suggested next: ${step!.why}\n` : "",
          `${spec.label}${disabled ? " (one per design)" : ""}`,
          spec.blurb,
          `Use it when: ${spec.useWhen}`,
          usd ? `From $${usd}/mo` : "",
        ].filter(Boolean).join("\n");
        const item = (
          <button
            key={k}
            className={`rail-item${suggested ? " suggested" : ""}`}
            disabled={disabled}
            draggable={!disabled}
            onDragStart={(e) => e.dataTransfer.setData("application/x-node-kind", k)}
            onClick={() => addNode(k)}
            title={tip}
            aria-label={suggested ? `${spec.label} (suggested next)` : spec.label}
          >
            <KindIcon kind={k} size={16} />
            <span>{spec.short}</span>
            {suggested && <span className="rail-next">next</span>}
          </button>
        );
        // The AI components start a group of their own, below the classic ones.
        return k === "llm" ? [<span key="ai-title" className="rail-title rail-group">AI</span>, item] : item;
      })}
    </nav>
  );
}
