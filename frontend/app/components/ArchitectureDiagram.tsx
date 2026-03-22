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

/** Build a THREE.Group with a box mesh + floating label sprite for each node. */
function makeBodyGeometry(type: ArchNode["node_type"]): THREE.BufferGeometry {
  switch (type) {
    case "frontend":  return new THREE.TorusKnotGeometry(5, 1.8, 100, 16);   // knot — dynamic / UI feel
    case "backend":   return new THREE.BoxGeometry(16, 10, 8);               // rectangular server box
    case "database":  return new THREE.CylinderGeometry(5, 5, 16, 32);       // tall cylinder
    case "queue":     return new THREE.TorusGeometry(7, 2.5, 8, 24);         // ring / message loop
    case "external":  return new THREE.IcosahedronGeometry(7, 1);            // faceted globe / cloud
    case "service":   return new THREE.ConeGeometry(6, 12, 8);               // pointed service node
    default:          return new THREE.BoxGeometry(18, 10, 4);
  }
}

function makeNodeObject(node: ArchNode): THREE.Object3D {
  const hex   = NODE_COLORS[node.node_type] ?? "#6b7280";
  const color = new THREE.Color(hex);
  const group = new THREE.Group();

  // Shaped body
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

  // Glowing wireframe outline (same shape)
  const wire = new THREE.Mesh(
    makeBodyGeometry(node.node_type),
    new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.25 }),
  );
  group.add(wire);

  // Canvas label sprite
  const canvas  = document.createElement("canvas");
  canvas.width  = 256;
  canvas.height = 100;
  const ctx = canvas.getContext("2d")!;

  // Background pill
  ctx.fillStyle = "rgba(13,22,37,0.88)";
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 92, 10);
  ctx.fill();

  // Label text
  ctx.fillStyle = "#f1f5f9";
  ctx.font      = "bold 22px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(node.label, 128, 42, 240);

  // Technology text
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

// ── Inner client component (dynamically loads the library) ──
function ForceGraphClient({
  nodes: rawNodes,
  edges: rawEdges,
  fgRef,
}: {
  nodes: ArchNode[];
  edges: ArchEdge[];
  fgRef: React.RefObject<any>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [FG, setFG]  = useState<any>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Dynamically import the library (avoids SSR / window issues)
  useEffect(() => {
    import("react-force-graph-3d")
      .then((m) => setFG(() => m.default))
      .catch((err) => console.warn("[ForceGraph3D] failed to load:", err));
  }, []);

  // Track container size
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

  // Deduplicate & build graph data
  const seen = new Set<string>();
  const nodes = rawNodes.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
  const nodeIds = new Set(nodes.map((n) => n.id));
  const graphData = {
    nodes: nodes.map((n) => ({ ...n })),
    links: rawEdges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, label: e.label })),
  };

  const forcesConfigured = useRef(false);
  const onEngineStop = useCallback(() => {
    if (!fgRef.current) return;
    if (!forcesConfigured.current) {
      forcesConfigured.current = true;
      fgRef.current.d3Force("charge")?.strength(-800);
      fgRef.current.d3Force("link")?.distance(60);
      // Pull all nodes toward z=0 so the graph stays flat
      fgRef.current.d3Force("z", null);
      fgRef.current.d3ReheatSimulation();
    } else {
      // After reheat settles: face the graph straight-on and zoom to fit
      fgRef.current.cameraPosition({ x: 0, y: 0, z: 600 }, { x: 0, y: 0, z: 0 }, 800);
      setTimeout(() => fgRef.current?.zoomToFit(600, 60), 900);
    }
  }, [fgRef]);

  const nodeThreeObject = useCallback((node: any) => makeNodeObject(node as ArchNode), []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      {FG && (
        <FG
          ref={fgRef}
          graphData={graphData}
          width={size.w}
          height={size.h}
          // Node appearance
          nodeId="id"
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend={false}
          nodeLabel={(n: any) => `<div style="font:13px system-ui;color:#f1f5f9;background:#0d1625cc;padding:4px 8px;border-radius:6px">${n.label}${n.description ? `<br/><span style="color:#64748b;font-size:11px">${n.description}</span>` : ""}</div>`}
          // Link appearance
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
          // Layout — left-to-right DAG following the layer field
          dagMode="lr"
          dagLevelDistance={80}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          // Scene
          backgroundColor="#070d1a"
          showNavInfo={false}
          onEngineStop={onEngineStop}
        />
      )}
    </div>
  );
}

// ── Public component with forwarded ref ─────────────────────
export const ArchitectureDiagram = forwardRef<
  DiagramRef,
  { nodes: ArchNode[]; edges: ArchEdge[] }
>(function ArchitectureDiagram({ nodes, edges }, ref) {
  const fgRef = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    async toPng() {
      const renderer: THREE.WebGLRenderer | undefined = fgRef.current?.renderer?.();
      if (!renderer) throw new Error("not mounted");
      return renderer.domElement.toDataURL("image/png");
    },
  }));

  return (
    <div style={{ width: "100%", height: "100%", borderRadius: 12, overflow: "hidden" }}>
      <ForceGraphClient nodes={nodes} edges={edges} fgRef={fgRef} />
    </div>
  );
});
