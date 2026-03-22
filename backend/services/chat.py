import asyncio
from typing import AsyncGenerator

from agents.chat import (
    build_chat_messages,
    make_chat_llm,
    make_chat_llm_plain,
    run_tool_calls,
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

    # Agentic loop: resolve any tool calls before streaming
    llm_with_tools = make_chat_llm()
    response = await llm_with_tools.ainvoke(messages)

    if hasattr(response, "tool_calls") and response.tool_calls:
        yield {"type": "status", "message": "Searching the web…"}
        tool_results = await run_tool_calls(response)
        # Append assistant tool-call message + tool results, then get final response
        messages = messages + [response] + tool_results

    llm = make_chat_llm_plain()

    # Stream the final response, suppressing <think>…</think> blocks
    import re
    full_response = ""
    in_think = False
    pending = ""

    async for chunk in llm.astream(messages):
        token = str(chunk.content) if chunk.content else ""
        if not token:
            continue
        full_response += token
        pending += token

        while pending:
            if in_think:
                end = pending.find("</think>")
                if end != -1:
                    in_think = False
                    pending = pending[end + 8:]
                else:
                    pending = ""  # still inside think block, consume
            else:
                # Strip orphan </think> tags (closing without matching open)
                pending = pending.replace("</think>", "")
                start = pending.find("<think>")
                if start != -1:
                    visible = pending[:start]
                    if visible:
                        yield {"type": "token", "content": visible}
                    in_think = True
                    pending = pending[start + 7:]
                else:
                    yield {"type": "token", "content": pending}
                    pending = ""

    clean_response = re.sub(r"</?think>", "", re.sub(r"<think>.*?</think>", "", full_response, flags=re.DOTALL)).strip()
    await save_chat_message(project_id, "assistant", clean_response)

    # Extract context after every turn
    updated_history = history + [{"role": "assistant", "content": full_response}]
    context = await _extract_and_save_context(project_id, updated_history)

    # Notify user when context is fully collected
    has_overview = any(d["agent_name"] == "Project Overview" for d in docs)
    if not has_overview and is_context_complete(context):
        yield {
            "type": "chat_message",
            "content": "I have everything I need. Click **Run All Agents** to generate your full project documentation.",
        }

    # Check if we should auto-generate the overview
    if not has_overview and is_context_complete(context):
        yield {"type": "status", "message": "Generating Project Overview…"}

        try:
            overview = await run_overview(idea, context)
            await save_document(project_id, "Project Overview", overview)
            yield {"type": "result", "agent": "Project Overview", "markdown": overview}
        except Exception as e:
            print(f"  [Chat] overview generation failed: {e}", flush=True)
            yield {"type": "error", "agent": "Project Overview", "error": str(e)}

    yield {"type": "done", "context": context}
