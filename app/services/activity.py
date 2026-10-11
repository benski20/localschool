"""Activity log for admins (Settings › Activity): sign-ins, whose student information was
used and by whom, and changes to people, documents and Macs. It records who and what,
never the text of a question or a document. Kept for `activity_days` (default a year)."""

from __future__ import annotations

import csv
import io
import sqlite3

# action → how the admin page says it
ACTIONS = {
    "sign_in": "signed in",
    "sign_in_failed": "failed to sign in",
    "sso_sign_in": "signed in with",
    "students_viewed": "viewed the class list",
    "students_used": "asked about",
    "draft_for_student": "made a draft for",
    "meeting_asked": "asked about a meeting",
    "roster_imported": "imported the roster",
    "document_added": "added",
    "document_deleted": "deleted",
    "person_added": "added",
    "person_removed": "removed",
    "mac_added": "set up their Mac to keep data on it",
    "mac_removed": "removed the Mac of",
}


def log(db: sqlite3.Connection, user: sqlite3.Row | dict | None, action: str, subject: str = "",
        detail: str = "", ip: str = "") -> None:
    db.execute(
        "INSERT INTO activity(user_id, who, action, subject, detail, ip) VALUES (?, ?, ?, ?, ?, ?)",
        (user["id"] if user else None, (user["name"] or user["email"]) if user else "", action,
         subject[:300], detail[:300], ip[:64]),
    )


def recently(db: sqlite3.Connection, user_id: int, action: str, minutes: int) -> bool:
    """For noisy events (opening the class list): log at most once per `minutes`."""
    return db.execute(
        "SELECT 1 FROM activity WHERE user_id = ? AND action = ? AND created_at > datetime('now', ?)",
        (user_id, action, f"-{int(minutes)} minutes"),
    ).fetchone() is not None


def search(db: sqlite3.Connection, q: str = "", before_id: int | None = None, limit: int = 100) -> list[dict]:
    sql = "SELECT id, user_id, who, action, subject, detail, created_at FROM activity WHERE 1=1"
    args: list = []
    if q.strip():
        sql += " AND (who LIKE ? OR subject LIKE ? OR detail LIKE ?)"
        like = f"%{q.strip()}%"
        args += [like, like, like]
    if before_id:
        sql += " AND id < ?"
        args.append(before_id)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    return [{**dict(r), "what": ACTIONS.get(r["action"], r["action"])} for r in db.execute(sql, args)]


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["when (UTC)", "who", "what", "subject", "detail"])
    for r in rows:
        w.writerow([r["created_at"], r["who"], r["what"], r["subject"], r["detail"]])
    return buf.getvalue()


def purge(db: sqlite3.Connection, days: int) -> int:
    return db.execute("DELETE FROM activity WHERE created_at < datetime('now', ?)", (f"-{int(days)} days",)).rowcount
