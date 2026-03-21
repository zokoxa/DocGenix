import io
import zipfile

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models.database import get_projects, get_chat_history, get_documents

router = APIRouter()


@router.get("/projects")
async def list_projects():
    return await get_projects()


@router.get("/projects/{project_id}/chat")
async def project_chat_history(project_id: int):
    return await get_chat_history(project_id, limit=100)


@router.get("/projects/{project_id}/documents")
async def project_documents(project_id: int):
    return await get_documents(project_id)


@router.get("/projects/{project_id}/export")
async def export_project(project_id: int):
    docs = await get_documents(project_id)
    if not docs:
        raise HTTPException(status_code=404, detail="No documents found for this project")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for doc in docs:
            filename = doc["agent_name"].replace(" ", "_").replace("/", "-") + ".md"
            zf.writestr(filename, doc["markdown"])
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=project_{project_id}_docs.zip"},
    )
