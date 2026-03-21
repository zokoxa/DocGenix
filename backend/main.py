from contextlib import asynccontextmanager
from fastapi import FastAPI
from routes.chat import router as chat_router
from routes.generation import router as generation_router
from fastapi.middleware.cors import CORSMiddleware
from models.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(chat_router)
app.include_router(generation_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return ("hello","world")