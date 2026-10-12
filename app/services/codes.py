"""Six-digit codes sent by email: joining with a school email, and forgot password.

Stored hashed (with the email and purpose mixed in). A code lasts 15 minutes and allows 5
tries; asking again replaces the old one. Requests are limited per email and per address
(IP) the same way failed sign-ins are recorded: each request is an activity-log entry, and
the limits count recent entries.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3

PURPOSES = ("signup", "reset")
CODE_MINUTES = 15
MAX_ATTEMPTS = 5
PER_EMAIL_HOUR = 3
PER_IP_HOUR = 20
REQUEST_ACTIONS = {"signup": "signup_code", "reset": "reset_code"}


class CodeError(Exception):
    """Shown to the teacher as is."""


def _hash(email: str, purpose: str, code: str) -> str:
    return hashlib.sha256(f"{purpose}:{email.strip().lower()}:{code}".encode()).hexdigest()


def too_many_requests(db: sqlite3.Connection, email: str, ip: str) -> bool:
    """At most PER_EMAIL_HOUR codes per email, and PER_IP_HOUR per address, an hour."""
    actions = tuple(REQUEST_ACTIONS.values())
    marks = ",".join("?" * len(actions))
    recent = "created_at > datetime('now', '-1 hour')"
    by_email = db.execute(f"SELECT COUNT(*) FROM activity WHERE action IN ({marks}) AND subject = ? AND {recent}",
                          (*actions, email.strip().lower())).fetchone()[0]
    by_ip = db.execute(f"SELECT COUNT(*) FROM activity WHERE action IN ({marks}) AND ip = ? AND {recent}",
                       (*actions, ip)).fetchone()[0] if ip else 0
    return by_email >= PER_EMAIL_HOUR or by_ip >= PER_IP_HOUR


def issue(db: sqlite3.Connection, email: str, purpose: str) -> str:
    """A new code for this email and purpose; any earlier one stops working."""
    assert purpose in PURPOSES
    email = email.strip().lower()
    code = f"{secrets.randbelow(10**6):06d}"
    db.execute("DELETE FROM email_codes WHERE expires_at < datetime('now') OR (email = ? AND purpose = ?)",
               (email, purpose))
    db.execute("INSERT INTO email_codes(email, purpose, code_hash, expires_at) VALUES (?, ?, ?, datetime('now', ?))",
               (email, purpose, _hash(email, purpose, code), f"+{CODE_MINUTES} minutes"))
    return code


def check(db: sqlite3.Connection, email: str, purpose: str, code: str) -> None:
    """Use up the code, or raise CodeError. A wrong guess counts as a try (the caller must
    commit before turning the error into a response)."""
    email = email.strip().lower()
    row = db.execute("SELECT * FROM email_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1",
                     (email, purpose)).fetchone()
    if row is None or db.execute("SELECT ? < datetime('now')", (row["expires_at"],)).fetchone()[0]:
        raise CodeError("That code has expired. Ask for a new one.")
    if row["attempts"] >= MAX_ATTEMPTS:
        raise CodeError("Too many tries. Ask for a new code.")
    given = "".join(ch for ch in code if ch.isdigit())
    if not hmac.compare_digest(_hash(email, purpose, given), row["code_hash"]):
        db.execute("UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?", (row["id"],))
        left = MAX_ATTEMPTS - row["attempts"] - 1
        raise CodeError("That code isn't right. Check the email and try again." if left else
                        "That code isn't right, and that was the last try. Ask for a new code.")
    db.execute("DELETE FROM email_codes WHERE email = ? AND purpose = ?", (email, purpose))
