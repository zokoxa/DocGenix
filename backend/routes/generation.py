from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from models.schemas import GenerateRequest
from services.generation import run_generation
from utils.sse import sse_frame

router = APIRouter()


@router.post("/generate")
async def generate(body: GenerateRequest, request: Request):
    doc_agents = request.app.state.doc_agents
    critic_agent = request.app.state.critic_agent

    async def event_stream():
        async for event in run_generation(body.idea, body.agent, body.project_id, doc_agents, critic_agent):
            yield sse_frame(event)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
