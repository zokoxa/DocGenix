import asyncio
from typing import AsyncGenerator

from utils.doc_agents import make_doc_agents
from models.database import create_project, save_document, get_project_context


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


def _build_prompt(idea: str, context: str | None = None) -> str:
    parts = [
        "Produce your documentation artifact for this software project idea:\n",
        idea,
    ]
    if context:
        parts.append("\n\n## Project Details (from user interview)\n")
        parts.append(context)
    parts.append("\n\nFollow your instructions exactly and return only your document.")
    return "\n".join(parts)


async def _run_single_agent(agent, prompt: str, queue: asyncio.Queue, project_id: int):
    """Run one agent, persist output, push events to queue."""
    await queue.put({"type": "status", "agent": agent.name})
    try:
        output = await agent.run(prompt)
        await save_document(project_id, agent.name, output)
        await queue.put({"type": "result", "agent": agent.name, "markdown": output})
    except Exception as e:
        import traceback
        traceback.print_exc()
        await queue.put({"type": "error", "agent": agent.name, "message": str(e)})


async def run_generation(idea: str, agent_name: str, project_id: int | None) -> AsyncGenerator[dict, None]:
    """Async generator yielding SSE event dicts for document generation."""
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

    tasks = [
        asyncio.create_task(_run_single_agent(a, prompt, queue, project_id))
        for a in targets
    ]

    # Each agent produces 2 events (status + result/error)
    expected = len(targets) * 2
    received = 0
    while received < expected:
        event = await queue.get()
        yield event
        received += 1

    await asyncio.gather(*tasks, return_exceptions=True)
    yield {"type": "done"}
