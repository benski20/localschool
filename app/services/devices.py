"""Personal desks: keys that let a teacher's own server (on their Mac) use this school's
models through /api/relay. The key is shown once, to the Mac app; only its hash is kept.
Deleting the key or the teacher's account cuts the Mac off."""

from __future__ import annotations

import hashlib
import secrets
import sqlite3


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def create_key(db: sqlite3.Connection, user_id: int, label: str) -> str:
    key = "ls_dev_" + secrets.token_urlsafe(32)
    db.execute("INSERT INTO device_keys(user_id, key_hash, label) VALUES (?, ?, ?)",
               (user_id, _hash(key), label.strip()[:80]))
    return key


def user_for_key(db: sqlite3.Connection, key: str) -> sqlite3.Row | None:
    if not key.startswith("ls_dev_"):
        return None
    row = db.execute(
        "SELECT d.id AS device_id, u.* FROM device_keys d JOIN users u ON u.id = d.user_id WHERE d.key_hash = ?",
        (_hash(key),),
    ).fetchone()
    if row:
        db.execute("UPDATE device_keys SET last_used_at = datetime('now') WHERE id = ?", (row["device_id"],))
    return row


def list_devices(db: sqlite3.Connection) -> list[dict]:
    rows = db.execute(
        "SELECT d.id, d.label, d.created_at, d.last_used_at, u.name, u.email FROM device_keys d "
        "JOIN users u ON u.id = d.user_id ORDER BY COALESCE(d.last_used_at, d.created_at) DESC"
    ).fetchall()
    return [dict(r) for r in rows]


def delete_device(db: sqlite3.Connection, device_id: int) -> bool:
    return db.execute("DELETE FROM device_keys WHERE id = ?", (device_id,)).rowcount > 0
