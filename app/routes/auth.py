"""Accounts: sign in and out, change password, and (when the school allows it) join with
a school email and reset a forgotten password with a six-digit emailed code.

    POST /api/auth/signup/start  {name, email}                 emails a code
    POST /api/auth/signup/finish {email, code, password, name} creates a teacher, signs in
    POST /api/auth/reset/start   {email}                       emails a code
    POST /api/auth/reset/finish  {email, code, password}       sets the password, signs in

Who can join is the same setting as Google / Microsoft sign-in (services/sso.py: the
school's domains and "anyone at these domains can join"). The start endpoints answer the
same way whether or not an account exists, so they can't be used to find out who has one.
"""

from __future__ import annotations

import logging
import sqlite3

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .. import deps
from ..config import Settings
from ..db import connect
from ..services import activity, auth, codes, mail, sso

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
    return start_session(response, db, settings, user)


def start_session(response: Response, db: sqlite3.Connection, settings: Settings, user: sqlite3.Row) -> dict:
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


# ---------------------------------------------------------------- join with a school email

log = logging.getLogger("localschool")
SENT = "If that address can join, we've emailed a code."
SENT_RESET = "If there's an account with that address, we've emailed a code."
CLOSED = "Signing up isn't turned on here. Ask your administrator to add you."
NO_RESET = "Resetting a password by email isn't set up here. Ask your administrator."


def availability(db: sqlite3.Connection, settings: Settings) -> dict:
    """What /api/health tells the sign-in page: can teachers join, can they reset a password.
    Email must be set up, except in the fictional hosted demo, which shows codes on screen."""
    if settings.local_mode:
        return {"signup": False, "reset": False, "demo": False, "domains": ()}
    cfg, mc = sso.load(db, settings), mail.load(db, settings)
    demo = settings.demo_logins and not mc.configured()
    deliverable = mc.configured() or demo
    return {"signup": bool(cfg.auto_join and cfg.domains and deliverable), "reset": deliverable,
            "demo": demo, "domains": cfg.domains}


def _email(raw: str) -> str:
    email = raw.strip().lower()
    if "@" not in email or len(email) > 200 or any(c.isspace() for c in email):
        raise HTTPException(400, "Enter your email address.")
    return email


def _allowed(email: str, domains: tuple[str, ...]) -> None:
    if email.rsplit("@", 1)[1] not in domains:
        raise HTTPException(400, f"Use your school email ({', '.join('@' + d for d in domains)}).")


def _limit(db: sqlite3.Connection, email: str, ip: str) -> None:
    if codes.too_many_requests(db, email, ip):
        raise HTTPException(429, "Too many codes asked for. Wait an hour, then try again.")


def _send(request: Request, settings: Settings, to: str, subject: str, body: str):
    """Deliver after the response, so the answer takes the same time whether or not an
    account exists. Failures are logged; the teacher already has the generic answer."""
    sender = mail.sender_for(request.app.state)

    def run() -> None:
        try:
            with connect(settings.db_path) as db:
                cfg = mail.load(db, settings)
            sender(cfg, mail.message(cfg, to, subject, body))
        except Exception:  # noqa: BLE001
            log.exception("couldn't send email to %s", to)
    return run


def _code_email(settings: Settings, purpose: str, code: str) -> tuple[str, str]:
    what = "join Teacher's Desk" if purpose == "signup" else "set a new Teacher's Desk password"
    return (f"Your Teacher's Desk code: {code}",
            f"Hello,\n\nYour code to {what} at {settings.school_name} is:\n\n    {code}\n\n"
            f"Type it on the page where you asked for it. It works for {codes.CODE_MINUTES} minutes.\n\n"
            "If you didn't ask for this, you can ignore this email.\n")


def _already_email(settings: Settings) -> tuple[str, str]:
    return ("You already have a Teacher's Desk account",
            f"Hello,\n\nSomeone (probably you) asked to join Teacher's Desk at {settings.school_name} with "
            "this address, but you already have an account.\n\n"
            "Sign in with your password, or use \"Forgot password?\" on the sign-in page to set a new one.\n\n"
            "If you didn't ask for this, you can ignore this email.\n")


def _use_code(db: sqlite3.Connection, email: str, purpose: str, code: str) -> None:
    try:
        codes.check(db, email, purpose, code)
    except codes.CodeError as e:
        db.commit()  # the wrong guess still counts
        raise HTTPException(400, str(e)) from e


def _password_ok(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(400, "Use at least 8 characters for your password.")


class SignupStartIn(BaseModel):
    name: str = ""
    email: str


@router.post("/signup/start")
def signup_start(body: SignupStartIn, request: Request, tasks: BackgroundTasks,
                 db: sqlite3.Connection = Depends(deps.db, scope="function"),
                 settings: Settings = Depends(deps.settings)):
    a = availability(db, settings)
    if not a["signup"]:
        raise HTTPException(400, CLOSED)
    email, ip = _email(body.email), deps.client_ip(request)
    _allowed(email, a["domains"])
    _limit(db, email, ip)
    activity.log(db, None, "signup_code", subject=email, ip=ip)
    out: dict = {"ok": True, "message": SENT}
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        # No code: the same answer on screen, and an email telling them to sign in instead.
        if a["demo"]:
            out["demo_notice"] = "You already have an account. Sign in, or use Forgot password."
        else:
            tasks.add_task(_send(request, settings, email, *_already_email(settings)))
        return out
    code = codes.issue(db, email, "signup")
    if a["demo"]:
        out["demo_code"] = code  # the fictional demo has no email server: show it on screen
    else:
        tasks.add_task(_send(request, settings, email, *_code_email(settings, "signup", code)))
    return out


class SignupFinishIn(BaseModel):
    email: str
    code: str
    password: str
    name: str = ""


@router.post("/signup/finish")
def signup_finish(body: SignupFinishIn, request: Request, response: Response,
                  db: sqlite3.Connection = Depends(deps.db, scope="function"),
                  settings: Settings = Depends(deps.settings)):
    a = availability(db, settings)
    if not a["signup"]:
        raise HTTPException(400, CLOSED)
    email = _email(body.email)
    _allowed(email, a["domains"])
    _password_ok(body.password)
    _use_code(db, email, "signup", body.code)
    name = body.name.strip()[:120] or email.split("@")[0]
    try:
        uid = auth.create_user(db, email=email, name=name, role="teacher", password=body.password)
    except ValueError as e:
        raise HTTPException(400, "You already have an account. Sign in instead." if "exists" in str(e) else str(e)) from e
    user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    activity.log(db, user, "signed_up", ip=deps.client_ip(request))
    return start_session(response, db, settings, user)


class ResetStartIn(BaseModel):
    email: str


@router.post("/reset/start")
def reset_start(body: ResetStartIn, request: Request, tasks: BackgroundTasks,
                db: sqlite3.Connection = Depends(deps.db, scope="function"),
                settings: Settings = Depends(deps.settings)):
    a = availability(db, settings)
    if not a["reset"]:
        raise HTTPException(400, NO_RESET)
    email, ip = _email(body.email), deps.client_ip(request)
    _limit(db, email, ip)
    activity.log(db, None, "reset_code", subject=email, ip=ip)
    out: dict = {"ok": True, "message": SENT_RESET}
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    # The demo shows codes on screen, so there it never resets an administrator's password.
    if user is None or (a["demo"] and user["role"] != "teacher"):
        return out
    code = codes.issue(db, email, "reset")
    if a["demo"]:
        out["demo_code"] = code
    else:
        tasks.add_task(_send(request, settings, email, *_code_email(settings, "reset", code)))
    return out


class ResetFinishIn(BaseModel):
    email: str
    code: str
    password: str


@router.post("/reset/finish")
def reset_finish(body: ResetFinishIn, request: Request, response: Response,
                 db: sqlite3.Connection = Depends(deps.db, scope="function"),
                 settings: Settings = Depends(deps.settings)):
    a = availability(db, settings)
    if not a["reset"]:
        raise HTTPException(400, NO_RESET)
    email = _email(body.email)
    _password_ok(body.password)
    _use_code(db, email, "reset", body.code)
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user is None:  # removed since the code was sent
        raise HTTPException(400, "That code has expired. Ask for a new one.")
    auth.set_password(db, user["id"], body.password)
    auth.end_all_sessions(db, user["id"])  # signed out everywhere else
    activity.log(db, user, "password_reset", ip=deps.client_ip(request))
    return start_session(response, db, settings, user)
