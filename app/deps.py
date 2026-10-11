"""Shared FastAPI dependencies."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator

from fastapi import Depends, HTTPException, Request

from .config import Settings
from .db import connect
from .llm import Runtime
from .services.auth import session_user
from .services.embeddings import EmbeddingWorker
from .services.models import PullManager
from .services.tools import ToolWorker

SESSION_COOKIE = "ls_session"


def settings(request: Request) -> Settings:
    return request.app.state.settings


def runtime(request: Request) -> Runtime:
    return request.app.state.runtime


def worker(request: Request) -> EmbeddingWorker:
    return request.app.state.worker


def pulls(request: Request) -> PullManager:
    return request.app.state.pulls


def tools(request: Request) -> ToolWorker:
    return request.app.state.tools


def db(request: Request) -> Iterator[sqlite3.Connection]:
    with connect(request.app.state.settings.db_path) as conn:
        yield conn


def current_user(request: Request, conn: sqlite3.Connection = Depends(db, scope="function")) -> sqlite3.Row:
    user = session_user(conn, request.cookies.get(SESSION_COOKIE))
    if user is None:
        raise HTTPException(401, "Sign in to continue.")
    return user


def admin_user(user: sqlite3.Row = Depends(current_user)) -> sqlite3.Row:
    if user["role"] != "admin":
        raise HTTPException(403, "Admins only.")
    return user


def client_ip(request: Request) -> str:
    """For the activity log: the first forwarded address behind a proxy (Modal, Vercel)."""
    fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else "")


def public_user(u: sqlite3.Row) -> dict:
    return {"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"]}
