"""
Chat agent — handles the conversational interview / refinement flow.
Also provides context extraction and readiness checking.
"""

from langchain_ollama import ChatOllama

from agents.base import OLLAMA_BASE_URL, _ollama_kwargs
from agents.project_overview import make_agent as make_overview_agent

CHAT_MODEL = "llama3.2:3b"
EXTRACT_MODEL = "llama3.2:3b"
REQUIRED_FIELDS = ["platform", "features", "tech_stack", "audience"]

CHAT_SYSTEM_PROMPT = """You are a helpful assistant for a software project planning tool.

## Rules
- Keep it short and concise, and use bullet points.
- NEVER invent, assume, or hallucinate details the user has not stated. Only reference what the user has actually said.
- Ask 1-2 short questions at a time. Do NOT list many questions at once.
- Keep responses brief (3-5 sentences max).
- Do NOT name or brand the project unless the user has.
- Do NOT make assumptions about the tech stack or target audience unless the user has explicitly stated them.
- NEVER small talk. Focus only on gathering project details and refining the idea.

## Already Gathered Context
{context}

## Your Role
When the project is new and has few or no documents, interview the user to gather details about these fields:
1. Target platform (web, mobile, desktop)
2. Key features
3. Tech stack preferences
4. Target audience

IMPORTANT: If a field in "Already Gathered Context" above is already known (not "unknown"), do NOT ask about it again. Only ask about fields that are still "unknown". If all fields are known, skip the interview entirely and help the user refine their project or answer questions.

When documents have already been generated, help the user understand and refine them.

## Project Idea
{idea}

## Project Documents
{documents}
"""

EXTRACT_PROMPT = """Review this conversation about a software project and extract confirmed project details.

IMPORTANT: Only include details the user has explicitly stated. Use "unknown" for any topic not yet discussed.

You MUST respond in EXACTLY this format (keep the labels, replace the values):

platform: <web, mobile, desktop, or unknown>
features: <comma-separated list of features, or unknown>
tech_stack: <languages/frameworks mentioned, or unknown>
audience: <target users, or unknown>

Conversation:
{conversation}

Extracted details:"""


def build_chat_messages(
    idea: str, documents: list[dict], history: list[dict], context: str | None = None
) -> list[dict]:
    """Assemble the full message list for the chat LLM."""
    doc_context = "\n\n---\n\n".join(
        f"### {d['agent_name']}\n{d['markdown']}" for d in documents
    )
    system_prompt = CHAT_SYSTEM_PROMPT.format(
        idea=idea,
        documents=doc_context or "No documents generated yet.",
        context=context or "No context gathered yet.",
    )
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    return messages


def make_chat_llm() -> ChatOllama:
    """Return the ChatOllama instance for conversation."""
    return ChatOllama(**_ollama_kwargs(CHAT_MODEL))


def parse_context(raw: str) -> dict[str, str]:
    """Parse the structured context string into a dict."""
    result = {}
    for line in raw.strip().splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            key = key.strip().lower().replace(" ", "_")
            value = value.strip()
            if key in REQUIRED_FIELDS:
                result[key] = value
    return result


def is_context_complete(context: str | None) -> bool:
    """Check if all required fields have been gathered (none are 'unknown')."""
    if not context:
        return False
    parsed = parse_context(context)
    for field in REQUIRED_FIELDS:
        value = parsed.get(field, "unknown")
        if value.lower() == "unknown" or not value:
            return False
    return True


async def extract_context(history: list[dict]) -> str | None:
    """Use a lightweight LLM call to distill project context from chat history."""
    if not history:
        return None

    conversation = "\n".join(
        f"{msg['role'].upper()}: {msg['content']}" for msg in history
    )
    prompt = EXTRACT_PROMPT.format(conversation=conversation)

    llm = ChatOllama(**_ollama_kwargs(EXTRACT_MODEL))
    result = await llm.ainvoke([{"role": "user", "content": prompt}])
    context = str(result.content).strip()
    return context or None


async def run_overview(idea: str, context: str) -> str:
    """Run the Project Overview agent with the gathered context."""
    print("  [Chat] auto-triggering Project Overview generation...", flush=True)
    agent = make_overview_agent()
    prompt = (
        "Produce your documentation artifact for this software project idea:\n"
        f"{idea}\n\n"
        f"## Project Details (from user interview)\n{context}\n\n"
        "Follow your instructions exactly and return only your document."
    )
    return await agent.run(prompt)
