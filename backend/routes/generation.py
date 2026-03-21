from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from models.schemas import GenerateRequest
from services.generation import run_generation
from utils.sse import sse_frame

router = APIRouter()


@router.post("/generate")
async def generate(body: GenerateRequest):
    async def event_stream():
        async for event in run_generation(body.idea, body.agent, body.project_id):
            yield sse_frame(event)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
