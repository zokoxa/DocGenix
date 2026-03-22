import asyncio
import json
import re
from typing import AsyncGenerator

from utils.doc_agents import make_doc_agents
from agents.critic import make_agent as make_critic
from models.database import create_project, save_document, get_project_context, get_documents, update_document_graph


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


def _extract_project_name(context: str) -> str | None:
    """Pull project_name out of the key-value context block, if present."""
    for line in context.splitlines():
        if line.startswith("project_name:"):
            value = line.partition(":")[2].strip()
            if value and value.lower() != "unknown":
                return value
    return None


def _build_prompt(idea: str, context: str | None = None) -> str:
    parts = []
    if context:
        name = _extract_project_name(context)
        if name:
            parts.append(f"## Project Name\n{name}\n")
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


def _parse_arch_graph(markdown: str) -> dict:
    """Parse architecture graph from structured markdown (no LLM needed)."""
    print("  [GraphExtract] parsing architecture graph from markdown", flush=True)
    nodes = []
    edges = []

    # Parse components:
    # - ID: api-gateway | Label: API Gateway | Type: backend | Tech: Express.js | Layer: 1 | Order: 0
    #   Description: Routes incoming requests
    # Matches both "- ID: api-gw | Label: ..." and "- api-gw | Label: ..."
    comp_re = re.compile(
        r"-\s*(?:ID:\s*)?(?P<id>[^\|]+?)\s*\|\s*Label:\s*(?P<label>[^\|]+?)\s*\|\s*"
        r"Type:\s*(?P<type>[^\|]+?)\s*\|\s*Tech:\s*(?P<tech>[^\|]+?)\s*\|\s*"
        r"Layer:\s*(?P<layer>\d+)\s*\|\s*Order:\s*(?P<order>\d+)"
    )
    desc_re = re.compile(r"^\s+Description:\s*(?P<desc>.+)", re.MULTILINE)

    lines = markdown.split("\n")
    for i, line in enumerate(lines):
        m = comp_re.search(line)
        if m:
            desc = ""
            # Look ahead for Description line
            if i + 1 < len(lines):
                dm = desc_re.search(lines[i + 1])
                if dm:
                    desc = dm.group("desc").strip()
            node_type = m.group("type").strip().lower()
            if node_type not in ("frontend", "backend", "database", "queue", "external", "service"):
                node_type = "service"
            nodes.append({
                "id": m.group("id").strip(),
                "label": m.group("label").strip(),
                "description": desc,
                "technology": m.group("tech").strip(),
                "node_type": node_type,
                "layer": int(m.group("layer")),
                "order": int(m.group("order")),
            })

    # Parse connections:
    # - api-gateway -> user-service | Protocol: REST
    conn_re = re.compile(
        r"-\s*(?P<source>[^\s\-][^\->]+?)\s*->\s*(?P<target>[^\|]+?)\s*\|\s*Protocol:\s*(?P<label>.+)"
    )
    for i, line in enumerate(lines):
        m = conn_re.search(line)
        if m:
            src = m.group("source").strip()
            tgt = m.group("target").strip()
            edges.append({
                "id": f"e-{i}-{src}-{tgt}",
                "source": src,
                "target": tgt,
                "label": m.group("label").strip(),
            })

    # Reconcile edge IDs against actual node IDs
    # (LLM often uses different IDs in Connections vs Components)
    node_ids = {n["id"] for n in nodes}

    def _closest_node_id(ref: str) -> str:
        if ref in node_ids:
            return ref
        ref_l = ref.lower()
        for nid in node_ids:
            if ref_l in nid.lower() or nid.lower() in ref_l:
                return nid
        return ref  # no match — frontend will filter it out

    for edge in edges:
        edge["source"] = _closest_node_id(edge["source"])
        edge["target"] = _closest_node_id(edge["target"])

    print(f"  [GraphExtract] parsed {len(nodes)} nodes, {len(edges)} edges", flush=True)
    return {"nodes": nodes, "edges": edges}


def _parse_er_graph(markdown: str) -> dict:
    """Parse ER graph from structured markdown (no LLM needed)."""
    print("  [GraphExtract] parsing ER graph from markdown", flush=True)
    nodes = []
    edges = []

    col_re = re.compile(r"-\s*(?P<name>[^\|]+?)\s*\|\s*(?P<type>[^\|]+?)\s*\|\s*(?P<constraints>.*)")
    entity_re = re.compile(r"-\s*(?:ID:\s*)?(?:\*\*)?(?P<id>[^\|*]+?)(?:\*\*)?\s*\|\s*(?:Label:\s*)?(?P<label>[^\n|]+)")
    rel_re = re.compile(
        r"-\s*(?P<source>[^\s\-][^\->]+?)\s*->\s*(?P<target>[^\|]+?)\s*\|\s*Cardinality:\s*(?P<card>[^\|]+)"
    )

    # Section-aware parsing
    section = None  # "entities" | "relationships" | None
    current_entity = None
    in_columns = False

    for line in markdown.split("\n"):
        stripped = line.strip()

        # Track which section we're in
        if stripped.startswith("### "):
            if current_entity:
                nodes.append(current_entity)
                current_entity = None
                in_columns = False
            if "Entities" in stripped:
                section = "entities"
            elif "Relationships" in stripped:
                section = "relationships"
            else:
                section = None
            continue

        # ── Entities section ──
        if section == "entities":
            # "Columns:" marker
            if current_entity and re.match(r"\s+Columns:\s*$", line):
                in_columns = True
                continue

            # Indented column lines
            if current_entity and in_columns:
                if line.startswith("  ") and stripped.startswith("-"):
                    cm = col_re.search(line)
                    if cm:
                        current_entity["columns"].append({
                            "name": cm.group("name").strip(),
                            "type": cm.group("type").strip(),
                            "constraints": cm.group("constraints").strip(),
                        })
                    continue
                elif stripped:
                    in_columns = False

            # Top-level entity line (no "->" so not a relationship)
            if stripped.startswith("-") and "|" in stripped and "->" not in stripped:
                em = entity_re.search(line)
                if em:
                    if current_entity:
                        nodes.append(current_entity)
                    current_entity = {
                        "id": em.group("id").strip(),
                        "label": em.group("label").strip(),
                        "columns": [],
                    }
                    in_columns = False

        # ── Relationships section ──
        elif section == "relationships":
            pass  # handled below after loop

    if current_entity:
        nodes.append(current_entity)

    # Parse relationships only from the Relationships section
    rel_section = re.search(r"###\s*Relationships\s*\n(.*?)(?=###|\Z)", markdown, re.DOTALL)
    rel_lines = rel_section.group(1).split("\n") if rel_section else []
    for i, line in enumerate(rel_lines):
        m = rel_re.search(line)
        if m:
            src = m.group("source").strip()
            tgt = m.group("target").strip()
            card = m.group("card").strip()
            # Normalize cardinality to allowed values
            if card == "M:1":
                card = "1:M"
            elif card not in ("1:1", "1:M", "M:M"):
                card = "1:M"
            # Derive source/target labels
            if card == "1:1":
                src_label, tgt_label = "1", "1"
            elif card == "1:M":
                src_label, tgt_label = "1", "*"
            else:
                src_label, tgt_label = "*", "*"
            edges.append({
                "id": f"e-{i}-{src}-{tgt}",
                "source": src,
                "target": tgt,
                "label": card,
                "source_label": src_label,
                "target_label": tgt_label,
            })

    print(f"  [GraphExtract] parsed {len(nodes)} nodes, {len(edges)} edges", flush=True)
    return {"nodes": nodes, "edges": edges}


async def _run_single_agent(agent, prompt: str, queue: asyncio.Queue, project_id: int):
    """Run one agent, persist output, push events to queue."""
    await queue.put({"type": "status", "agent": agent.name})
    try:
        markdown = await agent.run(prompt)
        doc_id = await save_document(project_id, agent.name, markdown)
        await queue.put({"type": "result", "agent": agent.name, "markdown": markdown, "doc_id": doc_id})
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
                yield {"type": "critic_start", "iteration": iteration + 1, "reviewing": pending_names}

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

    # ── Graph extraction via regex (instant, no LLM call) ──
    # Only extract graphs for agents that ran in this generation, not all DB docs
    graph_targets = {a.name for a in targets} & GRAPH_AGENTS
    if not graph_targets:
        yield {"type": "done"}
        return

    db_docs = await get_documents(project_id)
    latest_docs = {doc["agent_name"]: doc for doc in db_docs}  # last write wins
    for doc in latest_docs.values():
        if doc["agent_name"] not in graph_targets:
            continue
        if doc["agent_name"] == ARCH_AGENT_NAME:
            graph_data = _parse_arch_graph(doc["markdown"])
            await update_document_graph(doc["id"], json.dumps(graph_data))
            yield {
                "type": "graph",
                "agent": ARCH_AGENT_NAME,
                "doc_id": doc["id"],
                "nodes": graph_data.get("nodes", []),
                "edges": graph_data.get("edges", []),
            }
        elif doc["agent_name"] == DATA_MODEL_AGENT_NAME:
            graph_data = _parse_er_graph(doc["markdown"])
            await update_document_graph(doc["id"], json.dumps(graph_data))
            yield {
                "type": "graph",
                "agent": DATA_MODEL_AGENT_NAME,
                "doc_id": doc["id"],
                "er_nodes": graph_data.get("nodes", []),
                "er_edges": graph_data.get("edges", []),
            }

    yield {"type": "done"}
