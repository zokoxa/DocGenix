"""
DocGenix AgentVerse Agent
Full pipeline: chat interview → doc generation (8 agents) → critic review loop.
Run on the host machine (outside Docker) for AgentVerse connectivity.
"""

import asyncio
import os
import re
import uuid
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
    chat_protocol_spec,
)

# ---------------------------------------------------------------------------
# Agent setup
# ---------------------------------------------------------------------------

SEED = os.environ["AGENT_SEED"]
AGENTVERSE_API_KEY = os.environ["AGENTVERSE_API_KEY"]

agent = Agent(
    name="DocGenix",
    seed=SEED,
    mailbox=True,
    agentverse={
        "base_url": "https://agentverse.ai",
        "api_key": AGENTVERSE_API_KEY,
    },
    publish_agent_details=True,
)

print(f"DocGenix agent address: {agent.address}", flush=True)

# ---------------------------------------------------------------------------
# DocGenix imports
# ---------------------------------------------------------------------------

from agents.chat import (
    build_chat_messages,
    make_chat_llm,
    make_chat_llm_plain,
    run_tool_calls,
    parse_context,
    REQUIRED_FIELDS,
)
from agents.critic import make_agent as make_critic
from utils.doc_agents import make_doc_agents_core as make_doc_agents
from services.generation import (
    _build_prompt,
    _build_critic_prompt,
    _build_revision_prompt,
    _parse_critic_feedback,
)

# ---------------------------------------------------------------------------
# Per-session state
# ---------------------------------------------------------------------------

_sessions: dict[str, dict] = {}
# session keys: history, context, docs, generated

GENERATE_TRIGGERS = re.compile(
    r"\b(generate|create|run|make|produce|write)\b.*(doc|document|spec|overview|architecture|requirement)",
    re.IGNORECASE,
)


def _get_session(sender: str) -> dict:
    if sender not in _sessions:
        _sessions[sender] = {
            "history": [],
            "context": None,
            "docs": {},       # agent_name -> markdown
            "generated": False,
        }
    return _sessions[sender]


# ---------------------------------------------------------------------------
# Chat helper
# ---------------------------------------------------------------------------

def _context_from_history(history: list[dict]) -> str:
    """Build a simple context summary by scanning the conversation for known fields."""
    full_text = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in history)
    # Provide a minimal context string so the system prompt at least shows something
    return f"conversation so far:\n{full_text[-2000:]}"


def _is_complete_from_history(history: list[dict]) -> bool:
    """Check whether all 5 required fields appear to have been provided by scanning history."""
    if len(history) < 10:  # need at least 5 user answers
        return False
    user_turns = [m["content"] for m in history if m["role"] == "user"]
    # We need at least 5 non-trivial user answers
    return len([t for t in user_turns if len(t.strip()) > 2]) >= 5


async def _run_chat(session: dict, user_message: str) -> str:
    history = session["history"]
    docs_list = [{"agent_name": k, "markdown": v} for k, v in session["docs"].items()]

    # Build context directly from history (no extra LLM call)
    context = _context_from_history(history) if history else None

    messages = build_chat_messages(idea="", documents=docs_list, history=history, context=context)
    messages.append({"role": "user", "content": user_message})

    llm_with_tools = make_chat_llm()
    response = await llm_with_tools.ainvoke(messages)

    if hasattr(response, "tool_calls") and response.tool_calls:
        tool_results = await run_tool_calls(response)
        messages = messages + [response] + tool_results

    llm = make_chat_llm_plain()
    result = await llm.ainvoke(messages)
    full_response = str(result.content)

    clean = re.sub(r"<think>.*?</think>", "", full_response, flags=re.DOTALL)
    clean = re.sub(r"</?think>", "", clean).strip()

    session["history"] = (history + [
        {"role": "user", "content": user_message},
        {"role": "assistant", "content": clean},
    ])[-40:]

    # Store plain text context for generation prompt
    session["context"] = "\n".join(
        f"{m['role'].upper()}: {m['content']}" for m in session["history"]
    )
    return clean


# ---------------------------------------------------------------------------
# Generation pipeline (8 doc agents + critic loop)
# ---------------------------------------------------------------------------

MAX_ITERATIONS = 2


async def _run_all_agents(session: dict) -> str:
    """Run all 8 doc agents + critic. Returns a markdown summary."""
    context = session["context"]
    parsed = parse_context(context or "")
    idea = (
        f"Project: {parsed.get('project_name', 'Unnamed')}\n"
        f"Platform: {parsed.get('platform', 'unknown')}\n"
        f"Features: {parsed.get('features', 'unknown')}\n"
        f"Tech stack: {parsed.get('tech_stack', 'unknown')}\n"
        f"Audience: {parsed.get('audience', 'unknown')}"
    )
    prompt = _build_prompt(idea, context)

    doc_agents = make_doc_agents()
    critic = make_critic()
    current_docs: dict[str, str] = {}

    # ── Round 1: initial generation (parallel) ──
    async def _run_one(a) -> tuple[str, str]:
        try:
            md = await a.run(prompt)
            return a.name, md
        except Exception as e:
            return a.name, f"*Error generating {a.name}: {e}*"

    results = await asyncio.gather(*[_run_one(a) for a in doc_agents])
    for name, md in results:
        current_docs[name] = md
    session["docs"] = dict(current_docs)

    # ── Critic loop ──
    agent_map = {a.name: a for a in doc_agents}
    approved: set[str] = set()

    for iteration in range(MAX_ITERATIONS):
        pending = [a for a in doc_agents if a.name not in approved]
        if not pending:
            break

        critic_prompt = _build_critic_prompt(idea, context, current_docs)
        review = await critic.run(critic_prompt)
        feedback_map = _parse_critic_feedback(review)

        needs_revision = []
        for a in pending:
            status = feedback_map.get(a.name, {}).get("status", "APPROVED")
            if status == "NEEDS_REVISION":
                needs_revision.append(a)
            else:
                approved.add(a.name)

        if not needs_revision:
            break

        rev_results = await asyncio.gather(*[
            _run_one_revision(a, idea, context, current_docs, feedback_map)
            for a in needs_revision
        ])
        for name, md in rev_results:
            current_docs[name] = md
        session["docs"] = dict(current_docs)

    # ── Format summary ──
    lines = ["DOCGENIX — DOCUMENTATION COMPLETE\n" + "=" * 35]
    for name, md in current_docs.items():
        preview = md[:300].replace("\n", " ").strip()
        if len(md) > 300:
            preview += "…"
        lines.append(f"\n{name}\n{preview}")
    lines.append(
        "\n" + "-" * 35 + "\n"
        "All 6 documents generated and reviewed by the Critic agent.\n"
        "Visit the DocGenix web app to view the full documents and 3D diagrams."
    )
    return "\n".join(lines)


async def _run_one_revision(a, idea, context, current_docs, feedback_map) -> tuple[str, str]:
    fb = feedback_map[a.name]["feedback"]
    rev_prompt = _build_revision_prompt(idea, context, current_docs.get(a.name, ""), fb)
    try:
        md = await a.run(rev_prompt)
        return a.name, md
    except Exception as e:
        return a.name, current_docs.get(a.name, f"*Revision error: {e}*")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_reply(text: str) -> ChatMessage:
    return ChatMessage(
        msg_id=uuid.uuid4(),
        timestamp=datetime.now(timezone.utc),
        content=[TextContent(type="text", text=text)],
    )


# ---------------------------------------------------------------------------
# Chat Protocol
# ---------------------------------------------------------------------------

chat_proto = Protocol(spec=chat_protocol_spec)


@chat_proto.on_message(ChatMessage)
async def handle_chat_message(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(
        timestamp=msg.timestamp, acknowledged_msg_id=msg.msg_id
    ))

    user_text = " ".join(
        block.text for block in msg.content if isinstance(block, TextContent)
    )
    ctx.logger.info(f"[DocGenix] {sender}: {user_text[:80]}")

    try:
        session = _get_session(sender)

        wants_generate = bool(GENERATE_TRIGGERS.search(user_text))
        ctx.logger.info(f"[DocGenix] running chat...")
        chat_reply = await _run_chat(session, user_text)
        ctx.logger.info(f"[DocGenix] chat reply ready: {chat_reply[:60]}")

        context_ready = _is_complete_from_history(session["history"])
        should_generate = (wants_generate or context_ready) and not session["generated"]

        if should_generate:
            ctx.logger.info(f"[DocGenix] sending generation notice...")
            await asyncio.wait_for(ctx.send(sender, _make_reply(
                chat_reply + "\n\n*Context gathered! Running all 6 documentation agents + Critic review. This may take a minute…*"
            )), timeout=15)
            session["generated"] = True
            try:
                summary = await _run_all_agents(session)
                await asyncio.wait_for(ctx.send(sender, _make_reply(summary)), timeout=15)
            except Exception as e:
                ctx.logger.error(f"[DocGenix] generation error: {e}")
                await asyncio.wait_for(ctx.send(sender, _make_reply(f"Sorry, I hit an error during document generation: {e}")), timeout=15)
        else:
            ctx.logger.info(f"[DocGenix] sending reply to {sender}...")
            await asyncio.wait_for(ctx.send(sender, _make_reply(chat_reply)), timeout=15)
            ctx.logger.info(f"[DocGenix] reply sent.")

    except asyncio.TimeoutError:
        ctx.logger.error(f"[DocGenix] ctx.send() timed out for {sender}")
    except Exception as e:
        ctx.logger.error(f"[DocGenix] unhandled error: {e}", exc_info=True)
        try:
            await asyncio.wait_for(ctx.send(sender, _make_reply("Sorry, something went wrong on my end. Please try again.")), timeout=10)
        except Exception:
            pass


@chat_proto.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass  # no-op


agent.include(chat_proto, publish_manifest=True)

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    agent.run()
