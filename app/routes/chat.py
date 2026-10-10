from __future__ import annotations

import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import deps
from ..llm import Runtime
from ..services import chat

router = APIRouter(prefix="/api", tags=["chat"])


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    conversation_id: int | None = None


@router.post("/chat")
async def ask(
    body: AskIn,
    user: sqlite3.Row = Depends(deps.current_user),
    runtime: Runtime = Depends(deps.runtime),
):
    """Server-sent events: conversation → sources → [queued|status]* → token* → done|error."""

    async def events():
        async for evt in chat.answer(runtime, user, body.question, body.conversation_id):
            yield f"data: {json.dumps(evt)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/conversations")
def conversations(user: sqlite3.Row = Depends(deps.current_user), db: sqlite3.Connection = Depends(deps.db, scope="function")):
    rows = db.execute(
        "SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 50",
        (user["id"],),
    ).fetchall()
    return {"conversations": [dict(r) for r in rows]}


@router.get("/conversations/{conversation_id}")
def conversation(
    conversation_id: int,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
):
    conv = db.execute(
        "SELECT id, title, updated_at FROM conversations WHERE id = ? AND user_id = ?",
        (conversation_id, user["id"]),
    ).fetchone()
    if not conv:
        raise HTTPException(404, "Conversation not found.")
    msgs = db.execute(
        "SELECT id, role, content, sources_json, model, created_at FROM messages "
        "WHERE conversation_id = ? ORDER BY id",
        (conversation_id,),
    ).fetchall()
    return {
        "conversation": dict(conv),
        "messages": [
            {**{k: m[k] for k in ("id", "role", "content", "model", "created_at")},
             "sources": json.loads(m["sources_json"])}
            for m in msgs
        ],
    }


@router.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: int,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
):
    n = db.execute(
        "DELETE FROM conversations WHERE id = ? AND user_id = ?", (conversation_id, user["id"])
    ).rowcount
    if not n:
        raise HTTPException(404, "Conversation not found.")
    return {"ok": True}
