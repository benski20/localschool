"""Teacher tools API: meeting notes, feedback, adapt a reading, parent email.

Every output is a DRAFT owned by one teacher: only its owner can list, read, edit, approve
or delete it (anyone else, admins included, gets 404). Nothing is ever sent and nothing is
graded. Students are targeted through roster scoping only: a student outside the caller's
own sections is 404 "Student not found in your roster." Errors are `{"error": "message"}`.

Tools (the `{tool}` path segment): `meeting` | `feedback` | `adapt` | `email`.

GET  /api/tools
    → {"tools": [...], "meeting_types": [{"key", "label", "sections": [{"key", "title", "kind"}]}],
       "adapt_levels": [{"key", "label"}], "email_tones": ["warm", "neutral", "firm"],
       "audio": {"accept": [".webm", ".ogg", ".m4a", ".mp3", ".wav"], "max_bytes": 209715200,
                 "chunk_bytes": 8388608},
       "limits": {"feedback_pieces": 40, "work_chars": 16000, "reading_chars": 12000, "adapt_versions": 3}}

POST /api/tools/{tool}/drafts           JSON, or multipart/form-data with the same fields
    → 200 {"draft": Draft, "drafts": [Draft, ...], "batch": str|null, "errors": [{"filename", "error"}]}
    Creates the draft(s) and queues the job; poll GET /api/drafts/{id} until status is
    "ready" or "error". `drafts` has more than one entry only for a feedback batch.
    400 bad input · 404 student/rubric not visible · 422 invalid fields.
    All tools accept "model": a teacher-pickable chat model (GET /api/models); else the most
    thorough one teachers may pick (the last option), since drafts favor quality over speed.

  meeting  {"meeting_type": "iep"|"parent_conference"|"sst"|"plc"|"other", "student_id"?: int,
            "title"?: str, "consent"?: bool, "language"?: "en" (spoken-language hint),
            "transcript_text"?: str}
           With transcript_text ("Paste a transcript": plain lines, "[00:12] text" lines, or a
           WebVTT/SRT export) the notes job is queued at once. Without it the draft waits in
           status "awaiting_audio" for POST /api/meetings/{id}/audio. Multipart may also carry
           the recording as file field "audio" (needs consent=true), or a .vtt/.txt file as
           "transcript_file".
  feedback {"work"?: str, "title"?: str, "works"?: [{"title", "text"}], "rubric_document_id"?: int
            | "rubric_text"?: str, "focus"?: str (one line), "student_id"?: int}
           One draft per piece, sharing a "batch" id. Multipart: any number of "files"
           (.pdf .docx .md .txt — one piece each; unreadable files are listed in "errors"),
           optional "rubric_file". A rubric document must be one the teacher can see in the Library.
  adapt    {"text": str, "title"?: str, "versions": [{"level"?: "grade_2".."grade_12"|"simpler"|
            "same_chunked", "student_id"?: int, "language"?: str}] (1 to 3)}
           A version needs a level or a student (the student's reading level is used when no
           level is given; their accommodations always apply). Multipart: "file" instead of
           "text", and "versions" as a JSON string (or "level"/"student_id"/"language" for one).
  email    {"student_id": int, "topic": str, "tone"?: "warm"|"neutral"|"firm" (default warm),
            "language"?: str (default "English"; the roster's home_language is a good suggestion)}

GET  /api/tools/{tool}/drafts?limit=30[&batch=<id>]
    → {"drafts": [DraftSummary, ...], "batch": BatchProgress|null}   newest first (batch: in order)
    BatchProgress = {"id", "total", "ready", "error", "active", "done": bool, "progress": 0..1}

GET    /api/drafts/{id}               → {"draft": Draft}
PUT    /api/drafts/{id}               {"output"?: <the tool's output shape>, "title"?: str,
                                       "transcript"?: [{"text": str}, ...] (meeting; same length)}
                                      → {"draft": Draft}; 409 while queued/running (output edits)
POST   /api/drafts/{id}/approve       → {"draft": Draft}; the teacher signs off. Meeting: the
                                      recording is DELETED now (transcript and notes are kept).
                                      409 unless status is "ready".
POST   /api/drafts/{id}/retry         → {"draft": Draft}; runs the job again (status error or ready;
                                      replaces the output, including teacher edits)
DELETE /api/drafts/{id}               → {"ok": true}; also deletes any recording

POST /api/meetings/{id}/audio         the recording, whole or in chunks (keep each request ≤ ~8 MB)
    multipart/form-data: "file" (+ optional "offset", "final", "consent" fields), or a raw
    body (Content-Type audio/* or application/octet-stream) with ?offset=&final=&consent=.
    offset = bytes already received (0 starts over); final=true (default) ends the upload
    and queues transcription. Accepted: WebM/Ogg (browser MediaRecorder), M4A, MP3, WAV,
    up to 200 MB in total (detected from the bytes, not the name).
    → {"draft": Draft, "received": int}
    400 no consent / empty · 409 wrong offset {"error", "received": int} or meeting already
    has its recording · 413 over 200 MB · 415 not an accepted audio format.

Draft (GET /api/drafts/{id}):
    {"id", "tool", "title", "status": "awaiting_audio"|"queued"|"running"|"ready"|"error",
     "stage": ""|"starting"|"waiting"|"transcribing"|"writing", "progress": 0..1, "error": str,
     "queue_position": int|null (while queued), "student": {"id": int|null, "name"}|null,
     "batch": str|null, "model": str, "created_at", "updated_at", "edited_at", "approved_at",
     "input": {...what was asked, incl. the student snapshot...}, "output": {...}|null,
     meeting only: "meeting_type", "source": "audio"|"paste", "has_audio": bool, "audio_bytes": int,
                   "transcript": [{"i", "start": sec|null, "end": sec|null, "text"}]|null,
                   "sections": [{"key", "title", "kind": "text"|"items"|"actions"}],
     email only:   "mailto": "mailto:?subject=…&body=…"|null}
DraftSummary: the same without input/output/transcript/sections/mailto, plus "preview": str.

Outputs ("output"):
  meeting  {"meeting_type", "summary": str, <section key>: [{"text", "refs": [segment index]}], ...,
            "action_items": [{"owner", "task", "due": str|null, "refs": [int]}]}
           Section keys per type are in "sections" (and GET /api/tools). refs index "transcript";
           use transcript[i].start for the timestamp chip.
  feedback {"strengths": [Item, Item], "next_steps": [Item, Item], "focus": str, "dropped": int}
           Item = {"comment", "quote" (exact text from the work), "span": [start, end] (character
           offsets into input.work)|null, "rubric_line": int (1-based into input.rubric.lines),
           "rubric": str}. Quotes are verified against the work; items that don't check out are
           dropped ("dropped" counts them).
  adapt    {"original": {"words", "grade": float|null}, "versions": [{"label", "level", "language",
            "student": {"id", "name"}|null, "title", "text" ("## " headings, blank-line paragraphs),
            "glossary": [{"term", "meaning"}], "changes": str (for the teacher),
            "readability": {"words", "grade": float|null}}]}
  email    {"subject", "body", "language"}
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from .. import deps
from ..config import Settings
from ..db import connect
from ..llm import Runtime
from ..services import ingest
from ..services.models import resolve_tool_model
from ..services.tools import TOOLS, NotFound, ToolWorker, adapt, audio, drafts, feedback, meeting
from ..services.tools.common import describe_error

router = APIRouter(prefix="/api", tags=["tools"])
DRAFT_NOT_FOUND = "Draft not found."
# Routes that write commit before returning: the tools worker writes from the event loop,
# and must never wait on a lock held by a request whose teardown needs that same loop.
MAX_DOC_UPLOAD = 10 * 1024 * 1024
CHUNK_HINT = 8 * 1024 * 1024
CONSENT = "Confirm that everyone in the recording agreed to be recorded."


def _tool(tool: str):
    if tool not in TOOLS:
        raise HTTPException(404, "Unknown tool.")
    return drafts.MODULES[tool]


def _owned(db: sqlite3.Connection, draft_id: int, user: sqlite3.Row) -> sqlite3.Row:
    row = drafts.get(db, draft_id, user["id"])
    if row is None:
        raise HTTPException(404, DRAFT_NOT_FOUND)
    return row


def _view(db: sqlite3.Connection, draft_id: int) -> dict:
    row = db.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
    return drafts.serialize(row, queue=drafts.queue_positions(db))


@router.get("/tools")
def tools_meta(_: sqlite3.Row = Depends(deps.current_user)):
    return {
        "tools": list(TOOLS),
        "meeting_types": [{"key": k, "label": t.label, "sections": meeting.layout(k)} for k, t in meeting.TYPES.items()],
        "adapt_levels": [{"key": k, "label": v} for k, v in adapt.LEVELS.items()],
        "email_tones": ["warm", "neutral", "firm"],
        "audio": {"accept": list(audio.EXTENSIONS), "max_bytes": audio.MAX_AUDIO_BYTES, "chunk_bytes": CHUNK_HINT},
        "limits": {"feedback_pieces": feedback.MAX_PIECES, "work_chars": feedback.MAX_WORK,
                   "reading_chars": adapt.MAX_CHARS, "adapt_versions": 3},
    }


# -- create ---------------------------------------------------------------------------

def _field(form, key: str) -> str | None:
    v = form.get(key)
    return v if isinstance(v, str) and v.strip() != "" else None


async def _read_doc(f: UploadFile) -> tuple[str, str]:
    """(title, text) of an uploaded document; raises ingest.IngestError."""
    name = Path(f.filename or "document.txt").name
    data = await f.read()
    if len(data) > MAX_DOC_UPLOAD:
        raise ingest.IngestError("File is larger than 10 MB.")
    pages = ingest.parse_file(name, data)
    text = "\n\n".join(p.text for p in pages).strip()
    if not text:
        raise ingest.IngestError("No text found in this file.")
    return Path(name).stem.replace("_", " ").replace("-", " ").strip(), text


async def _from_form(tool: str, form) -> tuple[dict, list[dict], UploadFile | None]:
    """Multipart → (request fields, per-file errors, meeting audio)."""
    plain = {k: v for k, v in form.multi_items() if isinstance(v, str) and v.strip() != ""}
    errors: list[dict] = []
    upload = None
    if tool == "meeting":
        upload = form.get("audio") if isinstance(form.get("audio"), UploadFile) else None
        tf = form.get("transcript_file")
        if isinstance(tf, UploadFile):
            raw = await tf.read()
            plain["transcript_text"] = raw.decode("utf-8", errors="replace")
    elif tool == "feedback":
        works = []
        for f in form.getlist("files"):
            if not isinstance(f, UploadFile):
                continue
            try:
                title, text = await _read_doc(f)
            except ingest.IngestError as e:
                errors.append({"filename": f.filename or "file", "error": str(e)})
                continue
            if len(text) > feedback.MAX_WORK:
                errors.append({"filename": f.filename or "file",
                               "error": f"Longer than {feedback.MAX_WORK:,} characters; split it into pieces."})
                continue
            works.append({"title": title, "text": text})
        plain["works"] = works
        rf = form.get("rubric_file")
        if isinstance(rf, UploadFile):
            try:
                plain["rubric_text"] = (await _read_doc(rf))[1]
            except ingest.IngestError as e:
                raise HTTPException(400, f"Rubric: {e}") from e
    elif tool == "adapt":
        f = form.get("file")
        if isinstance(f, UploadFile):
            try:
                title, plain["text"] = await _read_doc(f)
            except ingest.IngestError as e:
                raise HTTPException(400, str(e)) from e
            plain.setdefault("title", title)
        if "versions" in plain:
            try:
                plain["versions"] = json.loads(plain["versions"])
            except json.JSONDecodeError as e:
                raise HTTPException(400, "versions must be a JSON list.") from e
        else:
            plain["versions"] = [{k: plain.pop(k) for k in ("level", "student_id", "language") if k in plain}]
    return plain, errors, upload


@router.post("/tools/{tool}/drafts")
async def create_draft(
    tool: str,
    request: Request,
    user: sqlite3.Row = Depends(deps.current_user),
    runtime: Runtime = Depends(deps.runtime),
    settings: Settings = Depends(deps.settings),
    worker: ToolWorker = Depends(deps.tools),
):
    module = _tool(tool)
    errors: list[dict] = []
    upload = None
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form(max_files=feedback.MAX_PIECES + 5)
        try:
            payload, errors, upload = await _from_form(tool, form)
        except BaseException:
            await form.close()
            raise
    else:
        try:
            payload = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise HTTPException(400, "Send JSON or a form.") from e
        form = None
    try:
        try:
            req = module.Request.model_validate(payload)
        except ValidationError as e:
            raise HTTPException(422, describe_error(e)) from e
        model = await resolve_tool_model(runtime, req.model)
        with connect(settings.db_path) as db:
            try:
                prepared = module.prepare(db, user, req)
            except NotFound as e:
                raise HTTPException(404, str(e)) from e
            except ValueError as e:
                if tool == "feedback" and errors:
                    raise HTTPException(400, f"{e} ({errors[0]['filename']}: {errors[0]['error']})") from e
                raise HTTPException(400, str(e)) from e
            batch = uuid.uuid4().hex[:12] if len(prepared) > 1 else None
            waiting = tool == "meeting" and prepared[0].transcript is None
            ids = [drafts.create(db, user["id"], tool, p, model=model, batch_id=batch,
                                 status="awaiting_audio" if waiting else "queued") for p in prepared]
        if upload is not None:
            if not req.consent:
                _discard(settings, ids[0])
                raise HTTPException(400, CONSENT)
            try:
                await _receive(settings, ids[0], _file_chunks(upload), offset=0, final=True)
            except _AudioProblem as e:
                _discard(settings, ids[0])
                return e.response()
    finally:
        if form is not None:
            await form.close()
    worker.kick()
    with connect(settings.db_path) as db:
        queue = drafts.queue_positions(db)
        rows = [db.execute("SELECT * FROM drafts WHERE id = ?", (i,)).fetchone() for i in ids]
    views = [drafts.serialize(r, queue=queue) for r in rows]
    return {"draft": views[0], "drafts": views, "batch": batch, "errors": errors}


def _discard(settings: Settings, draft_id: int) -> None:
    with connect(settings.db_path) as db:
        row = db.execute("SELECT audio_path FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row:
            audio.remove(settings.audio_dir, row["audio_path"])
        db.execute("DELETE FROM drafts WHERE id = ?", (draft_id,))


# -- list / read / edit ---------------------------------------------------------------

@router.get("/tools/{tool}/drafts")
def list_drafts(
    tool: str,
    batch: str | None = None,
    limit: int = 30,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
):
    _tool(tool)
    rows = drafts.recent(db, user["id"], tool, batch=batch, limit=min(max(limit, 1), 100))
    queue = drafts.queue_positions(db)
    return {"drafts": [drafts.serialize(r, full=False, queue=queue) for r in rows],
            "batch": drafts.batch_summary(rows) if batch else None}


@router.get("/drafts/{draft_id}")
def get_draft(
    draft_id: int,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
):
    row = _owned(db, draft_id, user)
    return {"draft": drafts.serialize(row, queue=drafts.queue_positions(db))}


class SegmentEdit(BaseModel):
    text: str = Field(max_length=5000)


class DraftEdit(BaseModel):
    output: dict | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    transcript: list[SegmentEdit] | None = None


@router.put("/drafts/{draft_id}")
def edit_draft(
    draft_id: int,
    body: DraftEdit,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
):
    row = _owned(db, draft_id, user)
    if (body.output is not None or body.transcript is not None) and row["status"] in drafts.ACTIVE:
        raise HTTPException(409, "This draft is still being written.")
    if body.title is not None:
        db.execute("UPDATE drafts SET title = ?, updated_at = datetime('now') WHERE id = ?",
                   (" ".join(body.title.split()), draft_id))
    if body.transcript is not None:
        segs = json.loads(row["transcript_json"]) if row["transcript_json"] else None
        if row["tool"] != "meeting" or segs is None:
            raise HTTPException(400, "This draft has no transcript.")
        if len(body.transcript) != len(segs):
            raise HTTPException(400, "Send every transcript line (edit the text only).")
        for seg, edit in zip(segs, body.transcript):
            seg["text"] = " ".join(edit.text.split())
        db.execute("UPDATE drafts SET transcript_json = ?, edited_at = datetime('now'), "
                   "updated_at = datetime('now') WHERE id = ?", (json.dumps(segs), draft_id))
    if body.output is not None:
        if row["status"] != "ready":
            raise HTTPException(409, "Only a finished draft can be edited.")
        module = drafts.MODULES[row["tool"]]
        current = db.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        try:
            output = module.validate_output(body.output, drafts.job(current, Path("/nonexistent")))
        except ValidationError as e:
            raise HTTPException(400, describe_error(e)) from e
        db.execute("UPDATE drafts SET output_json = ?, edited_at = datetime('now'), updated_at = datetime('now') "
                   "WHERE id = ?", (json.dumps(output), draft_id))
    db.commit()  # before returning: the worker (event loop) must never wait on this request's lock
    return {"draft": _view(db, draft_id)}


@router.post("/drafts/{draft_id}/approve")
def approve_draft(
    draft_id: int,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
    settings: Settings = Depends(deps.settings),
):
    row = _owned(db, draft_id, user)
    if row["status"] != "ready":
        raise HTTPException(409, "Only a finished draft can be approved.")
    audio.remove(settings.audio_dir, row["audio_path"])  # the recording goes; transcript + notes stay
    db.execute("UPDATE drafts SET approved_at = datetime('now'), audio_path = NULL, audio_bytes = 0, "
               "updated_at = datetime('now') WHERE id = ?", (draft_id,))
    db.commit()
    return {"draft": _view(db, draft_id)}


@router.post("/drafts/{draft_id}/retry")
def retry_draft(
    draft_id: int,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
    worker: ToolWorker = Depends(deps.tools),
):
    row = _owned(db, draft_id, user)
    if row["status"] not in ("ready", "error"):
        raise HTTPException(409, "This draft is already being written." if row["status"] in drafts.ACTIVE
                            else "Upload the recording first.")
    if row["tool"] == "meeting" and not row["transcript_json"] and not row["audio_path"]:
        raise HTTPException(409, "The recording is gone. Upload it again, or paste a transcript.")
    db.execute("UPDATE drafts SET status = 'queued', stage = '', error = '', progress = 0, "
               "updated_at = datetime('now') WHERE id = ?", (draft_id,))
    db.commit()
    worker.kick()
    return {"draft": _view(db, draft_id)}


@router.delete("/drafts/{draft_id}")
def delete_draft(
    draft_id: int,
    user: sqlite3.Row = Depends(deps.current_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
    settings: Settings = Depends(deps.settings),
    worker: ToolWorker = Depends(deps.tools),
):
    row = _owned(db, draft_id, user)
    worker.cancel(draft_id)
    audio.remove(settings.audio_dir, row["audio_path"])
    db.execute("DELETE FROM drafts WHERE id = ?", (draft_id,))
    db.commit()
    return {"ok": True}


# -- meeting audio --------------------------------------------------------------------

class _AudioProblem(Exception):
    def __init__(self, status: int, message: str, received: int | None = None) -> None:
        super().__init__(message)
        self.status, self.message, self.received = status, message, received

    def response(self) -> JSONResponse:
        body: dict = {"error": self.message}
        if self.received is not None:
            body["received"] = self.received
        return JSONResponse(body, status_code=self.status)


async def _file_chunks(f: UploadFile, size: int = 1 << 20) -> AsyncIterator[bytes]:
    while chunk := await f.read(size):
        yield chunk


def _truthy(v, default: bool) -> bool:
    if v is None or v == "":
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on")


async def _receive(settings: Settings, draft_id: int, chunks: AsyncIterator[bytes], *, offset: int,
                   final: bool) -> int:
    """Append one upload to the draft's recording; on `final`, queue transcription."""
    with connect(settings.db_path) as db:
        row = db.execute("SELECT audio_path, audio_bytes FROM drafts WHERE id = ?", (draft_id,)).fetchone()
    name, have = row["audio_path"], int(row["audio_bytes"] or 0)
    if offset != 0 and (offset != have or not name):
        raise _AudioProblem(409, f"Upload out of order: send from byte {have}.", received=have)
    it = chunks.__aiter__()
    pending = b""
    if offset == 0:
        async for chunk in it:
            pending += chunk
            if len(pending) >= audio.SNIFF_BYTES:
                break
        if not pending:
            raise _AudioProblem(400, "The recording is empty.")
        ext = audio.sniff(pending)
        if ext is None:
            raise _AudioProblem(415, f"That file isn't a recording we can read. Use {audio.ACCEPTED}.")
        audio.remove(settings.audio_dir, name)
        name = audio.file_name(draft_id, ext)
    settings.audio_dir.mkdir(parents=True, exist_ok=True)
    path = settings.audio_dir / name
    total = offset
    fh = await run_in_threadpool(open, path, "wb" if offset == 0 else "ab")
    try:
        async for chunk in _prepend(pending, it):
            total += len(chunk)
            if total > audio.MAX_AUDIO_BYTES:
                raise _AudioProblem(413, "The recording is larger than 200 MB.")
            await run_in_threadpool(fh.write, chunk)
    except _AudioProblem:
        await run_in_threadpool(fh.close)
        path.unlink(missing_ok=True)
        with connect(settings.db_path) as db:
            db.execute("UPDATE drafts SET audio_path = NULL, audio_bytes = 0 WHERE id = ?", (draft_id,))
        raise
    finally:
        if not fh.closed:
            await run_in_threadpool(fh.close)
    with connect(settings.db_path) as db:
        if final:
            db.execute("UPDATE drafts SET audio_path = ?, audio_bytes = ?, status = 'queued', stage = '', "
                       "error = '', progress = 0, updated_at = datetime('now') WHERE id = ?",
                       (name, total, draft_id))
        else:
            db.execute("UPDATE drafts SET audio_path = ?, audio_bytes = ?, updated_at = datetime('now') "
                       "WHERE id = ?", (name, total, draft_id))
    return total


async def _prepend(first: bytes, rest: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
    if first:
        yield first
    async for chunk in rest:
        if chunk:
            yield chunk


@router.post("/meetings/{draft_id}/audio")
async def upload_audio(
    draft_id: int,
    request: Request,
    offset: int = 0,
    final: str | None = None,
    consent: str | None = None,
    user: sqlite3.Row = Depends(deps.current_user),
    settings: Settings = Depends(deps.settings),
    worker: ToolWorker = Depends(deps.tools),
):
    with connect(settings.db_path) as db:
        row = _owned(db, draft_id, user)
    if row["tool"] != "meeting":
        raise HTTPException(404, DRAFT_NOT_FOUND)
    if row["transcript_json"] or row["status"] not in ("awaiting_audio", "error"):
        raise HTTPException(409, "This meeting already has its recording.")
    form = None
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form(max_files=1)
        f = form.get("file") or form.get("audio")
        if not isinstance(f, UploadFile):
            await form.close()
            raise HTTPException(400, "Attach the recording as the 'file' field.")
        offset = int(_field(form, "offset") or offset)
        final = _field(form, "final") or final
        consent = _field(form, "consent") or consent
        chunks = _file_chunks(f)
    else:
        chunks = request.stream()
    try:
        inp = json.loads(row["input_json"])
        if _truthy(consent, False) and not inp.get("consent"):
            inp["consent"] = True
            with connect(settings.db_path) as db:
                db.execute("UPDATE drafts SET input_json = ? WHERE id = ?", (json.dumps(inp), draft_id))
        if not inp.get("consent"):
            raise HTTPException(400, CONSENT)
        try:
            received = await _receive(settings, draft_id, chunks, offset=max(offset, 0),
                                      final=_truthy(final, True))
        except _AudioProblem as e:
            return e.response()
    finally:
        if form is not None:
            await form.close()
    if _truthy(final, True):
        worker.kick()
    with connect(settings.db_path) as db:
        return {"draft": _view(db, draft_id), "received": received}
