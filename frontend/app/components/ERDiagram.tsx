"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";

import type { DiagramRef } from "./ArchitectureDiagram";

export interface ERColumn {
  name: string;
  type: string;
  constraints: string;
}

export interface ERNodeData {
  id: string;
  label: string;
  columns: ERColumn[];
}

export interface EREdgeData {
  id: string;
  source: string;
  target: string;
  label: string;
  source_label: string;
  target_label: string;
}

const TABLE_W  = 260;
const ROW_H    = 24;
const HEADER_H = 36;
;
const GAP_X    = 120;
const GAP_Y    = 80;

function getTableHeight(columns: ERColumn[]): number {
  return HEADER_H + Math.max(columns.length, 1) * ROW_H + 12;
}

function isPK(c: string) { return /\bPK\b/i.test(c); }
function isFK(c: string) { return /\bFK\b/i.test(c); }

function TableNode({ data }: { data: Record<string, unknown> }) {
  const label   = data.label as string;
  const columns = (data.columns as ERColumn[]) ?? [];

  return (
    <div style={{ width: TABLE_W, minHeight: HEADER_H + ROW_H, background: "#111827", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(245,158,11,0.2)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
      {/* Handles on all 4 sides so ReactFlow can route edges cleanly */}
      <Handle type="target" position={Position.Top}    id="t" style={{ background: "#f59e0b", width: 6, height: 6, left: "50%" }} />
      <Handle type="source" position={Position.Bottom} id="b" style={{ background: "#f59e0b", width: 6, height: 6, left: "50%" }} />
      <Handle type="target" position={Position.Left}   id="l" style={{ background: "#f59e0b", width: 6, height: 6, top: HEADER_H / 2 }} />
      <Handle type="source" position={Position.Right}  id="r" style={{ background: "#f59e0b", width: 6, height: 6, top: HEADER_H / 2 }} />

      {/* Header */}
      <div style={{
        height: HEADER_H,
        background: "linear-gradient(135deg, #92400e 0%, #451a03 100%)",
        borderBottom: "1px solid rgba(245,158,11,0.2)",
        display: "flex", alignItems: "center", gap: 8, padding: "0 12px",
      }}>
        <span style={{ fontSize: 13 }}>🗄</span>
        <span style={{ color: "#fcd34d", fontWeight: 700, fontSize: 12, letterSpacing: "0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "rgba(245,158,11,0.1)" }} />

      {/* Columns */}
      <div style={{ padding: "6px 0" }}>
        {columns.length > 0 ? columns.map((col, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 6,
            height: ROW_H, padding: "0 10px",
            background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
          }}>
            {isPK(col.constraints) ? (
              <span style={{ fontSize: 9, fontWeight: 800, color: "#fbbf24", width: 18, flexShrink: 0 }}>PK</span>
            ) : isFK(col.constraints) ? (
              <span style={{ fontSize: 9, fontWeight: 800, color: "#60a5fa", width: 18, flexShrink: 0 }}>FK</span>
            ) : (
              <span style={{ width: 18, flexShrink: 0 }} />
            )}
            <span style={{
              fontSize: 11, color: isPK(col.constraints) ? "#fde68a" : isFK(col.constraints) ? "#bfdbfe" : "#d1d5db",
              flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontWeight: isPK(col.constraints) ? 600 : 400,
            }}>
              {col.name}
            </span>
            <span style={{ fontSize: 9, color: "#4b5563", whiteSpace: "nowrap", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", textAlign: "right" }}>
              {col.type}
            </span>
          </div>
        )) : (
          <div style={{ fontSize: 10, color: "#374151", padding: "4px 10px" }}>No columns</div>
        )}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { tableNode: TableNode };

function computeLayout(rawNodes: ERNodeData[], rawEdges: EREdgeData[]): Node[] {
  const ids = rawNodes.map((n) => n.id);
  const nodeMap = new Map(rawNodes.map((n) => [n.id, n]));

  // Build adjacency and degree counts
  const outEdges = new Map<string, Set<string>>();
  const inDegree  = new Map<string, number>();
  for (const id of ids) { outEdges.set(id, new Set()); inDegree.set(id, 0); }

  for (const e of rawEdges) {
    if (!outEdges.has(e.source) || !outEdges.has(e.target)) continue;
    if (e.source === e.target) continue;
    outEdges.get(e.source)!.add(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  // Assign levels via BFS (Kahn-style, handles cycles by keeping unvisited nodes)
  const level = new Map<string, number>();
  const queue: string[] = [];

  // Roots = nodes with no incoming edges
  for (const id of ids) {
    if ((inDegree.get(id) ?? 0) === 0) { queue.push(id); level.set(id, 0); }
  }
  // Fallback: if all nodes have incoming edges (pure cycle), start from most-referenced
  if (queue.length === 0) {
    const sorted = [...ids].sort((a, b) => (inDegree.get(b) ?? 0) - (inDegree.get(a) ?? 0));
    queue.push(sorted[0]);
    level.set(sorted[0], 0);
  }

  const remaining = new Map(inDegree);
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const curLevel = level.get(cur) ?? 0;
    for (const neighbor of outEdges.get(cur) ?? []) {
      const newIn = (remaining.get(neighbor) ?? 1) - 1;
      remaining.set(neighbor, newIn);
      const proposed = curLevel + 1;
      if (!level.has(neighbor) || (level.get(neighbor) ?? 0) < proposed) {
        level.set(neighbor, proposed);
      }
      if (newIn === 0) queue.push(neighbor);
    }
  }
  // Any still-unvisited nodes (in cycles) get appended at the deepest level + 1
  const maxLevel = Math.max(0, ...level.values());
  for (const id of ids) {
    if (!level.has(id)) level.set(id, maxLevel + 1);
  }

  // Group nodes by level
  const byLevel = new Map<number, string[]>();
  for (const [id, lvl] of level) {
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(id);
  }

  // Compute cumulative Y per level (based on tallest node in that level)
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  const levelY: number[] = [];
  let curY = 40;
  for (const lvl of levels) {
    levelY[lvl] = curY;
    const maxH = Math.max(...(byLevel.get(lvl) ?? []).map((id) => getTableHeight(nodeMap.get(id)?.columns ?? [])));
    curY += maxH + GAP_Y;
  }

  // Place nodes: centered horizontally within each level
  const rfNodes: Node[] = [];
  for (const lvl of levels) {
    const group = byLevel.get(lvl) ?? [];
    const totalW = group.length * TABLE_W + (group.length - 1) * GAP_X;
    const startX = Math.max(40, 40 + (Math.max(...levels.map((l) => (byLevel.get(l)?.length ?? 0))) * (TABLE_W + GAP_X) - totalW) / 2);

    group.forEach((id, i) => {
      const n = nodeMap.get(id)!;
      const h = getTableHeight(n.columns);
      rfNodes.push({
        id: n.id,
        type: "tableNode",
        position: { x: startX + i * (TABLE_W + GAP_X), y: levelY[lvl] },
        data: { label: n.label, columns: n.columns },
        style: { width: TABLE_W, height: h },
      });
    });
  }

  return rfNodes;
}

function FitViewButton() {
  const { fitView } = useReactFlow();
  return (
    <ControlButton onClick={() => fitView({ padding: 0.15 })} title="Fit view">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <rect x="1" y="1" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </ControlButton>
  );
}

export const ERDiagram = forwardRef<DiagramRef, { nodes: ERNodeData[]; edges: EREdgeData[] }>(
  function ERDiagram({ nodes: rawNodes, edges: rawEdges }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      async toPng() {
        if (!containerRef.current) throw new Error("not mounted");
        return toPng(containerRef.current, { backgroundColor: "#0a0f1a" });
      },
    }));

    const seen = new Set<string>();
    const uniqueNodes = rawNodes.filter((n) => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });

    const nodeIds = new Set(uniqueNodes.map((n) => n.id));

    // Filter valid edges first
    const validRawEdges = rawEdges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target
    );

    // Post-process: detect isolated nodes and connect them to the most-connected node
    const degree = new Map<string, number>();
    for (const n of uniqueNodes) degree.set(n.id, 0);
    for (const e of validRawEdges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const hub = [...degree.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const syntheticIds = new Set<string>();
    const syntheticRawEdges: EREdgeData[] = [];
    if (hub) {
      for (const [id, deg] of degree) {
        if (deg === 0 && id !== hub) {
          const synId = `syn-${id}`;
          syntheticIds.add(synId);
          syntheticRawEdges.push({ id: synId, source: id, target: hub, label: "", source_label: "", target_label: "" });
        }
      }
    }
    const allRawEdges = [...validRawEdges, ...syntheticRawEdges];

    const rfNodes = computeLayout(uniqueNodes, allRawEdges);

    // Count parallel edges (same unordered pair) to assign curvature offsets
    const pairCount = new Map<string, number>();
    for (const e of allRawEdges) {
      const key = [e.source, e.target].sort().join("§");
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }
    const pairSeen = new Map<string, number>();

    const rfEdges: Edge[] = allRawEdges.map((e) => {
      const key = [e.source, e.target].sort().join("§");
      const total = pairCount.get(key) ?? 1;
      const idx = pairSeen.get(key) ?? 0;
      pairSeen.set(key, idx + 1);

      const isSynthetic = syntheticIds.has(e.id);

      // For parallel edges, switch to bezier with spread curvatures so they don't overlap
      let edgeType = "smoothstep";
      let pathOptions: Record<string, unknown> | undefined;
      if (total > 1) {
        edgeType = "default"; // bezier supports curvature
        const curvature = total === 1 ? 0 : -0.4 + (idx / Math.max(total - 1, 1)) * 0.8;
        pathOptions = { curvature };
      }

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: edgeType,
        label: e.label || "",
        pathOptions,
        markerEnd: { type: MarkerType.ArrowClosed, color: isSynthetic ? "#6b7280" : "#f59e0b", width: 14, height: 14 },
        style: {
          stroke: isSynthetic ? "#6b7280" : "#f59e0b",
          strokeWidth: 1.2,
          opacity: isSynthetic ? 0.3 : 0.6,
          strokeDasharray: isSynthetic ? "5 5" : undefined,
        },
        labelStyle: { fill: "#fbbf24", fontSize: 10, fontWeight: 700 },
        labelBgStyle: { fill: "#0f172a", fillOpacity: 0.92 },
        labelBgPadding: [4, 3] as [number, number],
        labelBgBorderRadius: 3,
      };
    });

    const [nodes, , onNodesChange] = useNodesState(rfNodes);
    const [edges, , onEdgesChange] = useEdgesState(rfEdges);

    return (
      <div ref={containerRef} style={{ width: "100%", height: "100%", background: "#0a0f1a", borderRadius: 12 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1a2030" gap={28} size={1} variant={"dots" as any} />
          <Controls showFitView={false}>
            <FitViewButton />
          </Controls>
          <MiniMap nodeColor={() => "#78350f"} maskColor="rgba(0,0,0,0.6)" style={{ background: "#0f172a", border: "1px solid #1e293b" }} />
        </ReactFlow>
      </div>
    );
  }
);
