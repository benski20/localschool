from __future__ import annotations

import mimetypes
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import deps
from ..config import Settings
from ..llm import Runtime
from ..services import embeddings, ingest
from ..services.embeddings import EmbeddingWorker

router = APIRouter(prefix="/api/documents", tags=["library"])
MAX_UPLOAD = 25 * 1024 * 1024


def _doc_rows(db: sqlite3.Connection, embed_model: str) -> list[dict]:
    space = embeddings.get_space(db, embed_model)
    rows = db.execute(
        "SELECT d.id, d.title, d.filename, d.mime, d.size, d.status, d.error, d.pages, d.created_at, "
        "u.name AS owner_name, d.owner_id, "
        "(SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id) AS chunk_count, "
        "(SELECT COUNT(*) FROM chunks c JOIN chunk_vectors v ON v.chunk_id = c.id "
        " WHERE c.document_id = d.id AND v.space_id = ?) AS embedded_count "
        "FROM documents d LEFT JOIN users u ON u.id = d.owner_id ORDER BY d.created_at DESC, d.id DESC",
        (space["id"] if space else -1,),
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("")
def list_documents(
    _: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db),
    runtime: Runtime = Depends(deps.runtime),
):
    model = runtime.active_model("embed")
    return {
        "documents": _doc_rows(db, model),
        "index": embeddings.index_status(db, model).as_dict(),
    }


@router.post("")
async def upload(
    files: list[UploadFile] = File(...),
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db),
    settings: Settings = Depends(deps.settings),
    worker: EmbeddingWorker = Depends(deps.worker),
):
    created, errors = [], []
    for f in files:
        data = await f.read()
        name = Path(f.filename or "document.txt").name
        if len(data) > MAX_UPLOAD:
            errors.append({"filename": name, "error": "File is larger than 25 MB."})
            continue
        try:
            doc_id = ingest.store_document(
                db, title=Path(name).stem.replace("_", " ").replace("-", " ").strip(), filename=name,
                mime=f.content_type or "", data=data, owner_id=user["id"], files_dir=settings.files_dir,
            )
            created.append(doc_id)
        except ingest.IngestError as e:
            errors.append({"filename": name, "error": str(e)})
    db.commit()
    if created:
        worker.kick()
    return {"created": created, "errors": errors}


class PasteIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=2_000_000)


@router.post("/text")
def paste(
    body: PasteIn,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db),
    settings: Settings = Depends(deps.settings),
    worker: EmbeddingWorker = Depends(deps.worker),
):
    try:
        doc_id = ingest.store_document(
            db, title=body.title, filename=f"{body.title[:60].strip() or 'pasted'}.md", mime="text/markdown",
            data=body.text.encode(), owner_id=user["id"], files_dir=settings.files_dir,
        )
    except ingest.IngestError as e:
        raise HTTPException(400, str(e)) from e
    db.commit()
    worker.kick()
    return {"id": doc_id}


@router.delete("/{doc_id}")
def delete(
    doc_id: int,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db),
    settings: Settings = Depends(deps.settings),
):
    row = db.execute("SELECT owner_id FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Document not found.")
    if user["role"] != "admin" and row["owner_id"] != user["id"]:
        raise HTTPException(403, "Only the uploader or an admin can delete this document.")
    ingest.delete_document(db, doc_id, settings.files_dir)
    return {"ok": True}


@router.get("/{doc_id}/file")
def download(
    doc_id: int,
    _: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db),
    settings: Settings = Depends(deps.settings),
):
    row = db.execute("SELECT filename FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Document not found.")
    path = settings.files_dir / f"{doc_id}{Path(row['filename']).suffix.lower()}"
    if not path.exists():
        raise HTTPException(404, "File missing.")
    return FileResponse(path, filename=row["filename"],
                        media_type=mimetypes.guess_type(row["filename"])[0] or "application/octet-stream")


@router.get("/{doc_id}/chunks/{chunk_id}")
def chunk(
    doc_id: int,
    chunk_id: int,
    _: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db),
):
    """A cited passage with its neighbours, for the source panel."""
    row = db.execute(
        "SELECT c.*, d.title FROM chunks c JOIN documents d ON d.id = c.document_id "
        "WHERE c.id = ? AND c.document_id = ?",
        (chunk_id, doc_id),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Passage not found (the document may have been removed).")
    around = db.execute(
        "SELECT id, ord, page, heading, text FROM chunks WHERE document_id = ? AND ord BETWEEN ? AND ? ORDER BY ord",
        (doc_id, row["ord"] - 1, row["ord"] + 1),
    ).fetchall()
    return {
        "document": {"id": doc_id, "title": row["title"]},
        "chunk_id": chunk_id,
        "passages": [{**dict(r), "cited": r["id"] == chunk_id} for r in around],
    }
