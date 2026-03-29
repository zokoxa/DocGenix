"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useState,
  useCallback,
} from "react";
import * as THREE from "three";

export type DiagramRef = { toPng: () => Promise<string> };

export interface ArchNode {
  id: string;
  label: string;
  description: string;
  technology: string;
  node_type: "frontend" | "backend" | "database" | "queue" | "external" | "service";
  layer: number;
  order: number;
}

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

const NODE_COLORS: Record<string, string> = {
  frontend: "#3b82f6",
  backend:  "#10b981",
  database: "#f59e0b",
  queue:    "#8b5cf6",
  external: "#6b7280",
  service:  "#ef4444",
};

// ── 3D node geometry ────────────────────────────────────────────
function makeBodyGeometry(type: ArchNode["node_type"]): THREE.BufferGeometry {
  switch (type) {
    case "frontend":  return new THREE.TorusKnotGeometry(5, 1.8, 100, 16);
    case "backend":   return new THREE.BoxGeometry(16, 10, 8);
    case "database":  return new THREE.CylinderGeometry(5, 5, 16, 32);
    case "queue":     return new THREE.TorusGeometry(7, 2.5, 8, 24);
    case "external":  return new THREE.IcosahedronGeometry(7, 1);
    case "service":   return new THREE.ConeGeometry(6, 12, 8);
    default:          return new THREE.BoxGeometry(18, 10, 4);
  }
}

function makeNodeObject(node: ArchNode): THREE.Object3D {
  const hex   = NODE_COLORS[node.node_type] ?? "#6b7280";
  const color = new THREE.Color(hex);
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    makeBodyGeometry(node.node_type),
    new THREE.MeshPhongMaterial({
      color: new THREE.Color("#0d1625"),
      emissive: color,
      emissiveIntensity: 0.15,
      shininess: 60,
    }),
  );
  group.add(body);

  const wire = new THREE.Mesh(
    makeBodyGeometry(node.node_type),
    new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.25 }),
  );
  group.add(wire);

  const canvas  = document.createElement("canvas");
  canvas.width  = 256;
  canvas.height = 100;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "rgba(13,22,37,0.88)";
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 92, 10);
  ctx.fill();

  ctx.fillStyle = "#f1f5f9";
  ctx.font      = "bold 22px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(node.label, 128, 42, 240);

  if (node.technology) {
    ctx.fillStyle = "#64748b";
    ctx.font      = "16px system-ui, sans-serif";
    ctx.fillText(node.technology, 128, 70, 240);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const sprite  = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(36, 14, 1);
  sprite.position.set(0, 16, 0);
  group.add(sprite);

  return group;
}

// ── 2D node canvas painter ───────────────────────────────────────
function paint2DNode(node: any, ctx: CanvasRenderingContext2D) {
  const color  = NODE_COLORS[node.node_type as string] ?? "#6b7280";
  const label  = node.label as string;
  const tech   = node.technology as string;
  const W = 130, H = 44, R = 8;
  const x = node.x - W / 2, y = node.y - H / 2;

  // Card background
  ctx.fillStyle = "#0d1625ee";
  ctx.beginPath();
  ctx.roundRect(x, y, W, H, R);
  ctx.fill();

  // Colored left accent bar
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, 4, H, [R, 0, 0, R]);
  ctx.fill();

  // Border
  ctx.strokeStyle = color + "55";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, W, H, R);
  ctx.stroke();

  // Label
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, node.x + 3, node.y - (tech ? 7 : 0), W - 16);

  // Technology
  if (tech) {
    ctx.fillStyle = "#64748b";
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillText(tech, node.x + 3, node.y + 9, W - 16);
  }
}

// ── Shared graph data builder ────────────────────────────────────
function buildGraphData(rawNodes: ArchNode[], rawEdges: ArchEdge[]) {
  const seen = new Set<string>();
  const nodes = rawNodes.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
  const nodeIds = new Set(nodes.map((n) => n.id));

  const layerCounts: Record<number, number> = {};
  for (const n of nodes) layerCounts[n.layer] = (layerCounts[n.layer] ?? 0) + 1;
  const layerOffsets: Record<number, number> = {};
  for (const n of nodes) {
    layerOffsets[n.layer] = layerOffsets[n.layer] ?? 0;
    (n as any).__slot = layerOffsets[n.layer]++;
  }

  const links = rawEdges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target)
    .map((e) => ({ source: e.source, target: e.target, label: e.label }));

  // Post-process: connect isolated nodes (no edges) to the most-connected node
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  const hub = [...degree.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (hub) {
    for (const n of nodes) {
      if ((degree.get(n.id) ?? 0) === 0 && n.id !== hub) {
        // Consumers (frontend) point TO hub; databases/external receive FROM hub
        const isConsumer = n.node_type === "frontend";
        const isLeaf     = n.node_type === "database" || n.node_type === "external";
        links.push(
          isConsumer ? { source: n.id, target: hub, label: "" }
          : isLeaf   ? { source: hub,  target: n.id, label: "" }
                     : { source: n.id, target: hub, label: "" }
        );
      }
    }
  }

  return {
    nodes: nodes.map((n) => ({
      ...n,
      x: n.layer * 100,
      y: ((n as any).__slot - (layerCounts[n.layer] - 1) / 2) * 70,
      z: 0,
    })),
    links,
  };
}

// ── Shared button style ──────────────────────────────────────────
const btnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 30, height: 30,
  background: "#1C2128", border: "1px solid #2a3040", borderRadius: 6,
  color: "#94a3b8", cursor: "pointer", fontSize: 16, userSelect: "none",
  transition: "background 0.15s, color 0.15s",
};

// ── 3D client ────────────────────────────────────────────────────
function Graph3D({ nodes: rawNodes, edges: rawEdges, fgRef }: {
  nodes: ArchNode[]; edges: ArchEdge[]; fgRef: React.RefObject<any>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [FG, setFG]  = useState<any>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    import("react-force-graph-3d")
      .then((m) => setFG(() => m.default))
      .catch((err) => console.warn("[ForceGraph3D] failed to load:", err));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!fgRef.current) return;
    fgRef.current.d3Force("charge")?.strength(-400);
    fgRef.current.d3Force("link")?.distance(50);
    fgRef.current.d3Force("z", null);
    // @ts-ignore
    import("d3-force-3d").then(({ forceCollide }) => {
      fgRef.current?.d3Force("collide", forceCollide(60));
    });
  }, [FG, fgRef]);

  const onEngineStop = useCallback(() => {
    if (!fgRef.current) return;
    fgRef.current.cameraPosition({ x: 0, y: 0, z: 400 }, { x: 0, y: 0, z: 0 }, 600);
    setTimeout(() => fgRef.current?.zoomToFit(400, 30), 700);
  }, [fgRef]);

  const nodeThreeObject = useCallback((node: any) => makeNodeObject(node as ArchNode), []);
  const graphData = buildGraphData(rawNodes, rawEdges);

  const handleZoomIn  = () => { const c = fgRef.current?.camera?.(); if (c) fgRef.current.cameraPosition({ z: c.position.z * 0.7 }, undefined, 200); };
  const handleZoomOut = () => { const c = fgRef.current?.camera?.(); if (c) fgRef.current.cameraPosition({ z: c.position.z * 1.4 }, undefined, 200); };
  const handleFit     = () => fgRef.current?.zoomToFit(400, 30);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      {FG && (
        <FG
          ref={fgRef}
          graphData={graphData}
          width={size.w}
          height={size.h}
          nodeId="id"
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend={false}
          nodeLabel={(n: any) => `<div style="font:13px system-ui;color:#f1f5f9;background:#0d1625cc;padding:4px 8px;border-radius:6px">${n.label}${n.description ? `<br/><span style="color:#64748b;font-size:11px">${n.description}</span>` : ""}</div>`}
          linkSource="source"
          linkTarget="target"
          linkColor={() => "#1e3a5f"}
          linkWidth={1.5}
          linkOpacity={0.7}
          linkDirectionalArrowLength={5}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={() => "#334155"}
          linkDirectionalParticles={2}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleSpeed={0.004}
          linkDirectionalParticleColor={() => "#3b82f6"}
          enableNodeDrag={false}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          warmupTicks={150}
          cooldownTicks={100}
          backgroundColor="#070d1a"
          showNavInfo={false}
          onEngineStop={onEngineStop}
        />
      )}
      <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        <button style={btnStyle} onClick={handleZoomIn}  title="Zoom in">+</button>
        <button style={btnStyle} onClick={handleZoomOut} title="Zoom out">−</button>
        <button style={{ ...btnStyle, fontSize: 12 }} onClick={handleFit} title="Fit to view">⤢</button>
      </div>
      <div style={{ position: "absolute", bottom: 16, left: 16, zIndex: 10, fontSize: 11, color: "#475569", lineHeight: 1.6, pointerEvents: "none" }}>
        <div>Left-drag · rotate</div>
        <div>Right-drag · pan</div>
        <div>Scroll · zoom</div>
      </div>
    </div>
  );
}

// ── 2D client ────────────────────────────────────────────────────
function Graph2D({ nodes: rawNodes, edges: rawEdges, fgRef }: {
  nodes: ArchNode[]; edges: ArchEdge[]; fgRef: React.RefObject<any>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [FG, setFG]  = useState<any>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    import("react-force-graph-2d")
      .then((m) => setFG(() => m.default))
      .catch((err) => console.warn("[ForceGraph2D] failed to load:", err));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!fgRef.current) return;
    fgRef.current.d3Force("charge")?.strength(-300);
    fgRef.current.d3Force("link")?.distance(60);
    // @ts-ignore
    import("d3-force-3d").then(({ forceCollide, forceX, forceY }) => {
      fgRef.current?.d3Force("collide", forceCollide(80));
      // Pull each node toward its layer x-position — left-to-right layout without dagMode
      fgRef.current?.d3Force("x", forceX((n: any) => n.layer * 180).strength(0.8));
      // Weak y centering so nodes don't drift off screen
      fgRef.current?.d3Force("y", forceY(0).strength(0.05));
      fgRef.current?.d3ReheatSimulation();
    });
  }, [FG, fgRef]);

  const onEngineStop = useCallback(() => {
    if (!fgRef.current) return;
    setTimeout(() => fgRef.current?.zoomToFit(400, 40), 300);
  }, [fgRef]);

  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D) => {
    paint2DNode(node, ctx);
  }, []);

  const graphData = buildGraphData(rawNodes, rawEdges);

  const handleZoomIn  = () => { const z = fgRef.current?.zoom?.(); if (z != null) fgRef.current.zoom(z * 1.3, 200); };
  const handleZoomOut = () => { const z = fgRef.current?.zoom?.(); if (z != null) fgRef.current.zoom(z * 0.77, 200); };
  const handleFit     = () => fgRef.current?.zoomToFit(400, 40);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      {FG && (
        <FG
          ref={fgRef}
          graphData={graphData}
          width={size.w}
          height={size.h}
          nodeId="id"
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={() => "replace"}
          nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.rect(node.x - 65, node.y - 22, 130, 44);
            ctx.fill();
          }}
          nodeLabel={(n: any) => n.description || ""}
          linkSource="source"
          linkTarget="target"
          linkColor={() => "#1e3a5f"}
          linkWidth={1.5}
          linkDirectionalArrowLength={5}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={() => "#334155"}
          linkDirectionalParticles={2}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleSpeed={0.004}
          linkDirectionalParticleColor={() => "#3b82f6"}
          enableNodeDrag={false}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          warmupTicks={150}
          cooldownTicks={100}
          backgroundColor="#070d1a"
          onEngineStop={onEngineStop}
        />
      )}
      <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        <button style={btnStyle} onClick={handleZoomIn}  title="Zoom in">+</button>
        <button style={btnStyle} onClick={handleZoomOut} title="Zoom out">−</button>
        <button style={{ ...btnStyle, fontSize: 12 }} onClick={handleFit} title="Fit to view">⤢</button>
      </div>
      <div style={{ position: "absolute", bottom: 16, left: 16, zIndex: 10, fontSize: 11, color: "#475569", lineHeight: 1.6, pointerEvents: "none" }}>
        <div>Drag · pan</div>
        <div>Scroll · zoom</div>
      </div>
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────
export const ArchitectureDiagram = forwardRef<
  DiagramRef,
  { nodes: ArchNode[]; edges: ArchEdge[] }
>(function ArchitectureDiagram({ nodes, edges }, ref) {
  const fgRef   = useRef<any>(null);
  const [is3D, setIs3D] = useState(false);

  useImperativeHandle(ref, () => ({
    async toPng() {
      if (is3D) {
        const renderer: THREE.WebGLRenderer | undefined = fgRef.current?.renderer?.();
        if (!renderer) throw new Error("not mounted");
        return renderer.domElement.toDataURL("image/png");
      } else {
        const canvas = fgRef.current?.canvas?.() as HTMLCanvasElement | undefined;
        if (!canvas) throw new Error("not mounted");
        return canvas.toDataURL("image/png");
      }
    },
  }), [is3D]);

  const toggleStyle: React.CSSProperties = {
    position: "absolute", top: 55, right: 12, zIndex: 20,
    display: "flex", background: "#1C2128", border: "1px solid #2a3040",
    borderRadius: 8, overflow: "hidden",
  };
  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "5px 12px", fontSize: 12, cursor: "pointer", border: "none",
    background: active ? "#3b82f6" : "transparent",
    color: active ? "#fff" : "#94a3b8",
    transition: "background 0.15s, color 0.15s",
  });

  return (
    <div style={{ width: "100%", height: "100%", borderRadius: 12, overflow: "hidden", position: "relative" }}>
      <div style={toggleStyle}>
        <button style={tabStyle(!is3D)} onClick={() => setIs3D(false)}>2D</button>
        <button style={tabStyle(is3D)}  onClick={() => setIs3D(true)}>3D</button>
      </div>
      {is3D
        ? <Graph3D nodes={nodes} edges={edges} fgRef={fgRef} />
        : <Graph2D nodes={nodes} edges={edges} fgRef={fgRef} />
      }
    </div>
  );
});
