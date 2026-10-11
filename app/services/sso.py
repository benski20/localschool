"""Sign in with Google / Microsoft: OpenID Connect, authorization code flow with PKCE.

No extra vendor: this server talks to Google or Microsoft directly. The ID token comes
straight from the provider's token endpoint over TLS, which OpenID Connect Core §3.1.3.7
accepts in place of checking its signature; we still check issuer, audience, expiry and
nonce, plus a verified email in one of the school's domains.

Settings live in the settings table (Settings › People › Sign-in) with env defaults.
A sign-in in progress is kept server-side (sso_pending), so it can start in the Mac app's
window and finish in the teacher's browser (Google refuses embedded web views).
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import sqlite3
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from ..config import Settings
from . import auth

PROVIDERS = ("google", "microsoft")
LABELS = {"google": "Google", "microsoft": "Microsoft"}
MODES = ("web", "app", "desk")  # browser sign-in; Mac app sign-in; Mac "keep my data" setup
PENDING_MINUTES = 10
CODE_SECONDS = 120
_KEYS = ("client_id", "client_secret")


class SSOError(Exception):
    """Shown to the teacher as is."""


@dataclass(frozen=True)
class Config:
    google_client_id: str
    google_client_secret: str
    microsoft_client_id: str
    microsoft_client_secret: str
    microsoft_tenant: str
    domains: tuple[str, ...]
    auto_join: bool

    def enabled(self) -> list[str]:
        out = []
        if self.google_client_id and self.google_client_secret:
            out.append("google")
        # Microsoft's multi-tenant endpoints accept any organization: require the domains.
        if self.microsoft_client_id and self.microsoft_client_secret and (
                self.domains or self.microsoft_tenant not in ("common", "organizations")):
            out.append("microsoft")
        return out

    def public(self) -> dict:
        mask = lambda s: ("•" * 6 + s[-4:]) if len(s) > 8 else ("•" * 6 if s else "")  # noqa: E731
        return {
            "google_client_id": self.google_client_id,
            "google_has_secret": bool(self.google_client_secret),
            "google_secret_hint": mask(self.google_client_secret),
            "microsoft_client_id": self.microsoft_client_id,
            "microsoft_has_secret": bool(self.microsoft_client_secret),
            "microsoft_secret_hint": mask(self.microsoft_client_secret),
            "microsoft_tenant": self.microsoft_tenant,
            "domains": list(self.domains),
            "auto_join": self.auto_join,
            "enabled": self.enabled(),
        }


_FIELDS = ("google_client_id", "google_client_secret", "microsoft_client_id", "microsoft_client_secret",
           "microsoft_tenant", "domains", "auto_join")


def _domains(raw: str) -> tuple[str, ...]:
    return tuple(sorted({d.strip().lower().lstrip("@") for d in raw.replace(";", ",").split(",") if d.strip()}))


def load(db: sqlite3.Connection, settings: Settings) -> Config:
    vals: dict[str, str] = {
        "google_client_id": settings.sso_google_client_id,
        "google_client_secret": settings.sso_google_client_secret,
        "microsoft_client_id": settings.sso_microsoft_client_id,
        "microsoft_client_secret": settings.sso_microsoft_client_secret,
        "microsoft_tenant": settings.sso_microsoft_tenant,
        "domains": settings.sso_domains,
        "auto_join": "1" if settings.sso_auto_join else "0",
    }
    for row in db.execute(f"SELECT key, value FROM settings WHERE key IN ({','.join('?' * len(_FIELDS))})",
                          [f"sso_{k}" for k in _FIELDS]):
        vals[row["key"][4:]] = row["value"]
    return Config(
        google_client_id=vals["google_client_id"].strip(),
        google_client_secret=vals["google_client_secret"].strip(),
        microsoft_client_id=vals["microsoft_client_id"].strip(),
        microsoft_client_secret=vals["microsoft_client_secret"].strip(),
        microsoft_tenant=(vals["microsoft_tenant"] or "organizations").strip(),
        domains=_domains(vals["domains"]),
        auto_join=vals["auto_join"] in ("1", "true", "True"),
    )


def save(db: sqlite3.Connection, values: dict) -> None:
    """Only the keys given; a secret of None keeps the saved one."""
    for k in _FIELDS:
        if k not in values or values[k] is None:
            continue
        v = values[k]
        if k == "domains":
            v = ",".join(_domains(",".join(v) if isinstance(v, list) else str(v)))
        elif k == "auto_join":
            v = "1" if v else "0"
        db.execute("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                   (f"sso_{k}", str(v).strip()))


def endpoints(provider: str, cfg: Config, settings: Settings) -> dict:
    if settings.sso_endpoints_override:
        override = json.loads(settings.sso_endpoints_override)
        if provider in override:
            return override[provider]
    if provider == "google":
        return {"auth": "https://accounts.google.com/o/oauth2/v2/auth",
                "token": "https://oauth2.googleapis.com/token",
                "issuer": "https://accounts.google.com"}
    tenant = cfg.microsoft_tenant
    return {"auth": f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
            "token": f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            "issuer": "https://login.microsoftonline.com/{tid}/v2.0"}


def _client(provider: str, cfg: Config) -> tuple[str, str]:
    return getattr(cfg, f"{provider}_client_id"), getattr(cfg, f"{provider}_client_secret")


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def begin(db: sqlite3.Connection, settings: Settings, provider: str, mode: str, redirect_uri: str,
          browser: str = "") -> str:
    """Record the sign-in in progress; return the provider's sign-in URL."""
    cfg = load(db, settings)
    if provider not in cfg.enabled():
        raise SSOError(f"Sign in with {LABELS.get(provider, provider)} isn't set up here.")
    if mode not in MODES:
        raise SSOError("Unknown sign-in mode.")
    state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    db.execute("DELETE FROM sso_pending WHERE expires_at < datetime('now')")
    db.execute(
        "INSERT INTO sso_pending(state, provider, nonce, verifier, mode, browser_hash, expires_at) "
        "VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))",
        (state, provider, nonce, verifier, mode, _hash(browser) if browser else "", f"+{PENDING_MINUTES} minutes"),
    )
    client_id, _ = _client(provider, cfg)
    params = {
        "client_id": client_id, "response_type": "code", "redirect_uri": redirect_uri,
        "scope": "openid email profile", "state": state, "nonce": nonce,
        "code_challenge": _b64(hashlib.sha256(verifier.encode()).digest()), "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    if provider == "google" and len(cfg.domains) == 1:
        params["hd"] = cfg.domains[0]  # Google shows only that school's accounts
    return f"{endpoints(provider, cfg, settings)['auth']}?{urlencode(params)}"


def _claims(id_token: str) -> dict:
    try:
        payload = id_token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError) as e:
        raise SSOError("The sign-in answer couldn't be read. Try again.") from e


async def finish(db: sqlite3.Connection, settings: Settings, provider: str, code: str, state: str,
                 redirect_uri: str, browser: str = "",
                 transport: httpx.AsyncBaseTransport | None = None) -> tuple[sqlite3.Row, str]:
    """Check the provider's answer; return (user, mode)."""
    row = db.execute("SELECT * FROM sso_pending WHERE state = ? AND expires_at > datetime('now')", (state,)).fetchone()
    db.execute("DELETE FROM sso_pending WHERE state = ?", (state,))
    if not row or row["provider"] != provider:
        raise SSOError("That sign-in expired. Try again.")
    if row["mode"] == "web" and row["browser_hash"] != _hash(browser or "-"):
        raise SSOError("That sign-in started in a different browser. Try again.")
    cfg = load(db, settings)
    client_id, client_secret = _client(provider, cfg)
    ep = endpoints(provider, cfg, settings)
    async with httpx.AsyncClient(timeout=20, transport=transport) as http:
        try:
            resp = await http.post(ep["token"], data={
                "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri,
                "client_id": client_id, "client_secret": client_secret, "code_verifier": row["verifier"],
            }, headers={"Accept": "application/json"})
        except httpx.HTTPError as e:
            raise SSOError(f"Couldn't reach {LABELS[provider]}. Try again.") from e
    if resp.status_code != 200 or "id_token" not in resp.text:
        raise SSOError(f"{LABELS[provider]} didn't accept the sign-in. Try again.")
    claims = _claims(resp.json()["id_token"])

    issuer = ep["issuer"].replace("{tid}", str(claims.get("tid", "")))
    if claims.get("iss") not in (issuer, issuer.removeprefix("https://")):
        raise SSOError("The sign-in came from an unexpected place.")
    aud = claims.get("aud")
    if client_id not in (aud if isinstance(aud, list) else [aud]):
        raise SSOError("The sign-in was meant for a different app.")
    if float(claims.get("exp", 0)) < time.time() - 60:
        raise SSOError("That sign-in expired. Try again.")
    if claims.get("nonce") != row["nonce"]:
        raise SSOError("That sign-in couldn't be confirmed. Try again.")
    if cfg.microsoft_tenant not in ("common", "organizations", "consumers") and provider == "microsoft" \
            and claims.get("tid") != cfg.microsoft_tenant:
        raise SSOError("Use your school's Microsoft account.")

    email = str(claims.get("email") or (claims.get("preferred_username") if provider == "microsoft" else "") or "")
    email = email.strip().lower()
    if provider == "google" and claims.get("email_verified") not in (True, "true"):
        raise SSOError("Your Google account's email isn't verified.")
    if "@" not in email:
        raise SSOError("Your account didn't share an email address.")
    if cfg.domains and email.rsplit("@", 1)[1] not in cfg.domains:
        raise SSOError(f"Use your school account ({', '.join('@' + d for d in cfg.domains)}).")

    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user is None:
        if not (cfg.auto_join and cfg.domains):
            raise SSOError(f"{email} doesn't have a Teacher's Desk account yet. Ask your administrator to add you.")
        name = str(claims.get("name") or email.split("@")[0]).strip()[:120]
        uid = auth.create_user(db, email=email, name=name, role="teacher", password=secrets.token_urlsafe(24))
        user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return user, row["mode"]


def new_code(db: sqlite3.Connection, user_id: int, purpose: str) -> str:
    """One-time, two-minute code that hands a sign-in to the Mac app."""
    code = secrets.token_urlsafe(24)
    db.execute("DELETE FROM login_codes WHERE expires_at < datetime('now')")
    db.execute("INSERT INTO login_codes(code_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, datetime('now', ?))",
               (_hash(code), user_id, purpose, f"+{CODE_SECONDS} seconds"))
    return code


def redeem(db: sqlite3.Connection, code: str, purpose: str) -> sqlite3.Row | None:
    row = db.execute(
        "SELECT u.* FROM login_codes c JOIN users u ON u.id = c.user_id "
        "WHERE c.code_hash = ? AND c.purpose = ? AND c.expires_at > datetime('now')",
        (_hash(code), purpose),
    ).fetchone()
    db.execute("DELETE FROM login_codes WHERE code_hash = ?", (_hash(code),))
    return row
