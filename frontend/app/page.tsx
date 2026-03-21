"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { ArchitectureDiagram, type ArchNode, type ArchEdge } from "./components/ArchitectureDiagram";
import s from "./page.module.css";

const API_URL = "http://localhost:1000";

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
  nodes?: ArchNode[];
  edges?: ArchEdge[];
}

interface Project {
  id: number;
  idea: string;
  created_at: string;
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} className="animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}



function IconDoc() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0113.25 16H3.75A1.75 1.75 0 012 14.25V1.75z" />
    </svg>
  );
}
function IconDiagram() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
      <path d="M1 3a2 2 0 012-2h3a2 2 0 010 4H3a2 2 0 01-2-2zm9 0a2 2 0 012-2h1a2 2 0 010 4h-1a2 2 0 01-2-2zM1 9a2 2 0 012-2h1a2 2 0 010 4H3a2 2 0 01-2-2zm9 0a2 2 0 012-2h3a2 2 0 110 4h-3a2 2 0 01-2-2z" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
      <path d="M10.68 11.74a6 6 0 01-7.922-8.982 6 6 0 018.982 7.922l3.04 3.04a.749.749 0 01-.326 1.275.749.749 0 01-.734-.215l-3.04-3.04zM11.5 7a4.499 4.499 0 11-8.997 0A4.499 4.499 0 0111.5 7z" />
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

const NAV_ITEMS: { label: string; icon: React.ReactNode }[] = [
  { label: "Documents", icon: <IconDoc /> },
  { label: "Diagrams", icon: <IconDiagram /> },
];

export default function Home() {
  const [idea, setIdea] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [docs, setDocs] = useState<GeneratedDoc[]>([]);
  const [genStatus, setGenStatus] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<GeneratedDoc | null>(null);
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set());

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [recentIds, setRecentIds] = useState<number[]>([]);

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
      const data = await res.json();
      setProjects(data);
      return data as Project[];
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
      setGenStatus("");
      pushRecent(id);

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
          (d: { agent_name: string; markdown: string; arch_graph?: string }) => {
            const doc: GeneratedDoc = { agent: d.agent_name, markdown: d.markdown };
            if (d.arch_graph) {
              try {
                const g = JSON.parse(d.arch_graph);
                doc.nodes = g.nodes;
                doc.edges = g.edges;
              } catch { /* ignore */ }
            }
            return doc;
          },
        );
        setDocs(loadedDocs);
        if (loadedDocs.length > 0) setSelectedDoc(loadedDocs[0]);

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

    const lastId = localStorage.getItem("docgenix_last");

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
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  if (!mounted) return null;

  async function handleGenerate(agent: string) {
    if (!idea.trim()) return;
    setGenLoading(true);
    setActiveAgents(agent === "all" ? new Set(AGENTS) : new Set([agent]));
    setGenStatus(agent === "all" ? "Running all agents…" : `Running ${agent}…`);

    try {
      const res = await fetch(`${API_URL}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, agent, project_id: projectId }),
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
              setProjectId(data.project_id);
              fetchProjects();
            } else if (data.type === "status") {
              setGenStatus(data.message || `Running ${data.agent}…`);
            } else if (data.type === "result") {
              const newDoc: GeneratedDoc = {
                agent: data.agent,
                markdown: data.markdown,
                ...(data.nodes ? { nodes: data.nodes, edges: data.edges } : {}),
              };
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
            } else if (data.type === "error") {
              setGenStatus(`Error: ${data.message}`);
            } else if (data.type === "done") {
              setGenStatus("All documents generated");
              setActiveAgents(new Set());
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      setGenStatus(`Error: ${err}`);
    } finally {
      setGenLoading(false);
      setActiveAgents(new Set());
    }
  }

  async function handleChat() {
    if (!chatInput.trim() || projectId === null) return;
    const userMsg = chatInput;
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setChatLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, message: userMsg }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let assistantMsg = "";
      let buffer = "";

      setChatMessages((prev) => [...prev, { role: "assistant", content: "" }]);

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
              assistantMsg += data.content;
              setChatMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: assistantMsg };
                return updated;
              });
            } else if (data.type === "result") {
              const newDoc = { agent: data.agent, markdown: data.markdown };
              setDocs((prev) => {
                const filtered = prev.filter((d) => d.agent !== data.agent);
                return [...filtered, newDoc];
              });
            } else if (data.type === "status") {
              assistantMsg += `\n\n_${data.message}_\n\n`;
              setChatMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: assistantMsg };
                return updated;
              });
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

  function handleNewProject() {
    setProjectId(null);
    setIdea("");
    setChatMessages([]);
    setDocs([]);
    setSelectedDoc(null);
    setGenStatus("");
    setActiveAgents(new Set());
  }

  const completedCount = docs.length;
  const totalAgents = AGENTS.length;
  const activeCount = activeAgents.size;
  const isError = genStatus.startsWith("Error");
  const isAllDone = genStatus === "All documents generated";

  return (
    <div className={s.appShell}>

      {/* ── Sidebar ── */}
      <aside className={s.sidebar}>
        <div className={s.sidebarBrand}>
          <div className={s.brandLogo}>D</div>
          <div>
            <div className={s.brandName}>DocGenix</div>
            <div className={s.brandSubtitle}>AI WORKSPACE</div>
          </div>
        </div>

        <nav className={s.sidebarNav}>
          <button type="button" onClick={handleNewProject} className={s.btnNewProject}>
            <IconPlus />
            New Project
          </button>
          {NAV_ITEMS.map(({ label, icon }) => (
            <button
              type="button"
              key={label}
              className={s.navItem}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        {projects.length > 0 && (
          <div className={s.recentSection}>
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
                  <button
                    type="button"
                    key={proj.id}
                    onClick={() => loadProject(proj.id)}
                    className={`${s.projectItem} ${projectId === proj.id ? s.projectItemActive : ""}`}
                    title={proj.idea}
                  >
                    <span className={s.projectId}>#{proj.id}</span>
                    {proj.idea}
                  </button>
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
                <span>Project #{projectId}</span>
                <span className={s.breadcrumbSep}>/</span>
                <span className={s.breadcrumbCurrent}>{selectedDoc?.agent ?? "Overview"}</span>
              </>
            )}
          </div>
          <div className={s.topnavActions}>
            <div className={s.topnavSearch}>
              <IconSearch />
              SEARCH ARCHIVES...
            </div>
            <div className={s.topnavDivider} />
            <button type="button" className={s.btnShare}>Share</button>
            <button type="button" className={s.btnDeploy}>Deploy</button>
          </div>
        </header>

        <div className={s.contentRow}>

          {/* ── Left Input Panel ── */}
          <div className={s.inputPanel}>

            {/* System Prompt */}
            <div>
              <div className={s.panelLabel}>SYSTEM PROMPT</div>
              <div className={s.promptWrapper}>
                <textarea
                  className={s.promptTextarea}
                  rows={6}
                  placeholder={'Describe your software project...\ne.g. "A scalable microservices platform for e-commerce using Kafka and Go."'}
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => handleGenerate("all")}
                  disabled={genLoading || !idea.trim()}
                  title="Run all agents"
                  className={s.promptSendBtn}
                >
                  {genLoading ? <Spinner size={12} /> : <IconSend />}
                </button>
              </div>
            </div>

            {/* Output type toggle */}
            <div>
              <div className={s.panelSublabel}>OUTPUT TYPE</div>
              <div className={s.outputToggle}>
                <button type="button" className={`${s.toggleBtn} ${s.toggleBtnActive}`}>Documentation</button>
                <button type="button" className={s.toggleBtn}>Diagrams</button>
              </div>
            </div>

            {/* Run All */}
            <button
              type="button"
              onClick={() => handleGenerate("all")}
              disabled={genLoading || !idea.trim()}
              className={s.btnRunAll}
            >
              {genLoading ? <><Spinner size={12} /><span>Running…</span></> : "Run All Agents"}
            </button>

            {/* Progress */}
            {genLoading && completedCount > 0 && (
              <div>
                <div className={s.progressRow}>
                  <span>{completedCount} / {totalAgents} complete</span>
                  <span>{Math.round((completedCount / totalAgents) * 100)}%</span>
                </div>
                <div className={s.progressTrack}>
                  <div
                    className={s.progressFill}
                    style={{ "--progress-width": `${(completedCount / totalAgents) * 100}%` } as React.CSSProperties}
                  />
                </div>
              </div>
            )}

            {/* AI Context card */}
            {genStatus && (
              <div className={`${s.aiContextCard} ${isError ? s.aiContextCardError : isAllDone ? s.aiContextCardSuccess : ""}`}>
                <div className={s.aiContextLabel}>AI CONTEXT</div>
                <div className={`${s.aiContextText} ${isError ? s.aiContextTextError : isAllDone ? s.aiContextTextSuccess : ""}`}>
                  {genStatus}
                </div>
              </div>
            )}

            {/* Agents list */}
            <div>
              <div className={s.panelSublabel}>AGENTS</div>
              <div className={s.agentsList}>
                {AGENTS.map((agent) => {
                  const isActive = activeAgents.has(agent);
                  const isDone = docs.some((d) => d.agent === agent);
                  const doc = docs.find((d) => d.agent === agent);
                  const isSelected = selectedDoc?.agent === agent;
                  const ck = AGENT_COLOR_KEY[agent] ?? "Blue";

                  const itemClass = [
                    s.agentItem,
                    isDone && !isSelected ? s.agentItemDone : "",
                    isSelected ? s[`agentItemSelected${ck}` as keyof typeof s] : "",
                  ].join(" ");

                  const iconClass = `${s.agentIconBox} ${isActive || isDone ? s[`agentIcon${ck}` as keyof typeof s] : s.agentIconIdle}`;

                  const labelClass = `${s.agentLabel} ${isSelected ? s[`agentLabel${ck}` as keyof typeof s] : isDone ? s.agentLabelDone : s.agentLabelIdle}`;

                  const checkClass = `${s.agentCheck} ${s[`agentCheck${ck}` as keyof typeof s]}`;

                  return (
                    <button
                      type="button"
                      key={agent}
                      onClick={() => (isDone && doc ? setSelectedDoc(doc) : handleGenerate(agent))}
                      disabled={isActive || (!isDone && (genLoading || !idea.trim()))}
                      className={itemClass}
                    >
                      <span className={iconClass}>{AGENT_ICONS[agent] ?? "•"}</span>
                      <span className={labelClass}>{agent}</span>
                      {isActive && <Spinner size={12} />}
                      {isDone && !isActive && <span className={checkClass}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Center: Doc Viewer ── */}
          <div className={s.centerPanel}>
            {selectedDoc ? (
              <>
                <div className={s.docTabs}>
                  {docs.map((doc) => (
                    <button
                      type="button"
                      key={doc.agent}
                      onClick={() => setSelectedDoc(doc)}
                      className={`${s.docTab} ${selectedDoc.agent === doc.agent ? s.docTabActive : ""}`}
                    >
                      {doc.agent.toUpperCase()}
                    </button>
                  ))}
                </div>

                <div className={s.docContent}>
                  <h1 className={s.docTitle}>{selectedDoc.agent}</h1>
                  <p className={s.docSubtitle}>v1.0 · Generated by DocGenix AI</p>

                  {selectedDoc.agent === "System Architecture" &&
                  selectedDoc.nodes &&
                  selectedDoc.nodes.length > 0 ? (
                    <>
                      <ArchitectureDiagram nodes={selectedDoc.nodes} edges={selectedDoc.edges ?? []} />
                      <details className="mt-6">
                        <summary className={s.rawMdToggle}>VIEW RAW MARKDOWN</summary>
                        <div className="mt-4 prose prose-invert prose-sm max-w-3xl prose-headings:text-[#F4F6FE] prose-p:text-[#A8ABB2] prose-li:text-[#A8ABB2] prose-code:text-[#C180FF] prose-code:bg-[#21262E] prose-code:px-1 prose-code:rounded prose-pre:bg-[#21262E] prose-pre:border prose-pre:border-[#44484E] prose-a:text-[#85ADFF] prose-strong:text-[#F4F6FE] prose-h2:text-[#85ADFF]">
                          <ReactMarkdown>{selectedDoc.markdown}</ReactMarkdown>
                        </div>
                      </details>
                    </>
                  ) : (
                    <div className="prose prose-invert prose-sm max-w-3xl prose-headings:text-[#F4F6FE] prose-p:text-[#A8ABB2] prose-li:text-[#A8ABB2] prose-code:text-[#C180FF] prose-code:bg-[#21262E] prose-code:px-1 prose-code:rounded prose-pre:bg-[#21262E] prose-pre:border prose-pre:border-[#44484E] prose-a:text-[#85ADFF] prose-strong:text-[#F4F6FE] prose-h2:text-[#85ADFF] prose-h3:text-[#7DE9FF]">
                      <ReactMarkdown>{selectedDoc.markdown}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className={s.emptyState}>
                <div className={s.emptyIcon}>◎</div>
                <div>
                  <p className={s.emptyTitle}>No document selected</p>
                  <p className={s.emptyDesc}>Describe your project and run an agent to generate docs</p>
                </div>
                {!projectId && (
                  <button type="button" onClick={handleNewProject} className={s.btnGetStarted}>
                    Get Started
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Right Panel: AI Assistant ── */}
          <div className={s.chatPanel}>
            <div className={s.chatHeader}>
              <span className={s.chatHeaderLabel}>AI ASSISTANT</span>
              <div className={s.chatHeaderRight}>
                {activeCount > 0 && (
                  <span className={s.chatActiveBadge}>{activeCount} Active</span>
                )}
                <div className={`${s.chatStatusDot} ${projectId !== null ? s.chatStatusDotActive : ""}`} />
              </div>
            </div>

            {projectId === null && (
              <div className={s.chatWarning}>
                Create or select a project to start chatting
              </div>
            )}

            <div className={s.chatMessages}>
              {chatMessages.length === 0 && projectId !== null && (
                <div className={s.chatEmpty}>
                  Ask about your project or<br />request document changes
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "assistant" && <div className={s.chatAvatar}>D</div>}
                  <div className={msg.role === "user" ? s.msgUser : s.msgAssistant}>
                    {msg.role === "assistant" ? (
                      <div className="prose prose-invert prose-xs max-w-none prose-p:my-1 prose-li:my-0.5 prose-headings:text-[#F4F6FE] prose-code:text-[#C180FF] prose-code:bg-[#21262E] prose-code:px-1 prose-code:rounded">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className={s.chatAvatar}>D</div>
                  <div className={s.typingIndicator}>
                    <span className={`${s.typingDot} animate-bounce [animation-delay:0ms]`} />
                    <span className={`${s.typingDot} animate-bounce [animation-delay:150ms]`} />
                    <span className={`${s.typingDot} animate-bounce [animation-delay:300ms]`} />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className={s.chatInputArea}>
              <input
                type="text"
                className={s.chatInput}
                placeholder={projectId === null ? "Select a project first…" : "Message DocGenix…"}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleChat()}
                disabled={projectId === null || chatLoading}
              />
              <button
                type="button"
                onClick={handleChat}
                disabled={projectId === null || chatLoading || !chatInput.trim()}
                title="Send"
                className={s.btnChatSend}
              >
                <IconSend />
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
