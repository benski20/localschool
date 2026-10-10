from __future__ import annotations

import sqlite3
from dataclasses import asdict, replace

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import deps
from ..config import Settings
from ..llm import Runtime, RuntimeConfig, RuntimeError_
from ..services import auth, embeddings
from ..services.embeddings import EmbeddingWorker
from ..services.models import PullManager, load_presets

router = APIRouter(prefix="/api", tags=["admin"])


# -- status (any signed-in user; never pings the runtime) ------------------------------

@router.get("/status")
def status(
    _: sqlite3.Row = Depends(deps.current_user),
    runtime: Runtime = Depends(deps.runtime),
    worker: EmbeddingWorker = Depends(deps.worker),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
    settings: Settings = Depends(deps.settings),
):
    cfg = runtime.config()
    models = runtime.active_models()
    return {
        "school": settings.school_name,
        "runtime": {"kind": cfg.kind, "is_local": cfg.public()["is_local"], **runtime.reachability()},
        "models": models,
        "index": {**embeddings.index_status(db, models["embed"]).as_dict(),
                  "syncing": worker.running, "error": worker.last_error},
        "queue": {"waiting": runtime.waiting},
    }


# -- runtime connection ----------------------------------------------------------------

class RuntimeIn(BaseModel):
    kind: str = "ollama"
    url: str = ""
    token: str | None = None      # None = keep the saved token
    headers: str | None = None    # None = keep the saved headers


def _merge(runtime: Runtime, body: RuntimeIn) -> RuntimeConfig:
    cur = runtime.config()
    return RuntimeConfig(
        kind=body.kind,
        url=(body.url or cur.url).strip(),
        token=cur.token if body.token is None else body.token.strip(),
        headers=cur.headers if body.headers is None else body.headers.strip(),
    )


@router.get("/admin/runtime")
async def get_runtime(_: sqlite3.Row = Depends(deps.admin_user), runtime: Runtime = Depends(deps.runtime)):
    provider = await runtime.provider()
    return {"config": runtime.config().public(), "capabilities": asdict(provider.capabilities)}


@router.put("/admin/runtime")
async def put_runtime(
    body: RuntimeIn,
    _: sqlite3.Row = Depends(deps.admin_user),
    runtime: Runtime = Depends(deps.runtime),
    worker: EmbeddingWorker = Depends(deps.worker),
):
    try:
        runtime.save_config(_merge(runtime, body))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    runtime.last_ok = None
    runtime.last_error = None
    worker.kick()
    return {"config": runtime.config().public()}


@router.post("/admin/runtime/test")
async def test_runtime(
    body: RuntimeIn | None = None,
    _: sqlite3.Row = Depends(deps.admin_user),
    runtime: Runtime = Depends(deps.runtime),
):
    """Check a connection (the saved one, or unsaved form values) — health + models."""
    try:
        cfg = _merge(runtime, body) if body else runtime.config()
        cfg.header_dict()
    except ValueError as e:
        raise HTTPException(400, f"Invalid headers: {e}") from e
    provider = runtime.build_provider(cfg)
    try:
        health = await provider.health()
        models = []
        if health.ok:
            try:
                models = [asdict(m) for m in await provider.list_models()]
            except RuntimeError_ as e:
                health = replace(health, ok=False, error=str(e))
    finally:
        await provider.aclose()
    if cfg == runtime.config():
        if health.ok:
            runtime.note_ok()
        else:
            runtime.note_error(health.error)
    return {"health": asdict(health), "models": models, "is_local": cfg.public()["is_local"]}


# -- models ------------------------------------------------------------------------------

@router.get("/admin/models")
async def models(
    _: sqlite3.Row = Depends(deps.admin_user),
    runtime: Runtime = Depends(deps.runtime),
    pulls: PullManager = Depends(deps.pulls),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
):
    provider = await runtime.provider()
    installed, error = [], ""
    try:
        installed = [asdict(m) for m in await provider.list_models()]
        runtime.note_ok()
    except RuntimeError_ as e:
        error = str(e)
        runtime.note_error(error)
    active = runtime.active_models()
    return {
        "installed": installed,
        "error": error,
        "active": active,
        "presets": load_presets(),
        "pulls": pulls.states(),
        "capabilities": asdict(provider.capabilities),
        "index": embeddings.index_status(db, active["embed"]).as_dict(),
    }


class PullIn(BaseModel):
    model: str = Field(min_length=1, max_length=200)


@router.post("/admin/models/pull")
async def pull(body: PullIn, _: sqlite3.Row = Depends(deps.admin_user), pulls: PullManager = Depends(deps.pulls)):
    try:
        return pulls.start(body.model).as_dict()
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/admin/models/pulls")
def pull_states(_: sqlite3.Row = Depends(deps.admin_user), pulls: PullManager = Depends(deps.pulls)):
    return {"pulls": pulls.states()}


class ActiveIn(BaseModel):
    role: str
    model: str = Field(min_length=1, max_length=200)


@router.put("/admin/models/active")
async def set_active(
    body: ActiveIn,
    _: sqlite3.Row = Depends(deps.admin_user),
    runtime: Runtime = Depends(deps.runtime),
    worker: EmbeddingWorker = Depends(deps.worker),
):
    provider = await runtime.provider()
    try:
        names = {m.name for m in await provider.list_models()}
    except RuntimeError_:
        names = set()  # runtime unreachable: allow setting ahead of time
    if names and body.model not in names and f"{body.model}:latest" not in names:
        raise HTTPException(400, f"'{body.model}' isn't installed on the runtime. Pull it first.")
    try:
        runtime.set_active_model(body.role, body.model)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if body.role == "embed":
        worker.kick()  # builds the new vector space in the background
    return {"active": runtime.active_models()}


@router.delete("/admin/models/{name:path}")
async def delete_model(
    name: str, _: sqlite3.Row = Depends(deps.admin_user), runtime: Runtime = Depends(deps.runtime)
):
    if name in runtime.active_models().values():
        raise HTTPException(400, "That model is in use. Pick a different active model first.")
    provider = await runtime.provider()
    try:
        await provider.delete(name)
    except RuntimeError_ as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True}


# -- users -------------------------------------------------------------------------------

class UserIn(BaseModel):
    email: str
    name: str = ""
    role: str = "teacher"
    password: str


@router.get("/admin/users")
def users(_: sqlite3.Row = Depends(deps.admin_user), db: sqlite3.Connection = Depends(deps.db, scope="function")):
    rows = db.execute(
        "SELECT u.id, u.email, u.name, u.role, u.created_at, "
        "(SELECT COUNT(*) FROM sections s WHERE s.teacher_id = u.id) AS section_count "
        "FROM users u ORDER BY u.role, u.name"
    ).fetchall()
    return {"users": [dict(r) for r in rows]}


@router.post("/admin/users")
def create_user(body: UserIn, _: sqlite3.Row = Depends(deps.admin_user), db: sqlite3.Connection = Depends(deps.db, scope="function")):
    try:
        uid = auth.create_user(db, email=body.email, name=body.name, role=body.role, password=body.password)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"id": uid}


@router.delete("/admin/users/{user_id}")
def delete_user(user_id: int, me: sqlite3.Row = Depends(deps.admin_user), db: sqlite3.Connection = Depends(deps.db, scope="function")):
    if user_id == me["id"]:
        raise HTTPException(400, "You can't remove your own account.")
    if not db.execute("DELETE FROM users WHERE id = ?", (user_id,)).rowcount:
        raise HTTPException(404, "User not found.")
    return {"ok": True}
