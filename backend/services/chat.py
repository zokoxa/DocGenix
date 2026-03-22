import asyncio
from typing import AsyncGenerator

from agents.chat import (
    build_chat_messages,
    make_chat_llm,
    extract_context,
    is_context_complete,
    run_overview,
)
from models.database import (
    get_documents,
    save_chat_message,
    save_document,
    get_chat_history,
    get_project_idea,
    get_project_context,
    save_project_context,
)


async def _extract_and_save_context(project_id: int, history: list[dict]) -> str | None:
    """Extract project context from conversation and save to DB. Returns the context."""
    context = await extract_context(history)
    if context:
        await save_project_context(project_id, context)
    return context


async def run_chat(project_id: int, message: str) -> AsyncGenerator[dict, None]:
    """Async generator yielding SSE event dicts for chat streaming."""
    await save_chat_message(project_id, "user", message)
    docs = await get_documents(project_id)
    history = await get_chat_history(project_id, limit=20)
    idea = await get_project_idea(project_id) or "No idea provided."

    context = await get_project_context(project_id)
    messages = build_chat_messages(idea, docs, history, context)
    llm = make_chat_llm()

    # Stream the chat response
    full_response = ""
    async for chunk in llm.astream(messages):
        token = str(chunk.content) if chunk.content else ""
        if token:
            full_response += token
            yield {"type": "token", "content": token}

    await save_chat_message(project_id, "assistant", full_response)

    # Extract context after every turn
    updated_history = history + [{"role": "assistant", "content": full_response}]
    context = await _extract_and_save_context(project_id, updated_history)

    # Check if we should auto-generate the overview
    has_overview = any(d["agent_name"] == "Project Overview" for d in docs)
    if not has_overview and is_context_complete(context):
        yield {"type": "status", "agent": "Project Overview"}

        try:
            overview = await run_overview(idea, context)
            await save_document(project_id, "Project Overview", overview)
            yield {"type": "result", "agent": "Project Overview", "markdown": overview}
        except Exception as e:
            print(f"  [Chat] overview generation failed: {e}", flush=True)
            yield {"type": "error", "agent": "Project Overview", "error": str(e)}

    yield {"type": "done"}
