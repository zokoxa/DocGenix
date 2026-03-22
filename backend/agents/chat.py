"""
Chat agent — handles the conversational interview / refinement flow.
Also provides context extraction and readiness checking.
"""

from langchain_ollama import ChatOllama
from langchain_core.tools import tool
from ddgs import DDGS

from agents.base import OLLAMA_BASE_URL, _ollama_kwargs
from agents.project_overview import make_agent as make_overview_agent

CHAT_MODEL = "qwen3.5:latest"
EXTRACT_MODEL = "llama3.2:3b"
REQUIRED_FIELDS = ["project_name", "platform", "features", "tech_stack", "audience"]

CHAT_SYSTEM_PROMPT = """You are a helpful assistant for a software project planning tool.

## Rules
- NEVER invent, assume, or hallucinate details the user has not stated. Only reference what the user has actually said.
- Ask 1 question at a time.
- ONLY ASK QUESTIONS.
- FOCUS on gathering details about these fields: project name, platform, features, tech stack, audience.
- DO NOT OFFER TO GENERATE DOCUMENTS OR CODE.
- KEEP RESPONSES SHORT AND CONCISE.
- You have a web_search tool. Use it when the user asks about technologies, frameworks, or best practices.
- When the user asks to change or update any field (name, features, tech stack, etc.), acknowledge the change and confirm the new value.

## Already Gathered Context
{context}

## Your Role
When the project is new and has few or no documents, interview the user to gather details about these fields:
1. Project name
2. Target platform (web, mobile, desktop)
3. Key features
4. Tech stack preferences
5. Target audience

IMPORTANT: If a field in "Already Gathered Context" above is already known (not "unknown"), do NOT ask about it again. Only ask about fields that are still "unknown". If all fields are known, skip the interview entirely and help the user refine their project or answer questions.

When documents have already been generated, help the user understand and refine them.

## Project Idea
{idea}

## Project Documents
{documents}
"""

EXTRACT_PROMPT = """Review this conversation about a software project and extract the most up-to-date confirmed project details.

CRITICAL RULES:
- Only include details the user has explicitly stated. Use "unknown" for any topic not yet discussed.
- If the user has UPDATED or CORRECTED a field during the conversation, use the LATEST value — not the original.
- If the user says "change X to Y" or "actually it's Y" or "rename it to Y", the new value is Y.

You MUST respond in EXACTLY this format (keep the labels, replace the values):

project_name: <the project name, or unknown>
platform: <web, mobile, desktop, or unknown>
features: <comma-separated list of features, or unknown>
tech_stack: <languages/frameworks mentioned, or unknown>
audience: <target users, or unknown>

Conversation:
{conversation}

Extracted details:"""


@tool
def web_search(query: str) -> str:
    """Search the web for up-to-date information about technologies, frameworks, or best practices."""
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=4))
        if not results:
            return "No results found."
        return "\n\n".join(
            f"**{r['title']}**\n{r['body']}" for r in results
        )
    except Exception as e:
        return f"Search failed: {e}"


TOOLS = [web_search]


_DOC_SNIPPET_CHARS = 800  # characters per document kept in the system prompt


def build_chat_messages(
    idea: str, documents: list[dict], history: list[dict], context: str | None = None
) -> list[dict]:
    """Assemble the full message list for the chat LLM."""
    # Truncate each document to avoid bloating the context window.
    # The chat LLM only needs enough to answer questions — not the full text.
    snippets = []
    for d in documents:
        md = d["markdown"]
        snippet = md[:_DOC_SNIPPET_CHARS] + ("…" if len(md) > _DOC_SNIPPET_CHARS else "")
        snippets.append(f"### {d['agent_name']}\n{snippet}")
    doc_context = "\n\n---\n\n".join(snippets)
    system_prompt = CHAT_SYSTEM_PROMPT.format(
        idea=idea,
        documents=doc_context or "No documents generated yet.",
        context=context or "No context gathered yet.",
    )
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})

    # Re-inject a compact rule reminder as the last system turn so it stays
    # near the top of the model's attention even with long conversation history.
    rule_reminder = (
        "[REMINDER] Rules: Ask only 1 question at a time. "
        "Never invent project details. "
        "Do not offer to generate documents or code. "
        "Keep responses short. "
        "If the user updates a field (name, features, tech stack, etc.), acknowledge the new value."
    )
    messages.append({"role": "system", "content": rule_reminder})
    return messages


def make_chat_llm() -> ChatOllama:
    """Return the ChatOllama instance with tools bound."""
    return ChatOllama(**_ollama_kwargs(CHAT_MODEL)).bind_tools(TOOLS)


def make_chat_llm_plain() -> ChatOllama:
    """Return the ChatOllama instance without tools (for streaming final response)."""
    return ChatOllama(**_ollama_kwargs(CHAT_MODEL))


async def run_tool_calls(response) -> list[dict]:
    """Execute any tool calls in the response and return tool result messages."""
    tool_map = {t.name: t for t in TOOLS}
    result_messages = []

    for tool_call in response.tool_calls:
        name = tool_call["name"]
        args = tool_call["args"]
        print(f"  [Chat] tool call: {name}({args})", flush=True)

        if name in tool_map:
            try:
                result = await tool_map[name].ainvoke(args)
            except Exception as e:
                result = f"Tool error: {e}"
        else:
            result = f"Unknown tool: {name}"

        result_messages.append({
            "role": "tool",
            "name": name,
            "tool_call_id": tool_call["id"],
            "content": str(result),
        })

    return result_messages


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
