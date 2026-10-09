"""Local accounts and cookie sessions (stdlib only: scrypt + random tokens)."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r),
                              p=int(p), dklen=len(bytes.fromhex(digest)))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(calc.hex(), digest)


def create_user(db: sqlite3.Connection, *, email: str, name: str, role: str, password: str) -> int:
    from .roster import link_sections

    email = email.strip().lower()
    if "@" not in email:
        raise ValueError("Enter a valid email address.")
    if role not in ("admin", "teacher"):
        raise ValueError("Role must be admin or teacher.")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        raise ValueError("A user with that email already exists.")
    uid = int(db.execute(
        "INSERT INTO users(email, name, role, password_hash) VALUES (?, ?, ?, ?)",
        (email, name.strip() or email.split("@")[0], role, hash_password(password)),
    ).lastrowid)
    link_sections(db, email, uid)
    return uid


def authenticate(db: sqlite3.Connection, email: str, password: str) -> sqlite3.Row | None:
    row = db.execute("SELECT * FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()
    if row and verify_password(password, row["password_hash"]):
        return row
    return None


def new_session(db: sqlite3.Connection, user_id: int, days: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=days)
    db.execute("INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)",
               (token, user_id, expires.isoformat()))
    db.execute("DELETE FROM sessions WHERE expires_at < ?", (datetime.now(timezone.utc).isoformat(),))
    return token


def session_user(db: sqlite3.Connection, token: str | None) -> sqlite3.Row | None:
    if not token:
        return None
    return db.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = ? AND s.expires_at > ?",
        (token, datetime.now(timezone.utc).isoformat()),
    ).fetchone()


def end_session(db: sqlite3.Connection, token: str | None) -> None:
    if token:
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))
