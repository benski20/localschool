from __future__ import annotations

import mimetypes
import sqlite3
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import deps
from ..config import Settings
from ..llm import Runtime
from ..services import activity, embeddings, ingest
from ..services.embeddings import EmbeddingWorker
from ..services.retrieval import VISIBLE, visible_param

router = APIRouter(prefix="/api/documents", tags=["library"])
MAX_UPLOAD = 25 * 1024 * 1024
VISIBILITIES = ("school", "private")
NOT_FOUND = "Document not found."


def _doc_rows(db: sqlite3.Connection, embed_model: str, user_id: int) -> list[dict]:
    """School documents plus this user's own private ones."""
    space = embeddings.get_space(db, embed_model)
    rows = db.execute(
        "SELECT d.id, d.title, d.filename, d.mime, d.size, d.status, d.error, d.pages, d.created_at, "
        "u.name AS owner_name, d.owner_id, d.visibility, (d.owner_id IS ?) AS mine, "
        "(SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id) AS chunk_count, "
        "(SELECT COUNT(*) FROM chunks c JOIN chunk_vectors v ON v.chunk_id = c.id "
        " WHERE c.document_id = d.id AND v.space_id = ?) AS embedded_count "
        f"FROM documents d LEFT JOIN users u ON u.id = d.owner_id WHERE {VISIBLE} "
        "ORDER BY d.created_at DESC, d.id DESC",
        (user_id, space["id"] if space else -1, visible_param(user_id)),
    ).fetchall()
    return [{**dict(r), "mine": bool(r["mine"])} for r in rows]


def visible_document(db: sqlite3.Connection, doc_id: int, user: sqlite3.Row) -> sqlite3.Row | None:
    """The document if this user may see it (private documents: only their owner)."""
    return db.execute(
        f"SELECT d.* FROM documents d WHERE d.id = ? AND {VISIBLE}",
        (doc_id, visible_param(user["id"])),
    ).fetchone()


@router.get("")
def list_documents(
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
    runtime: Runtime = Depends(deps.runtime),
):
    model = runtime.active_model("embed")
    return {
        "documents": _doc_rows(db, model, user["id"]),
        "index": embeddings.index_status(db, model).as_dict(),
    }


@router.post("")
async def upload(
    files: list[UploadFile] = File(...),
    visibility: str = Form("school"),
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
    settings: Settings = Depends(deps.settings),
    worker: EmbeddingWorker = Depends(deps.worker),
):
    if visibility not in VISIBILITIES:
        raise HTTPException(400, "visibility must be 'school' or 'private'.")
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
                visibility=visibility,
            )
            created.append(doc_id)
            if visibility == "school":  # a teacher's private attachments aren't school records
                activity.log(db, user, "document_added", subject=name)
        except ingest.IngestError as e:
            errors.append({"filename": name, "error": str(e)})
    db.commit()
    if created:
        worker.kick()
    return {"created": created, "errors": errors}


class PasteIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=2_000_000)
    visibility: Literal["school", "private"] = "school"


@router.post("/text")
def paste(
    body: PasteIn,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
    settings: Settings = Depends(deps.settings),
    worker: EmbeddingWorker = Depends(deps.worker),
):
    try:
        doc_id = ingest.store_document(
            db, title=body.title, filename=f"{body.title[:60].strip() or 'pasted'}.md", mime="text/markdown",
            data=body.text.encode(), owner_id=user["id"], files_dir=settings.files_dir,
            visibility=body.visibility,
        )
    except ingest.IngestError as e:
        raise HTTPException(400, str(e)) from e
    if body.visibility == "school":
        activity.log(db, user, "document_added", subject=body.title)
    db.commit()
    worker.kick()
    return {"id": doc_id}


@router.delete("/{doc_id}")
def delete(
    doc_id: int,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
    settings: Settings = Depends(deps.settings),
):
    """The uploader or an admin. Admins can remove any document, including private ones
    (e.g. a departed teacher's); other teachers can't even see a private one exists."""
    is_admin = user["role"] == "admin"
    row = (db.execute("SELECT owner_id, title, visibility FROM documents WHERE id = ?", (doc_id,)).fetchone() if is_admin
           else visible_document(db, doc_id, user))
    if not row:
        raise HTTPException(404, NOT_FOUND)
    if not is_admin and row["owner_id"] != user["id"]:
        raise HTTPException(403, "Only the uploader or an admin can delete this document.")
    meta = db.execute("SELECT title, visibility FROM documents WHERE id = ?", (doc_id,)).fetchone()
    ingest.delete_document(db, doc_id, settings.files_dir)
    if meta and (meta["visibility"] == "school" or row["owner_id"] != user["id"]):
        activity.log(db, user, "document_deleted", subject=meta["title"])
    return {"ok": True}


@router.get("/{doc_id}/file")
def download(
    doc_id: int,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
    settings: Settings = Depends(deps.settings),
):
    row = visible_document(db, doc_id, user)
    if not row:
        raise HTTPException(404, NOT_FOUND)
    path = settings.files_dir / f"{doc_id}{Path(row['filename']).suffix.lower()}"
    if not path.exists():
        raise HTTPException(404, "File missing.")
    return FileResponse(path, filename=row["filename"],
                        media_type=mimetypes.guess_type(row["filename"])[0] or "application/octet-stream")


@router.get("/{doc_id}/preview")
def preview(
    doc_id: int,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
):
    """The first few passages, so any document (PDF, Word…) can be read in the preview sheet."""
    doc = db.execute(
        f"SELECT d.id, d.title FROM documents d WHERE d.id = ? AND {VISIBLE}",
        (doc_id, visible_param(user["id"])),
    ).fetchone()
    if not doc:
        raise HTTPException(404, "Document not found.")
    rows = db.execute(
        "SELECT heading, text FROM chunks WHERE document_id = ? ORDER BY ord LIMIT 6", (doc_id,)
    ).fetchall()
    return {"document": dict(doc), "passages": [dict(r) for r in rows]}


@router.get("/{doc_id}/chunks/{chunk_id}")
def chunk(
    doc_id: int,
    chunk_id: int,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
):
    """A cited passage with its neighbours, for the source panel."""
    row = db.execute(
        "SELECT c.*, d.title FROM chunks c JOIN documents d ON d.id = c.document_id "
        f"WHERE c.id = ? AND c.document_id = ? AND {VISIBLE}",
        (chunk_id, doc_id, visible_param(user["id"])),
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
