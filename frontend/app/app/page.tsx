"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArchitectureDiagram,
  type ArchNode,
  type ArchEdge,
  type DiagramRef,
} from "../components/ArchitectureDiagram";
import {
  ERDiagram,
  type ERNodeData,
  type EREdgeData,
} from "../components/ERDiagram";
import JSZip from "jszip";
import s from "./page.module.css";

const API_URL = "http://localhost:1000";

// Agents that produce a visual diagram (nodes/edges)
const DIAGRAM_AGENTS = ["System Architecture", "Data Model"];

const AGENTS = [
  "Project Overview",
  "Requirements",
  "User Stories",
  "System Architecture",
  "API Spec",
  "Data Model",
  "DevOps & Deployment",
  "Testing Strategy",
];

const AGENT_ICONS: Record<string, string> = {
  "Project Overview": "◎",
  Requirements: "≡",
  "User Stories": "♟",
  "System Architecture": "⬡",
  "API Spec": "⇄",
  "Data Model": "⬢",
  "DevOps & Deployment": "⚙",
  "Testing Strategy": "✓",
};

// Maps each agent's accent color to CSS module class suffixes
type ColorKey = "Blue" | "Purple" | "Cyan";
const AGENT_COLOR_KEY: Record<string, ColorKey> = {
  "Project Overview": "Blue",
  Requirements: "Purple",
  "User Stories": "Cyan",
  "System Architecture": "Blue",
  "API Spec": "Purple",
  "Data Model": "Cyan",
  "DevOps & Deployment": "Blue",
  "Testing Strategy": "Purple",
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface GeneratedDoc {
  agent: string;
  markdown: string;
  doc_id?: number;
  nodes?: ArchNode[];
  edges?: ArchEdge[];
  er_nodes?: ERNodeData[];
  er_edges?: EREdgeData[];
}

interface Project {
  id: number;
  idea: string;
  created_at: string;
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      className="animate-spin"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8z"
      />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
      <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
      <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
    </svg>
  );
}

function IconSidebarToggle({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      width="18"
      height="18"
      aria-hidden="true"
    >
      <rect
        x="1.75"
        y="3"
        width="16.5"
        height="14"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {collapsed ? (
        <path
          d="M7 4v12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M13 4v12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export default function Home() {
  const [idea, setIdea] = useState("");
  const [contextReady, setContextReady] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [lockedProjects, setLockedProjects] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("lockedProjects");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const ideaLocked = projectId !== null && lockedProjects.has(projectId);
  function lockProject(id: number) {
    setLockedProjects((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem("lockedProjects", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }
  const [docs, setDocs] = useState<GeneratedDoc[]>([]);
  const [genLoading, setGenLoading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<GeneratedDoc | null>(null);
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set());
  const [criticStatus, setCriticStatus] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const diagramPanelRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  function toggleDiagramFullscreen() {
    if (!diagramPanelRef.current) return;
    if (!document.fullscreenElement) {
      diagramPanelRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);
  const [mounted, setMounted] = useState(false);


  const [projects, setProjects] = useState<Project[]>([]);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const [projectNames, setProjectNames] = useState<Record<number, string>>({});

  const [outputMode, setOutputMode] = useState<"docs" | "diagrams">("docs");
  const [chatOpen, setChatOpen] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const archDiagramRef = useRef<DiagramRef>(null);
  const erDiagramRef = useRef<DiagramRef>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const autoSubmitRef = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Always reflects the latest projectId so async callbacks can guard against stale project
  const projectIdRef = useRef<number | null>(null);
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  function extractProjectName(markdown: string): string {
    // Find name after "Project Name Suggestion" label — strips **, [], and descriptions
    const afterLabel = markdown.match(
      /project name suggestion[^\n]*\n+\s*(?:\*\*|\[)?([A-Za-z][A-Za-z0-9 ]+?)(?:\*\*|\]|[\s\n]|$)/i,
    );
    if (afterLabel) return afterLabel[1].trim();

    // Fallback: H1 heading
    const h1 = markdown.match(/^#\s+(.+)$/m);
    if (h1) return h1[1].trim();

    return "";
  }

  function storeProjectName(id: number, markdown: string) {
    const name = extractProjectName(markdown);
    if (!name) return;
    setProjectNames((prev) => {
      const next = { ...prev, [id]: name };
      localStorage.setItem("docgenix_names", JSON.stringify(next));
      return next;
    });
  }

  const pushRecent = (id: number) => {
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 10);
      localStorage.setItem("docgenix_recent", JSON.stringify(next));
      return next;
    });
    localStorage.setItem("docgenix_last", String(id));
  };

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/projects`);
      const data = (await res.json()) as Project[];
      setProjects(data);

      // Purge stale localStorage entries that reference deleted project IDs
      const validIds = new Set(data.map((p) => p.id));

      try {
        const storedLocked = localStorage.getItem("lockedProjects");
        if (storedLocked) {
          const cleaned = JSON.parse(storedLocked).filter((id: number) =>
            validIds.has(id),
          );
          localStorage.setItem("lockedProjects", JSON.stringify(cleaned));
          setLockedProjects(new Set(cleaned));
        }

        const storedRecent = localStorage.getItem("docgenix_recent");
        if (storedRecent) {
          const cleaned = JSON.parse(storedRecent).filter((id: number) =>
            validIds.has(id),
          );
          localStorage.setItem("docgenix_recent", JSON.stringify(cleaned));
        }

        const storedNames = localStorage.getItem("docgenix_names");
        if (storedNames) {
          const names = JSON.parse(storedNames) as Record<string, string>;
          const cleaned = Object.fromEntries(
            Object.entries(names).filter(([id]) => validIds.has(Number(id))),
          );
          localStorage.setItem("docgenix_names", JSON.stringify(cleaned));
        }

        const lastId = localStorage.getItem("docgenix_last");
        if (lastId && !validIds.has(Number(lastId))) {
          localStorage.removeItem("docgenix_last");
        }
      } catch {
        /* ignore storage errors */
      }

      return data;
    } catch {
      return [];
    }
  }, []);

  const loadProject = useCallback(
    async (id: number, allProjects?: Project[]) => {
      setProjectId(id);
      setChatMessages([]);
      setDocs([]);
      setSelectedDoc(null);

      try {
        const [chatRes, docsRes] = await Promise.all([
          fetch(`${API_URL}/projects/${id}/chat`),
          fetch(`${API_URL}/projects/${id}/documents`),
        ]);

        const chatData = await chatRes.json();
        const docsData = await docsRes.json();

        setChatMessages(
          chatData.map((m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        );

        const loadedDocs = docsData.map(
          (d: {
            id: number;
            agent_name: string;
            markdown: string;
            arch_graph?: string;
          }) => {
            const doc: GeneratedDoc = {
              agent: d.agent_name,
              markdown: d.markdown,
              doc_id: d.id,
            };
            if (d.arch_graph) {
              try {
                const g = JSON.parse(d.arch_graph);
                if (d.agent_name === "Data Model") {
                  doc.er_nodes = g.nodes;
                  doc.er_edges = g.edges;
                } else {
                  doc.nodes = g.nodes;
                  doc.edges = g.edges;
                }
              } catch {
                /* ignore */
              }
            }
            return doc;
          },
        );
        // Deduplicate by agent name, keeping the last occurrence
        const dedupedDocs = Object.values(
          Object.fromEntries(loadedDocs.map((d: GeneratedDoc) => [d.agent, d])),
        ) as GeneratedDoc[];
        setDocs(dedupedDocs);
        if (dedupedDocs.length > 0) setSelectedDoc(dedupedDocs[0]);

        const overview = dedupedDocs.find(
          (d: GeneratedDoc) => d.agent === "Project Overview",
        );
        if (overview) storeProjectName(id, overview.markdown);

        const pool = allProjects ?? projects;
        const proj = pool.find((p) => p.id === id);
        if (proj) setIdea(proj.idea);
      } catch {
        // ignore
      }
    },
    [projects],
  );

  useEffect(() => {
    const stored = localStorage.getItem("docgenix_recent");
    if (stored) setRecentIds(JSON.parse(stored));

    const storedNames = localStorage.getItem("docgenix_names");
    if (storedNames) setProjectNames(JSON.parse(storedNames));

    // Check URL param ?project=ID first, then fall back to last visited
    const urlId = new URLSearchParams(window.location.search).get("project");
    const lastId = urlId ?? localStorage.getItem("docgenix_last");

    fetchProjects().then((allProjects) => {
      if (lastId && allProjects.length > 0) {
        const id = Number(lastId);
        if (allProjects.some((p: Project) => p.id === id)) {
          loadProject(id, allProjects);
        }
      }
    });
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const seedIdea = searchParams.get("idea");
    const autostart = searchParams.get("autostart") === "1";
    if (!seedIdea || autoSubmitRef.current) return;

    autoSubmitRef.current = true;
    if (!idea.trim()) {
      setIdea(seedIdea);
    }
    if (autostart) {
      submitIdea(seedIdea);
    }
    router.replace("/app", { scroll: false });
  }, [searchParams, idea, router]);

  // Close share menu when clicking outside
  useEffect(() => {
    if (!showShareMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showShareMenu]);

  useEffect(() => {
    if (projectId === null) return;
    const overview = docs.find((d) => d.agent === "Project Overview");
    if (overview) storeProjectName(projectId, overview.markdown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, projectId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Reset edit mode when switching documents
  useEffect(() => {
    setIsEditing(false);
    setEditContent("");
  }, [selectedDoc?.agent]);

  if (!mounted) return null;

  async function handleSaveEdit(doc: GeneratedDoc) {
    if (!doc.doc_id) return;
    setEditSaving(true);
    try {
      await fetch(`${API_URL}/documents/${doc.doc_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: editContent }),
      });
      const updated = { ...doc, markdown: editContent };
      setDocs((prev) => prev.map((d) => (d.doc_id === doc.doc_id ? updated : d)));
      setSelectedDoc(updated);
      setIsEditing(false);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleGenerate(agent: string) {
    if (!idea.trim()) return;
    // Capture which project this generation belongs to
    const myProjId = projectId;
    setGenLoading(true);
    setContextReady(false);
    setActiveAgents(agent === "all" ? new Set(AGENTS) : new Set([agent]));
    setCriticStatus(null);

    let currentProjId = myProjId;

    try {
      const res = await fetch(`${API_URL}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, agent, project_id: myProjId }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "project") {
              currentProjId = data.project_id;
              projectIdRef.current = data.project_id;
              setProjectId(data.project_id);
              fetchProjects();
            } else if (data.type === "status") {
              // Only update UI status if we're still on this project
            } else if (data.type === "result") {
              const newDoc: GeneratedDoc = {
                agent: data.agent,
                markdown: data.markdown,
                doc_id: data.doc_id,
                ...(data.nodes ? { nodes: data.nodes, edges: data.edges } : {}),
                ...(data.er_nodes
                  ? { er_nodes: data.er_nodes, er_edges: data.er_edges }
                  : {}),
              };
              // Always store the name (safe regardless of which project is active)
              if (data.agent === "Project Overview" && currentProjId !== null) {
                storeProjectName(currentProjId, data.markdown);
              }
              // Only mutate visible state if the user is still viewing this project
              if (projectIdRef.current === currentProjId) {
                setDocs((prev) => {
                  const filtered = prev.filter((d) => d.agent !== data.agent);
                  return [...filtered, newDoc];
                });
                setSelectedDoc(newDoc);
                setActiveAgents((prev) => {
                  const next = new Set(prev);
                  next.delete(data.agent);
                  return next;
                });
              }
            } else if (data.type === "iteration") {
              if (projectIdRef.current === currentProjId) {
                if (data.revising) {
                  setCriticStatus(`Revising: ${data.revising.join(", ")}`);
                  setActiveAgents(new Set(data.revising));
                }
              }
            } else if (data.type === "critic_start") {
              if (projectIdRef.current === currentProjId) {
                const reviewing = data.reviewing?.length
                  ? `Reviewing: ${data.reviewing.join(", ")}`
                  : "Reviewing all documents...";
                setCriticStatus(reviewing);
                setActiveAgents(new Set());
              }
            } else if (data.type === "critic_result") {
              if (projectIdRef.current === currentProjId) {
                setCriticStatus("Critic review complete");
              }
            } else if (data.type === "critic_approved") {
              if (projectIdRef.current === currentProjId) {
                setCriticStatus("All documents approved by critic!");
              }
            } else if (data.type === "critic_max_iterations") {
              if (projectIdRef.current === currentProjId) {
                setCriticStatus("Max review iterations reached");
              }
            } else if (data.type === "graph") {
              if (projectIdRef.current === currentProjId) {
                setDocs((prev) =>
                  prev.map((d) =>
                    d.doc_id === data.doc_id
                      ? {
                          ...d,
                          ...(data.nodes ? { nodes: data.nodes, edges: data.edges } : {}),
                          ...(data.er_nodes ? { er_nodes: data.er_nodes, er_edges: data.er_edges } : {}),
                        }
                      : d,
                  ),
                );
              }
            } else if (data.type === "error") {
            } else if (data.type === "done") {
              if (projectIdRef.current === currentProjId) {
                setActiveAgents(new Set());
              }
            }
          } catch {
            // skip
          }
        }
      }
    } catch {
    } finally {
      if (projectIdRef.current === currentProjId) {
        setGenLoading(false);
        setActiveAgents(new Set());
      }
    }
  }

  async function streamChat(pid: number, message: string) {
    setChatOpen(true);
    lockProject(pid);
    setChatMessages((prev) => [...prev, { role: "user", content: message }]);
    setChatLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: pid, message }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let assistantMsg = "";
      let streamingStarted = false;
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "token") {
              const token = (data.content ?? "").replace(/<\/?think>/gi, "");
              if (!token) continue;
              if (!streamingStarted) {
                streamingStarted = true;
                setChatMessages((prev) => [
                  ...prev,
                  { role: "assistant", content: "" },
                ]);
              }
              assistantMsg += token;
              setChatMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: assistantMsg,
                };
                return updated;
              });
            } else if (data.type === "result") {
              assistantMsg = "";
              const newDoc = { agent: data.agent, markdown: data.markdown };
              setDocs((prev) => {
                const filtered = prev.filter((d) => d.agent !== data.agent);
                return [...filtered, newDoc];
              });
            } else if (data.type === "status" && data.message) {
              assistantMsg = "";
              setChatMessages((prev) => [
                ...prev,
                { role: "assistant", content: `_${data.message}_` },
              ]);
            } else if (data.type === "chat_message") {
              assistantMsg = "";
              setChatMessages((prev) => [
                ...prev,
                { role: "assistant", content: data.content },
              ]);
            } else if (data.type === "done" && data.context) {
              setIdea(data.context);
              const fields = ["platform", "features", "tech_stack", "audience"];
              const complete = fields.every((f) => {
                const match = data.context.match(
                  new RegExp(`${f}:\\s*(.+)`, "i"),
                );
                return (
                  match &&
                  match[1].trim().toLowerCase() !== "unknown" &&
                  match[1].trim() !== ""
                );
              });
              setContextReady(complete);
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleChat() {
    if (!chatInput.trim() || projectId === null) return;
    const msg = chatInput;
    setChatInput("");
    setChatOpen(true);
    await streamChat(projectId, msg);
  }

  async function submitIdea(text: string) {
    if (!text.trim()) return;
    let pid = projectId;
    if (pid === null) {
      const res = await fetch(`${API_URL}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: text }),
      });
      const data = await res.json();
      pid = data.project_id;
      setProjectId(pid);
      pushRecent(pid!);
      fetchProjects();
    }
    await streamChat(pid!, text);
  }

  async function handleSubmitIdea() {
    await submitIdea(idea);
  }

  function handleNewProject() {
    setProjectId(null);
    setIdea("");
    setContextReady(false);
    setChatMessages([]);
    setDocs([]);
    setSelectedDoc(null);
    setActiveAgents(new Set());
    requestAnimationFrame(() => promptRef.current?.focus());
  }

  async function handleDeleteProject(id: number) {
    await fetch(`${API_URL}/projects/${id}`, { method: "DELETE" });
    if (projectId === id) handleNewProject();

    // Remove from all localStorage entries
    try {
      setLockedProjects((prev) => {
        const next = new Set(prev);
        next.delete(id);
        localStorage.setItem("lockedProjects", JSON.stringify([...next]));
        return next;
      });

      const storedRecent = localStorage.getItem("docgenix_recent");
      if (storedRecent) {
        const cleaned = JSON.parse(storedRecent).filter(
          (i: number) => i !== id,
        );
        localStorage.setItem("docgenix_recent", JSON.stringify(cleaned));
      }

      const storedNames = localStorage.getItem("docgenix_names");
      if (storedNames) {
        const names = JSON.parse(storedNames) as Record<string, string>;
        delete names[String(id)];
        localStorage.setItem("docgenix_names", JSON.stringify(names));
      }

      const lastId = localStorage.getItem("docgenix_last");
      if (lastId === String(id)) localStorage.removeItem("docgenix_last");
    } catch {
      /* ignore */
    }

    fetchProjects();
  }
  const activeCount = activeAgents.size;

  async function handleDownloadZip() {
    if (projectId === null) return;
    setShowShareMenu(false);

    const zip = new JSZip();

    for (const doc of docs) {
      const filename = doc.agent.replace(/ /g, "_").replace(/\//g, "-") + ".md";
      zip.file(filename, doc.markdown);
    }

    for (const [ref, name] of [
      [archDiagramRef, "System_Architecture"],
      [erDiagramRef, "Data_Model"],
    ] as const) {
      try {
        if (ref.current) {
          const dataUrl = await ref.current.toPng();
          const base64 = dataUrl.split(",")[1];
          zip.file(`${name}.png`, base64, { base64: true });
        }
      } catch { /* diagram not mounted */ }
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `project_${projectId}_docs.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopyLink() {
    if (projectId === null) return;
    const url = `${window.location.origin}?project=${projectId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    });
  }

  return (
    <div className={s.appShell}>
      {contextReady && !genLoading && (
        <div
          className={s.contextReadyOverlay}
          onClick={() => setContextReady(false)}
        />
      )}
      {/* ── Sidebar ── */}
      <aside
        className={`${s.sidebar} ${isSidebarCollapsed ? s.sidebarCollapsed : ""}`}
      >
        {isSidebarCollapsed ? (
          <div className={s.collapsedIconStack}>
            <button
              type="button"
              className={s.sidebarCollapseBtn}
              onClick={() => setIsSidebarCollapsed((v) => !v)}
              title="Expand side panel"
            >
              <IconSidebarToggle collapsed />
            </button>
            <button
              type="button"
              onClick={handleNewProject}
              className={`${s.btnNewProject} ${s.btnNewProjectCollapsed}`}
              title="New Project"
            >
              <IconPlus />
            </button>
          </div>
        ) : (
          <>
            <div className={s.sidebarBrand}>
              <div className={s.brandLogo}>D</div>
              <div className={s.brandText}>
                <div className={s.brandName}>DocGenix</div>
                <div className={s.brandSubtitle}>AI WORKSPACE</div>
              </div>
              <button
                type="button"
                className={s.sidebarCollapseBtn}
                onClick={() => setIsSidebarCollapsed((v) => !v)}
                title="Collapse side panel"
              >
                <IconSidebarToggle collapsed={false} />
              </button>
            </div>
            <nav className={s.sidebarNav}>
              <button
                type="button"
                onClick={handleNewProject}
                className={s.btnNewProject}
                title="New Project"
              >
                <IconPlus />
                <span className={s.sidebarButtonText}>New Project</span>
              </button>
            </nav>
          </>
        )}

        {projects.length > 0 && (
          <div
            className={`${s.recentSection} ${isSidebarCollapsed ? s.recentSectionCollapsed : ""}`}
            aria-hidden={isSidebarCollapsed}
          >
            <div className={s.recentLabel}>RECENT</div>
            <div className={s.projectList}>
              {[...projects]
                .sort((a, b) => {
                  const ai = recentIds.indexOf(a.id);
                  const bi = recentIds.indexOf(b.id);
                  if (ai === -1 && bi === -1) return b.id - a.id;
                  if (ai === -1) return 1;
                  if (bi === -1) return -1;
                  return ai - bi;
                })
                .slice(0, 8)
                .map((proj) => (
                  <div key={proj.id} className={s.projectRow}>
                    <button
                      type="button"
                      onClick={() => loadProject(proj.id)}
                      className={`${s.projectItem} ${projectId === proj.id ? s.projectItemActive : ""}`}
                      title={proj.idea}
                    >
                      {projectNames[proj.id] || proj.idea}
                    </button>
                    <button
                      type="button"
                      className={s.btnDeleteProject}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProject(proj.id);
                      }}
                      title="Delete project"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        width="12"
                        height="12"
                      >
                        <path d="M11 1.75V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM6.5 1.75V3h3V1.75a.25.25 0 00-.25-.25h-2.5a.25.25 0 00-.25.25zM4.997 6.178a.75.75 0 10-1.493.144l.684 7.084A1.75 1.75 0 005.926 15h4.148a1.75 1.75 0 001.738-1.594l.684-7.084a.75.75 0 00-1.493-.144L10.32 13.23a.25.25 0 01-.249.228H5.926a.25.25 0 01-.248-.228L4.997 6.178z" />
                      </svg>
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}
      </aside>

      {/* ── Main Area ── */}
      <div className={s.mainArea}>
        {/* Top Nav */}
        <header className={s.topnav}>
          <div className={s.breadcrumbs}>
            <span>DocGenix</span>
            {projectId !== null && (
              <>
                <span className={s.breadcrumbSep}>/</span>
                <span>
                  {projectId !== null && projectNames[projectId]
                    ? projectNames[projectId]
                    : `Project #${projectId}`}
                </span>
                <span className={s.breadcrumbSep}>/</span>
                <span className={s.breadcrumbCurrent}>
                  {selectedDoc?.agent ?? "Overview"}
                </span>
              </>
            )}
          </div>
          <div className={s.topnavActions}>
            <div ref={shareRef} className={s.shareWrapper}>
              <button
                type="button"
                className={s.btnShare}
                onClick={() => setShowShareMenu((v) => !v)}
                disabled={projectId === null}
              >
                Share
              </button>
              {showShareMenu && (
                <div className={s.shareMenu}>
                  <button
                    type="button"
                    className={s.shareMenuItem}
                    onClick={handleDownloadZip}
                  >
                    <span className={s.shareMenuIcon}>⬇</span>
                    Download as ZIP
                  </button>
                  <button
                    type="button"
                    className={s.shareMenuItem}
                    onClick={handleCopyLink}
                  >
                    <span className={s.shareMenuIcon}>
                      {copyDone ? "✓" : "⎘"}
                    </span>
                    {copyDone ? "Link copied!" : "Copy share link"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className={s.contentRow}>
          {/* ── Left Input Panel ── */}
          <div className={s.inputPanel}>
            {/* System Prompt */}
            <div>
              <div className={s.panelLabel}>PROJECT CONTEXT</div>
              <div className={s.promptWrapper}>
                <textarea
                  className={`${s.promptTextarea} ${ideaLocked ? s.promptTextareaLocked : ""}`}
                  rows={3}
                  placeholder={"Describe your software project here!"}
                  value={idea}
                  readOnly={ideaLocked}
                  ref={promptRef}
                  title={
                    ideaLocked
                      ? "Context locked — use the AI Assistant chat on the right to refine your project"
                      : undefined
                  }
                  onChange={(e) => !ideaLocked && setIdea(e.target.value)}
                />
                {!ideaLocked && (
                  <button
                    type="button"
                    onClick={handleSubmitIdea}
                    disabled={chatLoading || !idea.trim()}
                    title="Start conversation"
                    className={s.promptSendBtn}
                  >
                    {chatLoading ? <Spinner size={12} /> : <IconSend />}
                  </button>
                )}
              </div>
            </div>

            {/* Output type toggle */}
            <div>
              <div className={s.panelSublabel}>OUTPUT TYPE</div>
              <div className={s.outputToggle}>
                <button
                  type="button"
                  onClick={() => setOutputMode("docs")}
                  className={`${s.toggleBtn} ${outputMode === "docs" ? s.toggleBtnActive : ""}`}
                >
                  Documentation
                </button>
                <button
                  type="button"
                  onClick={() => setOutputMode("diagrams")}
                  className={`${s.toggleBtn} ${outputMode === "diagrams" ? s.toggleBtnActive : ""}`}
                >
                  Diagrams
                </button>
              </div>
            </div>

            {/* Run All */}
            <div
              className={
                contextReady && !genLoading ? s.btnRunAllSpotlight : ""
              }
            >
              <button
                type="button"
                onClick={() => handleGenerate("all")}
                disabled={genLoading || !idea.trim()}
                className={`${s.btnRunAll} ${contextReady && !genLoading ? s.btnRunAllReady : ""}`}
              >
                {genLoading ? (
                  <>
                    <Spinner size={12} />
                    <span>Running…</span>
                  </>
                ) : (
                  "Run All Agents"
                )}
              </button>
              {contextReady && !genLoading && (
                <p className={s.btnRunAllHint}>
                  Ready — click to generate all docs
                </p>
              )}
            </div>

            {/* Critic status */}
            {criticStatus && (
              <div className={s.criticStatus}>
                <div className={s.criticLabel}>
                  <span>🔍 Critic</span>
                </div>
                <p className={s.criticMsg}>{criticStatus}</p>
              </div>
            )}

            {/* Agents list */}
            <div>
              <div className={s.panelSublabel}>AGENTS</div>
              <div className={s.agentsList}>
                {(outputMode === "diagrams"
                  ? DIAGRAM_AGENTS
                  : AGENTS.filter((a) => !DIAGRAM_AGENTS.includes(a))
                ).map((agent) => {
                  const isActive = activeAgents.has(agent);
                  const isDone = docs.some((d) => d.agent === agent);
                  const doc = docs.find((d) => d.agent === agent);
                  const isSelected = selectedDoc?.agent === agent;
                  const ck = AGENT_COLOR_KEY[agent] ?? "Blue";

                  const itemClass = [
                    s.agentItem,
                    isDone && !isSelected ? s.agentItemDone : "",
                    isSelected
                      ? s[`agentItemSelected${ck}` as keyof typeof s]
                      : "",
                  ].join(" ");

                  const iconClass = `${s.agentIconBox} ${isActive || isDone ? s[`agentIcon${ck}` as keyof typeof s] : s.agentIconIdle}`;

                  const labelClass = `${s.agentLabel} ${isSelected ? s[`agentLabel${ck}` as keyof typeof s] : isDone ? s.agentLabelDone : s.agentLabelIdle}`;

                  const checkClass = `${s.agentCheck} ${s[`agentCheck${ck}` as keyof typeof s]}`;

                  return (
                    <button
                      type="button"
                      key={agent}
                      onClick={() =>
                        isDone && doc
                          ? setSelectedDoc(doc)
                          : handleGenerate(agent)
                      }
                      disabled={
                        isActive || (!isDone && (genLoading || !idea.trim()))
                      }
                      className={itemClass}
                    >
                      <span className={iconClass}>
                        {AGENT_ICONS[agent] ?? "•"}
                      </span>
                      <span className={labelClass}>{agent}</span>
                      {isActive && <Spinner size={12} />}
                      {isDone && !isActive && (
                        <span className={checkClass}>✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Center: Doc Viewer ── */}
          {(() => {
            const diagramDocs = docs.filter((d) =>
              DIAGRAM_AGENTS.includes(d.agent),
            );
            const activeDiagram =
              diagramDocs.find((d) => d.agent === selectedDoc?.agent) ??
              diagramDocs[0] ??
              null;
            const docOnlyDocs = docs.filter(
              (d) => !DIAGRAM_AGENTS.includes(d.agent),
            );
            const activeDoc =
              selectedDoc && !DIAGRAM_AGENTS.includes(selectedDoc.agent)
                ? selectedDoc
                : (docOnlyDocs[0] ?? null);

            return (
              <div className={s.centerPanel}>
                {outputMode === "diagrams" ? (
                  diagramDocs.length > 0 ? (
                    <>
                      {activeDiagram && (
                        <div className={s.diagramPanel} ref={diagramPanelRef}>
                          <button
                            type="button"
                            className={s.btnFullscreen}
                            onClick={toggleDiagramFullscreen}
                            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                          >
                            {isFullscreen ? (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 0 2-2h3M3 16h3a2 2 0 0 0 2 2v3"/></svg>
                            ) : (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                            )}
                          </button>
                          <button
                            type="button"
                            className={s.btnDiagramRegenerate}
                            onClick={() => handleGenerate(activeDiagram.agent)}
                            disabled={genLoading}
                            title={`Regenerate ${activeDiagram.agent}`}
                          >
                            ↻ Regenerate
                          </button>
                          {activeDiagram.agent === "Data Model" &&
                          activeDiagram.er_nodes &&
                          activeDiagram.er_nodes.length > 0 ? (
                            <ERDiagram
                              ref={erDiagramRef}
                              key={activeDiagram.agent}
                              nodes={activeDiagram.er_nodes}
                              edges={activeDiagram.er_edges ?? []}
                            />
                          ) : activeDiagram.nodes &&
                            activeDiagram.nodes.length > 0 ? (
                            <ArchitectureDiagram
                              ref={archDiagramRef}
                              key={activeDiagram.agent}
                              nodes={activeDiagram.nodes}
                              edges={activeDiagram.edges ?? []}
                            />
                          ) : (
                            <div className={s.emptyState}>
                              <div className={s.emptyIcon}>⬡</div>
                              <div>
                                <p className={s.emptyTitle}>No diagram yet</p>
                                <p className={s.emptyDesc}>
                                  Regenerate {activeDiagram.agent} to produce
                                  the visual diagram
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className={s.emptyState}>
                      <div className={s.emptyIcon}>⬡</div>
                      <div>
                        <p className={s.emptyTitle}>No diagrams yet</p>
                        <p className={s.emptyDesc}>
                          Generate System Architecture or Data Model to view
                          diagrams
                        </p>
                      </div>
                    </div>
                  )
                ) : docOnlyDocs.length > 0 ? (
                  <>
                    {activeDoc && (
                      <div className={s.docContent}>
                        <div className={s.docHeader}>
                          <p className={s.docSubtitle}>
                            v1.0 · Generated by DocGenix AI
                          </p>
                          <div className={s.docHeaderActions}>
                            {isEditing ? (
                              <>
                                <button
                                  className={s.btnRegenerate}
                                  onClick={() => handleSaveEdit(activeDoc)}
                                  disabled={editSaving}
                                  title="Save changes"
                                >
                                  {editSaving ? <Spinner size={12} /> : "✓ Save"}
                                </button>
                                <button
                                  className={s.btnRegenerate}
                                  onClick={() => setIsEditing(false)}
                                  disabled={editSaving}
                                  title="Cancel editing"
                                >
                                  ✕ Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className={s.btnRegenerate}
                                  onClick={() => { setEditContent(activeDoc.markdown); setIsEditing(true); }}
                                  disabled={genLoading}
                                  title="Edit this document"
                                >
                                  ✎ Edit
                                </button>
                                <button
                                  className={s.btnRegenerate}
                                  onClick={() => handleGenerate(activeDoc.agent)}
                                  disabled={genLoading}
                                  title="Regenerate this document"
                                >
                                  ↻ Regenerate
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        {isEditing ? (
                          <textarea
                            className={s.docEditTextarea}
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            spellCheck={false}
                          />
                        ) : (
                          <div className="prose prose-invert prose-sm max-w-3xl prose-headings:text-[#F4F6FE] prose-p:text-[#A8ABB2] prose-li:text-[#A8ABB2] prose-code:text-[#C180FF] prose-code:bg-[#21262E] prose-code:px-1 prose-code:rounded prose-pre:bg-[#21262E] prose-pre:border prose-pre:border-[#44484E] prose-a:text-[#85ADFF] prose-strong:text-[#F4F6FE] prose-h2:text-[#85ADFF] prose-h3:text-[#7DE9FF]">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {activeDoc.markdown}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className={s.emptyState}>
                    <div className={s.emptyIcon}>◎</div>
                    <div>
                      <p className={s.emptyTitle}>No document selected</p>
                      <p className={s.emptyDesc}>
                        Describe your project and run an agent to generate docs
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Right Panel: AI Assistant ── */}
          <div
            className={`${s.chatPanel} ${chatOpen ? "" : s.chatPanelCollapsed}`}
          >
            <div className={s.chatHeader}>
              <button
                type="button"
                className={s.chatCollapseBtn}
                onClick={() => setChatOpen((v) => !v)}
                title={chatOpen ? "Collapse chat" : "Expand chat"}
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  width="12"
                  height="12"
                  className={chatOpen ? s.chevronOpen : s.chevronClosed}
                >
                  <path d="M9.78 12.78a.75.75 0 01-1.06 0L4.47 8.53a.75.75 0 010-1.06l4.25-4.25a.749.749 0 111.06 1.06L6.06 8l3.72 3.72a.75.75 0 010 1.06z" />
                </svg>
              </button>
              {chatOpen && (
                <span className={s.chatHeaderLabel}>AI ASSISTANT</span>
              )}
              {chatOpen && (
                <div className={s.chatHeaderRight}>
                  {activeCount > 0 && (
                    <span className={s.chatActiveBadge}>
                      {activeCount} Active
                    </span>
                  )}
                  <div
                    className={`${s.chatStatusDot} ${projectId !== null ? s.chatStatusDotActive : ""}`}
                  />
                </div>
              )}
            </div>

            {chatOpen && projectId === null && (
              <div className={s.chatWarning}>
                Create or select a project to start chatting
              </div>
            )}

            {chatOpen && (
              <>
                <div className={s.chatMessages}>
                  {chatMessages.length === 0 && projectId !== null && (
                    <div className={s.chatEmpty}>
                      Ask about your project or
                      <br />
                      request document changes
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {msg.role === "assistant" && (
                        <div className={s.chatAvatar}>D</div>
                      )}
                      <div
                        className={
                          msg.role === "user" ? s.msgUser : s.msgAssistant
                        }
                      >
                        {msg.role === "assistant" ? (
                      <div className="prose prose-invert prose-sm max-w-none leading-[1.6] prose-p:my-1 prose-li:my-0.5 prose-headings:text-[#F4F6FE] prose-code:text-[#C180FF] prose-code:bg-[#21262E] prose-code:px-1 prose-code:rounded">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          msg.content
                        )}
                      </div>
                    </div>
                  ))}
                  {chatLoading &&
                    chatMessages[chatMessages.length - 1]?.role !==
                      "assistant" && (
                      <div className="flex justify-start">
                        <div className={s.chatAvatar}>D</div>
                        <div className={s.typingIndicator}>
                          <span
                            className={`${s.typingDot} animate-bounce [animation-delay:0ms]`}
                          />
                          <span
                            className={`${s.typingDot} animate-bounce [animation-delay:300ms]`}
                          />
                          <span
                            className={`${s.typingDot} animate-bounce [animation-delay:300ms]`}
                          />
                        </div>
                      </div>
                    )}
                  <div ref={chatEndRef} />
                </div>

                <div className={s.chatInputArea}>
                  <input
                    type="text"
                    className={s.chatInput}
                    placeholder={
                      projectId === null
                        ? "Select a project first…"
                        : "Message DocGenix…"
                    }
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleChat()}
                    disabled={projectId === null || chatLoading}
                  />
                  <button
                    type="button"
                    onClick={handleChat}
                    disabled={
                      projectId === null || chatLoading || !chatInput.trim()
                    }
                    title="Send"
                    className={s.btnChatSend}
                  >
                    <IconSend />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
