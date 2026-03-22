import asyncio
import json
import os
import re
from typing import AsyncGenerator

from langchain_ollama import ChatOllama

from models.schemas import ArchitectureGraph, ERGraph
from utils.doc_agents import make_doc_agents
from agents.critic import make_agent as make_critic
from models.database import create_project, save_document, get_project_context, get_documents


AGENT_NAMES = [
    "Project Overview",
    "Requirements",
    "User Stories",
    "System Architecture",
    "API Spec",
    "Data Model",
    "DevOps & Deployment",
    "Testing Strategy",
]

ARCH_AGENT_NAME = "System Architecture"
DATA_MODEL_AGENT_NAME = "Data Model"
GRAPH_AGENTS = {ARCH_AGENT_NAME, DATA_MODEL_AGENT_NAME}

MAX_ITERATIONS = 2  # max critic revision rounds


def _build_prompt(idea: str, context: str | None = None) -> str:
    parts = []
    if context:
        parts.append("## Project Context (from user interview)\n")
        parts.append(context)
        parts.append("\n\n---\n")
    parts.append("Produce your documentation artifact for this software project idea:\n")
    parts.append(idea)
    parts.append("\n\nFollow your instructions exactly and return only your document.")
    return "\n".join(parts)


def _build_revision_prompt(idea: str, context: str | None, previous_output: str, feedback: str) -> str:
    parts = [
        "You previously generated the following document for this software project idea:\n",
        idea,
    ]
    if context:
        parts.append("\n\n## Project Details (from user interview)\n")
        parts.append(context)
    parts.append("\n\n## Your Previous Output\n")
    parts.append(previous_output)
    parts.append("\n\n## Critic Feedback\n")
    parts.append(feedback)
    parts.append(
        "\n\nRevise your document to address the feedback above. "
        "Keep everything that was good, fix what was criticized. "
        "Return ONLY the revised document."
    )
    return "\n".join(parts)


def _build_critic_prompt(
    idea: str,
    context: str | None,
    docs: dict[str, str],
    focus_agents: list[str] | None = None,
) -> str:
    parts = [
        "Review the following documentation suite for this software project idea:\n",
        idea,
    ]
    if context:
        parts.append("\n\n## Project Details (from user interview)\n")
        parts.append(context)
    parts.append("\n\n---\n")
    for agent_name, markdown in docs.items():
        parts.append(f"\n## Document: {agent_name}\n")
        parts.append(markdown)
        parts.append("\n---\n")
    if focus_agents:
        parts.append(
            f"\nFocus your review on: {', '.join(focus_agents)}. "
            "The other documents are provided for cross-reference context only. "
            "Only return review sections for the focus documents."
        )
    else:
        parts.append(
            "\nReview ALL documents above. For each one, provide your assessment "
            "following your instructions exactly."
        )
    return "\n".join(parts)


def _parse_critic_feedback(review: str) -> dict[str, dict]:
    """Parse critic output into per-agent feedback.

    Returns dict like:
      {"Requirements": {"status": "NEEDS_REVISION", "feedback": "..."}, ...}
    """
    sections = re.split(r"###\s+", review)
    result = {}
    for section in sections:
        section = section.strip()
        if not section:
            continue
        lines = section.split("\n", 1)
        agent_name = lines[0].strip()
        body = lines[1].strip() if len(lines) > 1 else ""
        status = "APPROVED"
        if "NEEDS_REVISION" in body:
            status = "NEEDS_REVISION"
        result[agent_name] = {"status": status, "feedback": body}
    return result


async def _extract_graph(markdown: str, instruction: str, schema=None) -> dict:
    """Run a bare formatter LLM to extract a graph structure from markdown."""
    if schema is None:
        schema = ArchitectureGraph
    try:
        model = os.environ.get("LOCAL_LLM_MODEL", "qwen3.5")
        base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        auth = os.environ.get("OLLAMA_BASIC_AUTH", "")
        if auth:
            from urllib.parse import urlparse, urlunparse
            parsed = urlparse(base_url)
            base_url = urlunparse(parsed._replace(
                netloc=f"{auth}@{parsed.hostname}" + (f":{parsed.port}" if parsed.port else "")
            ))
        formatter = ChatOllama(model=model, base_url=base_url).with_structured_output(schema)
        result = await formatter.ainvoke(f"Always respond in English. {instruction}\n\n{markdown}")
        return result.model_dump() if hasattr(result, "model_dump") else {"nodes": [], "edges": []}
    except Exception:
        import traceback
        traceback.print_exc()
        return {"nodes": [], "edges": []}


async def _run_single_agent(agent, prompt: str, queue: asyncio.Queue, project_id: int):
    """Run one agent, persist output, push events to queue."""
    await queue.put({"type": "status", "agent": agent.name})
    try:
        if agent.name in GRAPH_AGENTS:
            markdown = await agent.run(prompt)

            if agent.name == ARCH_AGENT_NAME:
                instruction = (
                    "Extract the architecture graph from this report and return it as structured data "
                    "with nodes and edges."
                )
                graph_data = await _extract_graph(markdown, instruction)
                doc_id = await save_document(project_id, agent.name, markdown, arch_graph=json.dumps(graph_data))
                await queue.put({
                    "type": "result",
                    "agent": agent.name,
                    "markdown": markdown,
                    "doc_id": doc_id,
                    "nodes": graph_data.get("nodes", []),
                    "edges": graph_data.get("edges", []),
                })
            else:
                # Data Model — extract ER graph with columns and cardinality
                instruction = (
                    "Extract the entity-relationship diagram from this data model document. "
                    "Return structured data with nodes (entities with columns) and edges (relationships with cardinality)."
                )
                graph_data = await _extract_graph(markdown, instruction, schema=ERGraph)
                doc_id = await save_document(project_id, agent.name, markdown, arch_graph=json.dumps(graph_data))
                await queue.put({
                    "type": "result",
                    "agent": agent.name,
                    "markdown": markdown,
                    "doc_id": doc_id,
                    "er_nodes": graph_data.get("nodes", []),
                    "er_edges": graph_data.get("edges", []),
                })
        else:
            output = await agent.run(prompt)
            doc_id = await save_document(project_id, agent.name, output)
            await queue.put({"type": "result", "agent": agent.name, "markdown": output, "doc_id": doc_id})
    except Exception as e:
        import traceback
        traceback.print_exc()
        await queue.put({"type": "error", "agent": agent.name, "message": str(e)})


async def _collect_results(queue: asyncio.Queue, count: int) -> list[dict]:
    """Drain `count` events from the queue, returning them as a list."""
    events = []
    for _ in range(count):
        events.append(await queue.get())
    return events


async def run_generation(idea: str, agent_name: str, project_id: int | None, agents=None, critic=None) -> AsyncGenerator[dict, None]:
    """Async generator yielding SSE event dicts for document generation with critic loop."""
    if agents is None:
        agents = make_doc_agents()
    agent_map = {a.name: a for a in agents}

    context = None
    if project_id is not None:
        context = await get_project_context(project_id)
    prompt = _build_prompt(idea, context)

    if agent_name != "all" and agent_name not in agent_map:
        yield {"type": "error", "agent": agent_name, "error": f"Unknown agent: {agent_name}"}
        return

    if project_id is None:
        project_id = await create_project(idea)
    yield {"type": "project", "project_id": project_id}

    queue: asyncio.Queue = asyncio.Queue()

    if agent_name == "all":
        targets = agents
    else:
        targets = [agent_map[agent_name]]

    # ── Iteration 0: initial generation ──
    yield {"type": "iteration", "iteration": 1, "max_iterations": MAX_ITERATIONS + 1}

    tasks = [
        asyncio.create_task(_run_single_agent(a, prompt, queue, project_id))
        for a in targets
    ]

    expected = len(targets) * 2
    received = 0
    while received < expected:
        event = await queue.get()
        yield event
        received += 1

    await asyncio.gather(*tasks, return_exceptions=True)

    # Collect ALL project docs from DB for the critic (cross-document context)
    current_docs: dict[str, str] = {}
    db_docs = await get_documents(project_id)
    for doc in db_docs:
        current_docs[doc["agent_name"]] = doc["markdown"]
    print(f"  [Critic] collected {len(current_docs)} docs for review", flush=True)

    # Which agents the critic should focus on (only the ones we just generated)
    target_names = [a.name for a in targets]
    # For single-agent runs, focus critic on that agent only
    focus_agents = target_names if agent_name != "all" else None

    # ── Critic loop ──
    if len(current_docs) > 0:
        try:
            if critic is None:
                critic = make_critic()
            approved: set[str] = set()

            for iteration in range(MAX_ITERATIONS):
                # Only review target agents that haven't been approved yet
                pending = [a for a in targets if a.name not in approved]
                if not pending:
                    print(f"  [Critic] all targets already approved", flush=True)
                    yield {"type": "critic_approved", "iteration": iteration + 1}
                    break

                pending_names = [a.name for a in pending]
                yield {"type": "critic_start", "iteration": iteration + 1}

                # Build prompt: send all docs for context, focus on pending targets
                critic_prompt = _build_critic_prompt(
                    idea, context, current_docs, focus_agents=pending_names
                )
                print(f"  [Critic] reviewing (iteration {iteration + 1}): {pending_names}", flush=True)
                review = await critic.run(critic_prompt)
                print(f"  [Critic] done reviewing", flush=True)

                yield {"type": "critic_result", "iteration": iteration + 1, "review": review}

                # Parse feedback
                feedback_map = _parse_critic_feedback(review)
                print(f"  [Critic] feedback for: {list(feedback_map.keys())}", flush=True)

                # Check each pending agent — approve or mark for revision
                needs_revision = []
                for a in pending:
                    agent_feedback = feedback_map.get(a.name, {})
                    status = agent_feedback.get("status", "APPROVED")
                    print(f"  [Critic]   {a.name}: {status}", flush=True)
                    if status == "NEEDS_REVISION":
                        needs_revision.append(a)
                    else:
                        approved.add(a.name)

                if not needs_revision:
                    print(f"  [Critic] all approved at iteration {iteration + 1}", flush=True)
                    yield {"type": "critic_approved", "iteration": iteration + 1}
                    break

                # ── Revision round ──
                print(f"  [Critic] revising: {[a.name for a in needs_revision]}", flush=True)
                yield {
                    "type": "iteration",
                    "iteration": iteration + 2,
                    "max_iterations": MAX_ITERATIONS + 1,
                    "revising": [a.name for a in needs_revision],
                }

                rev_queue: asyncio.Queue = asyncio.Queue()
                rev_tasks = []
                for a in needs_revision:
                    fb = feedback_map[a.name]["feedback"]
                    rev_prompt = _build_revision_prompt(
                        idea, context, current_docs.get(a.name, ""), fb
                    )
                    rev_tasks.append(
                        asyncio.create_task(
                            _run_single_agent(a, rev_prompt, rev_queue, project_id)
                        )
                    )

                rev_expected = len(needs_revision) * 2
                rev_received = 0
                while rev_received < rev_expected:
                    event = await rev_queue.get()
                    yield event
                    rev_received += 1

                await asyncio.gather(*rev_tasks, return_exceptions=True)

                # Update current_docs with revised versions
                db_docs = await get_documents(project_id)
                for doc in db_docs:
                    current_docs[doc["agent_name"]] = doc["markdown"]
            else:
                yield {"type": "critic_max_iterations", "iterations": MAX_ITERATIONS}
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield {"type": "critic_error", "message": str(e)}

    yield {"type": "done"}
