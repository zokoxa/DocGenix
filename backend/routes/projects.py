import io
import zipfile

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, Response

from models.database import get_projects, get_chat_history, get_documents, get_document_by_id, create_project, delete_project, update_document_markdown

router = APIRouter()


@router.get("/projects")
async def list_projects():
    return await get_projects()


@router.post("/projects")
async def new_project(body: dict):
    project_id = await create_project(body["idea"])
    return {"project_id": project_id}


@router.delete("/projects/{project_id}")
async def remove_project(project_id: int):
    await delete_project(project_id)
    return {"ok": True}


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


@router.patch("/documents/{doc_id}")
async def patch_document(doc_id: int, body: dict):
    markdown = body.get("markdown")
    if not isinstance(markdown, str):
        raise HTTPException(status_code=400, detail="markdown field required")
    doc = await get_document_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await update_document_markdown(doc_id, markdown)
    return {"ok": True}


@router.get("/documents/{doc_id}/download/md")
async def download_document_md(doc_id: int):
    doc = await get_document_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    filename = doc["agent_name"].replace(" ", "_") + ".md"
    return Response(
        content=doc["markdown"],
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/documents/{doc_id}/download/pdf")
async def download_document_pdf(doc_id: int):
    doc = await get_document_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    import markdown as md
    from fpdf import FPDF

    html = md.markdown(doc["markdown"], extensions=["tables", "fenced_code"])

    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_font("Helvetica", size=11)
    pdf.write_html(html)

    pdf_bytes = bytes(pdf.output())
    filename = doc["agent_name"].replace(" ", "_") + ".pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
