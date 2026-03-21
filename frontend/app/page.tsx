"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface GeneratedDoc {
  agent: string;
  markdown: string;
}

export default function Home() {
  // Generation state
  const [idea, setIdea] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [docs, setDocs] = useState<GeneratedDoc[]>([]);
  const [genStatus, setGenStatus] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<GeneratedDoc | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  if (!mounted) return null;

  async function handleGenerate(agent: string) {
    if (!idea.trim()) return;
    setGenLoading(true);
    setGenStatus(`Running ${agent}...`);

    try {
      const res = await fetch(`${API_URL}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea,
          agent,
          project_id: projectId,
        }),
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
            } else if (data.type === "status") {
              setGenStatus(data.message || `Running ${data.agent}...`);
            } else if (data.type === "result") {
              const newDoc = { agent: data.agent, markdown: data.markdown };
              setDocs((prev) => {
                const filtered = prev.filter((d) => d.agent !== data.agent);
                return [...filtered, newDoc];
              });
              setSelectedDoc(newDoc);
            } else if (data.type === "error") {
              setGenStatus(`Error: ${data.message}`);
            } else if (data.type === "done") {
              setGenStatus("Done");
            }
          } catch {
            // skip non-JSON lines
          }
        }
      }
    } catch (err) {
      setGenStatus(`Error: ${err}`);
    } finally {
      setGenLoading(false);
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
        body: JSON.stringify({
          project_id: projectId,
          message: userMsg,
        }),
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
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: assistantMsg,
                };
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
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: assistantMsg,
                };
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

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">API Test Dashboard</h1>
        {projectId !== null && (
          <span className="text-sm text-zinc-400">
            Project ID: {projectId}
          </span>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Controls */}
        <div className="w-80 border-r border-zinc-800 flex flex-col p-4 gap-4 overflow-y-auto">
          {/* Idea Input */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">
              Project Idea
            </label>
            <textarea
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Describe your software project idea..."
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
            />
          </div>

          {/* Agent Buttons */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              Generate Docs
            </label>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleGenerate("all")}
                disabled={genLoading || !idea.trim()}
                className="w-full px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Run All Agents
              </button>
              <div className="border-t border-zinc-800 my-1" />
              {AGENTS.map((agent) => (
                <button
                  key={agent}
                  onClick={() => handleGenerate(agent)}
                  disabled={genLoading || !idea.trim()}
                  className="w-full px-3 py-2 rounded-lg text-sm text-left bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {agent}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          {genStatus && (
            <div className="text-xs text-zinc-400 bg-zinc-900 rounded-lg px-3 py-2">
              {genStatus}
            </div>
          )}

          {/* Generated Docs Tabs */}
          {docs.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                Generated Docs
              </label>
              <div className="flex flex-col gap-1">
                {docs.map((doc) => (
                  <button
                    key={doc.agent}
                    onClick={() => setSelectedDoc(doc)}
                    className={`w-full px-3 py-2 rounded-lg text-sm text-left transition ${
                      selectedDoc?.agent === doc.agent
                        ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                        : "bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    {doc.agent}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Middle Panel - Doc Viewer */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedDoc ? (
            <div className="flex-1 overflow-y-auto p-6">
              <h2 className="text-lg font-semibold mb-4 text-blue-400">
                {selectedDoc.agent}
              </h2>
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown>{selectedDoc.markdown}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-600">
              <p>Enter an idea and click an agent to generate docs</p>
            </div>
          )}
        </div>

        {/* Right Panel - Chat */}
        <div className="w-96 border-l border-zinc-800 flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-400">Chatbot</h2>
            {projectId === null && (
              <p className="text-xs text-yellow-500 mt-1">
                Generate docs first to get a project ID
              </p>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-800 text-zinc-200"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <div className="p-4 border-t border-zinc-800">
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={
                  projectId === null
                    ? "Generate docs first..."
                    : "Type a message..."
                }
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleChat()}
                disabled={projectId === null || chatLoading}
              />
              <button
                onClick={handleChat}
                disabled={projectId === null || chatLoading || !chatInput.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
