import uuid
from datetime import datetime, timezone

from uagents import Agent, Context
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
)

TARGET_AGENT = "agent1qgs7f3r5ge7vaslvlu0ss3mt26tzz5jv2xgfcle4nxmru6j0gkzdg7eg4yk"

client = Agent(
    name="docgenix_test_client",
    seed="test_seed_phrase_docgenix_123",
    port=8001,
    endpoint=["http://127.0.0.1:8001/submit"],
)


@client.on_event("startup")
async def send_test_message(ctx: Context):
    print(f"[Test] Sending ChatMessage to DocGenix at {TARGET_AGENT}")
    msg = ChatMessage(
        msg_id=uuid.uuid4(),
        timestamp=datetime.now(timezone.utc),
        content=[TextContent(type="text", text="I want to build a todo app")],
    )
    await ctx.send(TARGET_AGENT, msg)


@client.on_message(ChatMessage)
async def handle_reply(ctx: Context, sender: str, msg: ChatMessage):
    text = " ".join(b.text for b in msg.content if isinstance(b, TextContent))
    print(f"[Test] DocGenix replied: {text}")
    # Acknowledge
    await ctx.send(sender, ChatAcknowledgement(
        timestamp=msg.timestamp, acknowledged_msg_id=msg.msg_id
    ))


@client.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    print(f"[Test] Ack received for msg {msg.acknowledged_msg_id}")


if __name__ == "__main__":
    print("[Test] Starting...")
    client.run()
