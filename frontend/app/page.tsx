"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import s from "./landing.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:1000";

interface Project {
  id: number;
  idea: string;
  created_at: string;
}

function IconSend() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
      <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
    </svg>
  );
}

const TITLES = [
  "It works on my machine. Let's document it.",
  "Let's pretend this was planned all along.",
  "Good code deserves good docs, Let's fix that.",
  "404: Excuses not found. Start building.",
  "undefined is not a feature, Let's plan this right.",
];

export default function LandingPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectNames, setProjectNames] = useState<Record<number, string>>({});
  const [title, setTitle] = useState(TITLES[0]);

  useEffect(() => {
    setTitle(TITLES[Math.floor(Math.random() * TITLES.length)]);
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("docgenix_names");
      if (stored) setProjectNames(JSON.parse(stored) as Record<number, string>);
    } catch {}

    async function fetchProjects() {
      try {
        const res = await fetch(`${API_URL}/projects`);
        const data = (await res.json()) as Project[];
        setProjects(data);
      } catch {
        setProjects([]);
      }
    }
    fetchProjects();
  }, []);

  function handleSubmit() {
    const value = prompt.trim();
    if (!value) return;
    router.push(`/app?idea=${encodeURIComponent(value)}&autostart=1`);
  }

  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        <div className={s.sidebarBrand}>
          <img src="/icon.png" alt="DocGenix" className={s.brandMark} />
          <div className={s.brandText}>
            <div className={s.brandName}>DocGenix</div>
            <div className={s.brandSubtitle}>SOFTWARE DOCS</div>
          </div>
        </div>
        <div className={s.sidebarSection}>RECENTS</div>
        <div className={s.sidebarList}>
          {projects.length === 0 ? (
            <div className={s.sidebarEmpty}>No recent chats yet</div>
          ) : (
            [...projects]
              .sort((a, b) => b.id - a.id)
              .map((proj) => (
                <button
                  key={proj.id}
                  type="button"
                  className={s.sidebarItem}
                  title={proj.idea}
                  onClick={() => router.push(`/app?project=${proj.id}`)}
                >
                  {projectNames[proj.id] ?? proj.idea}
                </button>
              ))
          )}
        </div>
      </aside>
      <div className={s.page}>
        <div className={s.heroGlow} aria-hidden="true">
          <div className={s.glowOrb1} />
          <div className={s.glowOrb2} />
          <div className={s.glowBeam} />
        </div>
        <main className={s.center}>
          <h1 className={s.title}>{title}</h1>
          <div className={s.inputShell}>
            <input
              className={s.input}
              placeholder="Describe your software project here!"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
            <button
              type="button"
              className={s.sendBtn}
              onClick={handleSubmit}
              disabled={!prompt.trim()}
              aria-label="Continue"
              title="Continue"
            >
              <IconSend />
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
