"""
Chat agent — handles the conversational interview / refinement flow.
Also provides context extraction and readiness checking.
"""

from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from ddgs import DDGS

from agents.base import MODEL, _asi1_kwargs
from agents.project_overview import make_agent as make_overview_agent

CHAT_MODEL = MODEL
EXTRACT_MODEL = MODEL
REQUIRED_FIELDS = ["project_name", "platform", "features", "tech_stack", "audience"]

CHAT_SYSTEM_PROMPT = """You are DocGenix, a friendly assistant that helps users plan software projects.

Your only job is to chat with the user and gather their project details. The actual documentation is generated automatically by specialized agents — you must NEVER write documentation, specs, schemas, plans, or code yourself.

Rules:
- Keep every response to 1-3 short sentences maximum.
- Use plain text only. No markdown, no tables, no bullet lists, no emoji, no LaTeX, no ASCII art.
- Ask one question at a time to learn about: project name, platform, key features, tech stack, and target audience.
- If the user volunteers multiple details at once, acknowledge them and ask about whatever is still missing.
- You may offer brief opinions or suggestions if asked, but stay conversational.
- Never generate documentation, code, schemas, or implementation plans — just say the doc agents will handle that.

Current project documents (for reference only):
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
    snippets = []
    for d in documents:
        md = d["markdown"]
        snippet = md[:_DOC_SNIPPET_CHARS] + ("…" if len(md) > _DOC_SNIPPET_CHARS else "")
        snippets.append(f"{d['agent_name']}\n{snippet}")
    doc_context = "\n\n---\n\n".join(snippets)
    system_prompt = CHAT_SYSTEM_PROMPT.format(
        documents=doc_context or "No documents generated yet.",
    )
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "system", "content": (
        "Reminder: Reply in plain text only, 1-3 sentences max. "
        "Do NOT generate any documentation, code, schemas, or plans. "
        "Just chat and gather project details."
    )})
    return messages


def make_chat_llm() -> ChatOpenAI:
    """Return the ChatOpenAI instance with tools bound."""
    return ChatOpenAI(**_asi1_kwargs(CHAT_MODEL)).bind_tools(TOOLS)


def make_chat_llm_plain() -> ChatOpenAI:
    """Return the ChatOpenAI instance without tools (for streaming final response)."""
    return ChatOpenAI(**_asi1_kwargs(CHAT_MODEL))


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

    llm = ChatOpenAI(**_asi1_kwargs(EXTRACT_MODEL))
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
