from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .. import deps
from ..config import Settings
from ..services import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(
    body: LoginIn,
    response: Response,
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
    settings: Settings = Depends(deps.settings),
):
    user = auth.authenticate(db, body.email, body.password)
    if user is None:
        raise HTTPException(401, "Email or password is incorrect.")
    token = auth.new_session(db, user["id"], settings.session_days)
    response.set_cookie(
        deps.SESSION_COOKIE, token, httponly=True, samesite="lax", secure=settings.cookie_secure,
        max_age=settings.session_days * 86400, path="/",
    )
    return {"user": deps.public_user(user)}


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
