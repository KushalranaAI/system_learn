import { CircleCheck, Lightbulb, OctagonAlert, TriangleAlert } from "lucide-react";
import { useWorkspace } from "../state/workspace";
import { useSim } from "./sim";

const ICON = { error: OctagonAlert, warn: TriangleAlert, info: Lightbulb };

export function IssuesPanel() {
  const sim = useSim();
  const select = useWorkspace((s) => s.select);
  if (sim.issues.length === 0)
    return <p className="hint"><CircleCheck size={14} className="good" /> No problems at this load. Push the traffic higher and see what breaks first.</p>;
  return (
    <ul className="issues">
      {sim.issues.map((i) => {
        const Icon = ICON[i.severity];
        return (
          <li key={i.text} className={`issue ${i.severity}${i.nodeId ? " clickable" : ""}`} onClick={() => i.nodeId && select(i.nodeId)} title={i.nodeId ? "Select this component" : undefined}>
            <Icon size={14} />
            <span>{i.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
