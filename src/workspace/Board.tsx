import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { MousePointerClick } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import type { NodeKind } from "../engine";
import { useWorkspace } from "../state/workspace";
import { FlowEdge } from "./FlowEdge";
import { NodeCard } from "./NodeCard";

const nodeTypes = { sim: NodeCard };
const edgeTypes = { flow: FlowEdge };

export function Board() {
  const graph = useWorkspace((s) => s.graph);
  const selected = useWorkspace((s) => s.selected);
  const { moveNode, dragDone, select, removeNode, removeEdge, connect, addNode } = useWorkspace.getState();
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const flow = useReactFlow();

  const nodes: Node[] = useMemo(
    () => graph.nodes.map((n) => ({ id: n.id, type: "sim", position: { x: n.x, y: n.y }, data: {}, selected: n.id === selected })),
    [graph.nodes, selected],
  );
  const edges: Edge[] = useMemo(
    () => graph.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, type: "flow", selected: e.id === selectedEdge })),
    [graph.edges, selectedEdge],
  );

  // Fit the view when a different design is loaded (node count jumps).
  const count = graph.nodes.length;
  useEffect(() => {
    const t = setTimeout(() => flow.fitView({ padding: 0.08, maxZoom: 1.15, duration: 250 }), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count === 0, graph.nodes[0]?.id]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === "position" && c.position) moveNode(c.id, c.position.x, c.position.y);
        if (c.type === "position" && c.dragging === false) dragDone();
        if (c.type === "select" && c.selected) {
          select(c.id);
          setSelectedEdge(null);
        }
        if (c.type === "remove") removeNode(c.id);
      }
    },
    [moveNode, dragDone, select, removeNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === "select") setSelectedEdge(c.selected ? c.id : null);
        if (c.type === "remove") removeEdge(c.id);
      }
    },
    [removeEdge],
  );

  const onConnect = useCallback((c: Connection) => c.source && c.target && connect(c.source, c.target), [connect]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData("application/x-node-kind") as NodeKind;
    if (!kind) return;
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(kind, { x: p.x - 90, y: p.y - 40 });
  };

  return (
    <div className="board" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={() => {
          select(null);
          setSelectedEdge(null);
        }}
        deleteKeyCode={["Delete", "Backspace"]}
        connectionRadius={36}
        minZoom={0.2}
        maxZoom={2}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} color="var(--grid)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      {graph.nodes.length === 0 && (
        <div className="board-empty">
          <div className="empty-card">
            <span className="empty-icon"><MousePointerClick size={22} /></span>
            <b>Start with a client</b>
            <p>Every request starts with a user. Add one, then an API server, and drag between their dots to wire them.</p>
            <button className="btn primary" onClick={() => addNode("client", { x: 80, y: 160 })}>Add a client</button>
          </div>
        </div>
      )}
    </div>
  );
}
