import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from routes.chat import router as chat_router
from routes.generation import router as generation_router
from routes.projects import router as projects_router
from fastapi.middleware.cors import CORSMiddleware
from models.database import init_db
from utils.doc_agents import make_doc_agents
from agents.critic import make_agent as make_critic


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    app.state.doc_agents = make_doc_agents()
    app.state.critic_agent = make_critic()
    print("  [Startup] All agents initialized", flush=True)
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(chat_router)
app.include_router(generation_router)
app.include_router(projects_router)

_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
_origins = [o.strip() for o in _raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return ("hello","world")