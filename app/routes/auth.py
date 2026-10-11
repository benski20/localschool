from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .. import deps
from ..config import Settings
from ..db import connect
from ..services import activity, auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
    settings: Settings = Depends(deps.settings),
):
    user = auth.authenticate(db, body.email, body.password)
    if user is None:
        log_failed_sign_in(settings, body.email, deps.client_ip(request))
        raise HTTPException(401, "Email or password is incorrect.")
    activity.log(db, user, "sign_in", ip=deps.client_ip(request))
    token = auth.new_session(db, user["id"], settings.session_days)
    response.set_cookie(
        deps.SESSION_COOKIE, token, httponly=True, samesite="lax", secure=settings.cookie_secure,
        max_age=settings.session_days * 86400, path="/",
    )
    return {"user": deps.public_user(user)}


def log_failed_sign_in(settings: Settings, email: str, ip: str) -> None:
    # Its own connection: the request's is rolled back with the 401.
    with connect(settings.db_path) as db:
        activity.log(db, None, "sign_in_failed", subject=email.strip().lower()[:200], ip=ip)


@router.post("/logout")
def logout(request: Request, response: Response, db: sqlite3.Connection = Depends(deps.db, scope="function")):
    auth.end_session(db, request.cookies.get(deps.SESSION_COOKIE))
    response.delete_cookie(deps.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: sqlite3.Row = Depends(deps.current_user)):
    return {"user": deps.public_user(user)}


class PasswordIn(BaseModel):
    current: str
    new: str


@router.put("/password")
def change_password(
    body: PasswordIn,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
):
    try:
        auth.change_password(db, user["id"], body.current, body.new)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True}
