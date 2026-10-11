"""Personal desks: a teacher's own Teacher's Desk on their Mac uses this school's models.

    POST /api/auth/device        email + password → a key for this Mac (shown once)
    GET  /api/relay/health       ┐
    GET  /api/relay/models       │  Authorization: Bearer <key>
    POST /api/relay/chat         │  Model calls only, through this server's runtime and
    POST /api/relay/embed        │  its generation slots. The runtime's own address and
    POST /api/relay/transcribe   ┘  token never leave this server; nothing is stored here.
    GET/DELETE /api/admin/devices   admins see and remove Macs

The Mac app's "Keep my data on this Mac" calls /api/auth/device with the teacher's school
sign-in, then sets up its local server with RUNTIME_KIND=relay pointing here.
"""

from __future__ import annotations

import sqlite3
import tempfile
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import deps
from ..config import Settings
from ..llm import Runtime
from ..llm.base import ChatMessage, RuntimeError_, RuntimeUnavailable
from ..services import activity, auth, devices
from .auth import log_failed_sign_in
from .install import _base

router = APIRouter(tags=["relay"])
MAX_AUDIO = 200 * 1024 * 1024  # one meeting recording, as uploaded on the Mac


class DeviceIn(BaseModel):
    email: str
    password: str
    label: str = ""


@router.post("/api/auth/device")
def create_device(
    body: DeviceIn,
    request: Request,
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
    settings: Settings = Depends(deps.settings),
    runtime: Runtime = Depends(deps.runtime),
):
    if settings.local_mode:
        raise HTTPException(400, "This is already a personal desk.")
    user = auth.authenticate(db, body.email, body.password)
    if user is None:
        log_failed_sign_in(settings, body.email, deps.client_ip(request))
        raise HTTPException(401, "That email and password didn't work.")
    return device_bundle(db, request, settings, runtime, user, body.label)


def device_bundle(db: sqlite3.Connection, request: Request, settings: Settings, runtime: Runtime,
                  user: sqlite3.Row, label: str) -> dict:
    """A new key for this Mac plus what its personal desk needs (also used after Google /
    Microsoft sign-in: app/routes/sso.py)."""
    key = devices.create_key(db, user["id"], label or "Mac")
    activity.log(db, user, "mac_added", detail=label or "Mac", ip=deps.client_ip(request))
    return {
        "key": key,
        "relay_url": f"{_base(request, settings)}/api/relay",
        "school": settings.school_name,
        "name": user["name"],
        "email": user["email"],
        "chat_model": runtime.active_model("chat"),
        "embed_model": runtime.active_model("embed"),
    }


def device_user(request: Request, db: sqlite3.Connection = Depends(deps.db, scope="function")) -> sqlite3.Row:
    header = request.headers.get("authorization", "")
    key = header[7:].strip() if header.lower().startswith("bearer ") else ""
    user = devices.user_for_key(db, key) if key else None
    if user is None:
        raise HTTPException(401, "Your school removed this Mac's access to its AI. Ask your administrator.")
    return user


def _runtime_error(e: RuntimeError_) -> HTTPException:
    return HTTPException(503 if isinstance(e, RuntimeUnavailable) else 502, str(e))


@router.get("/api/relay/health")
async def relay_health(_: sqlite3.Row = Depends(device_user), runtime: Runtime = Depends(deps.runtime)):
    return asdict(await (await runtime.provider()).health())


@router.get("/api/relay/models")
async def relay_models(_: sqlite3.Row = Depends(device_user), runtime: Runtime = Depends(deps.runtime)):
    try:
        return {"models": [asdict(m) for m in await (await runtime.provider()).list_models()]}
    except RuntimeError_ as e:
        raise _runtime_error(e) from e


class EmbedIn(BaseModel):
    model: str
    texts: list[str] = Field(max_length=512)


@router.post("/api/relay/embed")
async def relay_embed(body: EmbedIn, _: sqlite3.Row = Depends(device_user), runtime: Runtime = Depends(deps.runtime)):
    try:
        return {"vectors": await (await runtime.provider()).embed(body.model, body.texts)}
    except RuntimeError_ as e:
        raise _runtime_error(e) from e


class MessageIn(BaseModel):
    role: str
    content: str


class ChatIn(BaseModel):
    model: str
    messages: list[MessageIn] = Field(max_length=200)
    temperature: float = 0.2
    json_schema: dict | None = None


@router.post("/api/relay/chat")
async def relay_chat(body: ChatIn, _: sqlite3.Row = Depends(device_user), runtime: Runtime = Depends(deps.runtime)):
    if any(m.role not in ("system", "user", "assistant") for m in body.messages):
        raise HTTPException(422, "unknown message role")
    messages = [ChatMessage(m.role, m.content) for m in body.messages]  # type: ignore[arg-type]
    await runtime.generation_slots.acquire()  # shared with this school's own teachers
    try:
        stream = (await runtime.provider()).chat(body.model, messages, temperature=body.temperature,
                                                 json_schema=body.json_schema)
        first = await anext(stream, "")  # fail before the response starts, with a real status
    except RuntimeError_ as e:
        runtime.generation_slots.release()
        raise _runtime_error(e) from e
    except BaseException:
        runtime.generation_slots.release()
        raise

    async def rest():
        try:
            if first:
                yield first
            async for part in stream:
                yield part
        finally:
            runtime.generation_slots.release()

    return StreamingResponse(rest(), media_type="text/plain; charset=utf-8")


@router.post("/api/relay/transcribe")
async def relay_transcribe(
    file: UploadFile = File(...),
    language: str = Form(""),
    prompt: str = Form(""),
    _: sqlite3.Row = Depends(device_user),
    runtime: Runtime = Depends(deps.runtime),
):
    with tempfile.TemporaryDirectory() as tmp:  # deleted as soon as it's transcribed
        path = Path(tmp) / "audio"
        size = 0
        with path.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_AUDIO:
                    raise HTTPException(413, "That recording is too long.")
                out.write(chunk)
        try:
            segments = await (await runtime.provider()).transcribe(path, language=language or None, prompt=prompt)
        except RuntimeError_ as e:
            raise _runtime_error(e) from e
    return {"segments": [asdict(s) for s in segments]}


@router.get("/api/admin/devices")
def list_devices(_: sqlite3.Row = Depends(deps.admin_user), db: sqlite3.Connection = Depends(deps.db, scope="function")):
    return {"devices": devices.list_devices(db)}


@router.delete("/api/admin/devices/{device_id}")
def remove_device(device_id: int, me: sqlite3.Row = Depends(deps.admin_user),
                  db: sqlite3.Connection = Depends(deps.db, scope="function")):
    row = db.execute("SELECT d.label, u.name FROM device_keys d JOIN users u ON u.id = d.user_id WHERE d.id = ?",
                     (device_id,)).fetchone()
    if not row or not devices.delete_device(db, device_id):
        raise HTTPException(404, "Not found")
    activity.log(db, me, "mac_removed", subject=row["name"], detail=row["label"])
    return {"ok": True}
