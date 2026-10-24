import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { fmtRps } from "../engine";
import { useSim } from "./sim";

/** A wire with animated request dots: more dots = more traffic, red dots = requests dropped at the target. */
function FlowEdgeImpl(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected } = props;
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const sim = useSim();
  const e = sim.edges[id];
  const rps = e?.rps ?? 0;
  const drop = e?.dropShare ?? 0;
  const dots = rps <= 0.5 ? 0 : Math.min(9, 1 + Math.floor(Math.log10(rps + 1) * 1.6));
  const red = Math.round(dots * drop);
  const dur = 2.4;
  const stroke = selected ? "var(--accent-strong)" : drop > 0.01 ? "var(--bad-dim)" : rps > 0 ? "var(--wire-live)" : "var(--wire)";
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke, strokeWidth: selected ? 3 : 2 }} interactionWidth={18} />
      {Array.from({ length: dots }, (_, i) => (
        <circle key={`${i}-${dots}`} r={3.2} className={i < red ? "dot dot-bad" : "dot"}>
          <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${-((i * dur) / dots).toFixed(2)}s`} path={path} />
        </circle>
      ))}
      {rps > 0.5 && (
        <EdgeLabelRenderer>
          <div className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            {fmtRps(rps)}/s
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const FlowEdge = memo(FlowEdgeImpl);
