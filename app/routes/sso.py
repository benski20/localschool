"""Sign in with Google / Microsoft (app/services/sso.py does the checking).

    GET  /api/auth/sso/{provider}/start?mode=web|app|desk[&json=1]
    GET  /api/auth/sso/{provider}/callback        the provider sends the teacher back here
    GET  /api/auth/sso/redeem?code=               Mac app: finish signing in its window
    POST /api/auth/device/sso  {code, label}      Mac app: "Keep my data on this Mac"
    POST /api/auth/code        {email, password}  personal desk only: the app signs itself in
    GET/PUT /api/admin/sso                        admins: who can join (domains, join setting),
                                                  client IDs, and email (SMTP) for sign-up codes
    POST /api/admin/sso/test-email                admins: send themselves a test email

Modes: "web" signs this browser in. "app" and "desk" are for the Mac app, which opens the
provider in the teacher's browser (Google refuses embedded web views); when it's done the
page hands a one-time code back to the app through its teachersdesk:// link.
"""

from __future__ import annotations

import html
import secrets
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field

from .. import deps
from ..config import Settings
from ..llm import Runtime
from ..services import activity, auth, mail, sso
from .install import _base
from .relay import device_bundle

router = APIRouter(tags=["sso"])
BROWSER_COOKIE = "ls_sso"
APP_SCHEME = "teachersdesk"


def _redirect_uri(request: Request, settings: Settings, provider: str) -> str:
    return f"{_base(request, settings)}/api/auth/sso/{provider}/callback"


def _set_session(response, db: sqlite3.Connection, settings: Settings, user: sqlite3.Row) -> None:
    token = auth.new_session(db, user["id"], settings.session_days)
    response.set_cookie(deps.SESSION_COOKIE, token, httponly=True, samesite="lax", secure=settings.cookie_secure,
                        max_age=settings.session_days * 86400, path="/")


def _page(title: str, body: str, *, link: str = "", button: str = "") -> HTMLResponse:
    """The small page the teacher sees in their browser at the end of a sign-in."""
    action = (f'<p><a class="btn" href="{html.escape(link)}">{html.escape(button)}</a></p>'
              f'<script>setTimeout(function(){{location.href={link!r};}},300)</script>') if link else ""
    return HTMLResponse(f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title>
<style>body{{font:16px/1.5 -apple-system,system-ui,sans-serif;background:#fafafa;color:#111;margin:0;
display:grid;place-items:center;min-height:100vh}}main{{max-width:420px;padding:24px}}h1{{font-weight:400;
font-size:24px;margin:0 0 8px}}p{{color:#525252;margin:8px 0}}.btn{{display:inline-block;margin-top:12px;
padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:2px}}
@media(prefers-color-scheme:dark){{body{{background:#0e0e0e;color:#ededed}}p{{color:#afafaf}}
.btn{{background:#ededed;color:#111}}}}</style></head>
<body><main><h1>{html.escape(title)}</h1><p>{html.escape(body)}</p>{action}</main></body></html>""")


@router.get("/api/auth/sso/{provider}/start")
def start(provider: str, request: Request, mode: str = "web", json: int = 0,
          db: sqlite3.Connection = Depends(deps.db, scope="function"),
          settings: Settings = Depends(deps.settings)):
    browser = secrets.token_urlsafe(24) if mode == "web" else ""
    try:
        url = sso.begin(db, settings, provider, mode, _redirect_uri(request, settings, provider), browser)
    except sso.SSOError as e:
        raise HTTPException(400, str(e)) from e
    response = {"url": url} if json else RedirectResponse(url, status_code=302)
    if browser:
        if json:
            raise HTTPException(400, "Use mode=app or mode=desk with json=1.")
        response.set_cookie(BROWSER_COOKIE, browser, httponly=True, samesite="lax", secure=settings.cookie_secure,
                            max_age=sso.PENDING_MINUTES * 60, path="/api/auth/sso")
    return response


@router.get("/api/auth/sso/{provider}/callback")
async def callback(provider: str, request: Request, code: str = "", state: str = "", error: str = "",
                   db: sqlite3.Connection = Depends(deps.db, scope="function"),
                   settings: Settings = Depends(deps.settings)):
    label = sso.LABELS.get(provider, provider)
    if error or not code:
        return _page("Sign-in cancelled", f"{label} sign-in didn't finish. Close this tab and try again.")
    try:
        user, mode = await sso.finish(db, settings, provider, code, state, _redirect_uri(request, settings, provider),
                                      request.cookies.get(BROWSER_COOKIE, ""),
                                      transport=getattr(request.app.state, "sso_transport", None))
    except sso.SSOError as e:
        db.commit()  # the used-up pending sign-in stays deleted
        return _page("Couldn't sign you in", str(e))
    activity.log(db, user, "sso_sign_in", subject=label, ip=deps.client_ip(request))
    if mode == "web":
        response = RedirectResponse("/chat", status_code=302)
        _set_session(response, db, settings, user)
        response.delete_cookie(BROWSER_COOKIE, path="/api/auth/sso")
        return response
    purpose = "signin" if mode == "app" else "desk"
    one_time = sso.new_code(db, user["id"], purpose)
    link = f"{APP_SCHEME}://{purpose}?code={one_time}"
    if mode == "app":
        return _page(f"Signed in as {user['name'] or user['email']}", "Return to Teacher's Desk to continue.",
                     link=link, button="Open Teacher's Desk")
    return _page(f"Signed in as {user['name'] or user['email']}",
                 "Return to Teacher's Desk to finish setting up this Mac.", link=link, button="Open Teacher's Desk")


@router.get("/api/auth/sso/redeem")
def redeem(code: str, db: sqlite3.Connection = Depends(deps.db, scope="function"),
           settings: Settings = Depends(deps.settings)):
    user = sso.redeem(db, code, "signin")
    if user is None:
        return RedirectResponse("/", status_code=302)  # expired or used: the sign-in page
    response = RedirectResponse("/chat", status_code=302)
    _set_session(response, db, settings, user)
    return response


class DeviceCodeIn(BaseModel):
    code: str
    label: str = ""


@router.post("/api/auth/device/sso")
def device_from_sso(body: DeviceCodeIn, request: Request,
                    db: sqlite3.Connection = Depends(deps.db, scope="function"),
                    settings: Settings = Depends(deps.settings),
                    runtime: Runtime = Depends(deps.runtime)):
    user = sso.redeem(db, body.code, "desk")
    if user is None:
        raise HTTPException(401, "That sign-in expired. Try again.")
    return device_bundle(db, request, settings, runtime, user, body.label)


class CodeIn(BaseModel):
    email: str
    password: str


@router.post("/api/auth/code")
def sign_in_code(body: CodeIn, db: sqlite3.Connection = Depends(deps.db, scope="function"),
                 settings: Settings = Depends(deps.settings)):
    """A personal desk only: the Mac app signs the teacher in to their own desk with the
    password it keeps in the Keychain, so they never see a sign-in screen there."""
    if not settings.local_mode:
        raise HTTPException(404, "Not found")
    user = auth.authenticate(db, body.email, body.password)
    if user is None:
        raise HTTPException(401, "Email or password is incorrect.")
    return {"code": sso.new_code(db, user["id"], "signin")}


class EmailIn(BaseModel):
    host: str | None = None
    port: int | str | None = None
    username: str | None = None
    password: str | None = None  # empty or missing: keep the saved one
    from_: str | None = Field(None, alias="from")


class SSOIn(BaseModel):
    google_client_id: str | None = None
    google_client_secret: str | None = None
    microsoft_client_id: str | None = None
    microsoft_client_secret: str | None = None
    microsoft_tenant: str | None = None
    domains: list[str] | str | None = None
    auto_join: bool | None = None
    email: EmailIn | None = None


@router.get("/api/admin/sso")
def get_sso(request: Request, _: sqlite3.Row = Depends(deps.admin_user),
            db: sqlite3.Connection = Depends(deps.db, scope="function"),
            settings: Settings = Depends(deps.settings)):
    return {**sso.load(db, settings).public(),
            "email": mail.load(db, settings).public(),  # never the password
            "redirect_uris": {p: _redirect_uri(request, settings, p) for p in sso.PROVIDERS}}


@router.put("/api/admin/sso")
def put_sso(body: SSOIn, request: Request, _: sqlite3.Row = Depends(deps.admin_user),
            db: sqlite3.Connection = Depends(deps.db, scope="function"),
            settings: Settings = Depends(deps.settings)):
    values = body.model_dump(exclude={"email"})
    if body.email is not None:
        e = body.email
        try:
            mail.save(db, {"host": e.host, "port": e.port, "username": e.username, "password": e.password,
                           "from": e.from_})
        except mail.MailError as err:
            raise HTTPException(400, str(err)) from err
    for k in ("google_client_secret", "microsoft_client_secret"):
        if values[k] == "":
            values[k] = None  # an empty secret field means "keep the saved one"
    sso.save(db, values)
    return get_sso(request, _, db, settings)


class TestEmailIn(BaseModel):
    to: str = ""


@router.post("/api/admin/sso/test-email")
def test_email(body: TestEmailIn, request: Request, admin: sqlite3.Row = Depends(deps.admin_user),
               db: sqlite3.Connection = Depends(deps.db, scope="function"),
               settings: Settings = Depends(deps.settings)):
    """Send a test email (to the admin, unless another address is given) and say what happened."""
    cfg = mail.load(db, settings)
    if not cfg.configured():
        raise HTTPException(400, "Add the mail server and from address first, then save.")
    to = (body.to or admin["email"]).strip()
    msg = mail.message(cfg, to, "Teacher's Desk test email",
                       f"This is a test from Teacher's Desk at {settings.school_name}.\n\n"
                       "Email works: teachers can now get sign-up codes and reset their passwords.\n")
    try:
        mail.sender_for(request.app.state)(cfg, msg)
    except mail.MailError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True, "to": to}
