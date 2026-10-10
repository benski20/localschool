"""Draft storage and the API's view of a draft. A draft belongs to one teacher: every
lookup here takes the owner's id, so nobody else (admins included) can read it."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from . import adapt, feedback, meeting, parent_email
from .common import Prepared, clip

MODULES = {"meeting": meeting, "feedback": feedback, "adapt": adapt, "email": parent_email}
ACTIVE = ("queued", "running")


def create(db: sqlite3.Connection, user_id: int, tool: str, p: Prepared, *, model: str,
           batch_id: str | None = None, status: str = "queued") -> int:
    return int(db.execute(
        "INSERT INTO drafts(user_id, tool, title, input_json, status, student_id, batch_id, model, transcript_json) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, tool, p.title, json.dumps(p.input), status, p.student_id, batch_id, model,
         json.dumps(p.transcript) if p.transcript is not None else None),
    ).lastrowid)


def get(db: sqlite3.Connection, draft_id: int, user_id: int) -> sqlite3.Row | None:
    return db.execute("SELECT * FROM drafts WHERE id = ? AND user_id = ?", (draft_id, user_id)).fetchone()


def recent(db: sqlite3.Connection, user_id: int, tool: str, *, batch: str | None = None,
           limit: int = 30) -> list[sqlite3.Row]:
    if batch:
        return db.execute("SELECT * FROM drafts WHERE user_id = ? AND tool = ? AND batch_id = ? ORDER BY id",
                          (user_id, tool, batch)).fetchall()
    return db.execute("SELECT * FROM drafts WHERE user_id = ? AND tool = ? ORDER BY id DESC LIMIT ?",
                      (user_id, tool, limit)).fetchall()


def queue_positions(db: sqlite3.Connection) -> dict[int, int]:
    """1-based place in the shared queue for every queued draft."""
    rows = db.execute("SELECT id FROM drafts WHERE status = 'queued' ORDER BY id").fetchall()
    return {r[0]: i for i, r in enumerate(rows, start=1)}


def batch_summary(rows: list[sqlite3.Row]) -> dict | None:
    if not rows:
        return None
    ready = sum(r["status"] == "ready" for r in rows)
    errors = sum(r["status"] == "error" for r in rows)
    done = ready + errors
    progress = sum(1.0 if r["status"] in ("ready", "error") else float(r["progress"] or 0) for r in rows)
    return {"id": rows[0]["batch_id"], "total": len(rows), "ready": ready, "error": errors,
            "active": len(rows) - done, "done": done == len(rows), "progress": round(progress / len(rows), 3)}


def job(row: sqlite3.Row, audio_dir: Path) -> dict:
    """What a tool's `run` gets."""
    from .audio import path_of

    return {
        "id": row["id"],
        "tool": row["tool"],
        "input": json.loads(row["input_json"]),
        "transcript": json.loads(row["transcript_json"]) if row["transcript_json"] else None,
        "audio_file": path_of(audio_dir, row["audio_path"]),
    }


def _preview(tool: str, out: dict | None) -> str:
    if not out:
        return ""
    if tool == "email":
        return clip(out.get("subject", ""), 140)
    if tool == "adapt":
        v = (out.get("versions") or [{}])[0]
        return clip(v.get("text", ""), 140)
    if tool == "feedback":
        items = out.get("strengths") or out.get("next_steps") or [{}]
        return clip(items[0].get("comment", ""), 140)
    return clip(out.get("summary", ""), 140)


def serialize(row: sqlite3.Row, *, full: bool = True, queue: dict[int, int] | None = None) -> dict:
    inp = json.loads(row["input_json"])
    out = json.loads(row["output_json"]) if row["output_json"] else None
    student = inp.get("student")
    d = {
        "id": row["id"],
        "tool": row["tool"],
        "title": row["title"],
        "status": row["status"],
        "stage": row["stage"],
        "progress": round(float(row["progress"] or 0), 3),
        "error": row["error"],
        "queue_position": (queue or {}).get(row["id"]),
        "student": {"id": row["student_id"], "name": student["name"]} if student else None,
        "batch": row["batch_id"],
        "model": row["model"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "edited_at": row["edited_at"],
        "approved_at": row["approved_at"],
    }
    if row["tool"] == "meeting":
        d |= {"meeting_type": inp["meeting_type"], "source": inp.get("source", "audio"),
              "has_audio": bool(row["audio_path"]), "audio_bytes": row["audio_bytes"]}
    if not full:
        d["preview"] = _preview(row["tool"], out)
        return d
    d["input"] = {k: v for k, v in inp.items() if k != "teacher"}
    d["output"] = out
    if row["tool"] == "meeting":
        segs = json.loads(row["transcript_json"]) if row["transcript_json"] else None
        d["transcript"] = [{"i": i, **s} for i, s in enumerate(segs)] if segs is not None else None
        d["sections"] = meeting.layout(inp["meeting_type"])
    if row["tool"] == "email":
        d["mailto"] = parent_email.mailto(out) if out else None
    return d
