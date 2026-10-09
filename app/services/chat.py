"""Grounded chat: retrieve → assemble numbered sources → stream → validate citations.

The model only sees sources the user is allowed to see (documents + their own roster),
every claim must cite one, and citations are checked server-side before saving.
"""

from __future__ import annotations

import asyncio
import json
import re
import sqlite3
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass
from datetime import date

from ..db import connect
from ..llm import ChatMessage, Runtime, RuntimeError_
from . import embeddings, retrieval, roster

DOC_K = 6
MAX_STUDENTS = 80
HISTORY_TURNS = 6
WARM_AFTER_S = 6.0
EMBED_TIMEOUT_S = 20.0

NOT_FOUND = "I couldn't find that in your documents or roster."

_ROSTER_HINT = re.compile(
    r"\b(student|students|kid|kids|class|classes|period|section|roster|accommodat\w*|iep|504|"
    r"ell|el|english learner|reading level|lexile|extended|case manager|caseload|my \d\w* period|"
    r"who|which of my|home language|plan review)\b",
    re.I,
)
_CITE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")


@dataclass
class Source:
    n: int
    kind: str  # "document" | "student"
    title: str
    subtitle: str
    text: str
    document_id: int | None = None
    chunk_id: int | None = None
    page: int | None = None
    student_id: int | None = None

    def prompt_block(self) -> str:
        label = "Document" if self.kind == "document" else "Roster"
        sub = f" — {self.subtitle}" if self.subtitle else ""
        return f"[{self.n}] {label}: {self.title}{sub}\n{self.text.strip()}\n"


# -- source assembly ------------------------------------------------------------------

def wants_roster(question: str, names: list[str]) -> bool:
    return bool(_ROSTER_HINT.search(question)) or bool(match_students(question, names))


def match_students(question: str, names: list[str]) -> set[str]:
    q = question.lower()
    hits = set()
    for full in names:
        parts = [full] + [p for p in full.split() if len(p) >= 3]
        if any(re.search(rf"\b{re.escape(p.lower())}\b", q) for p in parts):
            hits.add(full)
    return hits


def build_sources(
    db: sqlite3.Connection,
    user: sqlite3.Row,
    question: str,
    *,
    space_id: int | None,
    query_vec: list[float] | None,
) -> list[Source]:
    sources: list[Source] = []
    for h in retrieval.hybrid_search(db, question, k=DOC_K, space_id=space_id, query_vec=query_vec):
        sub = " · ".join(x for x in (f"p. {h.page}" if h.page else "", h.heading) if x)
        sources.append(Source(len(sources) + 1, "document", h.title, sub, h.text,
                              document_id=h.document_id, chunk_id=h.chunk_id, page=h.page))

    students = roster.students_for(db, user)
    names = [s["name"] for s in students]
    if students and wants_roster(question, names):
        named = match_students(question, names)
        chosen = [s for s in students if s["name"] in named] if named else students[:MAX_STUDENTS]
        for s in chosen:
            sub = s["section_name"] + (f" · Period {s['period']}" if s["period"] else "")
            sources.append(Source(len(sources) + 1, "student", s["name"], sub, roster.student_card(s),
                                  student_id=s["id"]))
    return sources


def system_prompt(user: sqlite3.Row, sources: list[Source], today: date) -> str:
    body = "\n".join(s.prompt_block() for s in sources) if sources else "(no sources matched)\n"
    return (
        f"You are the Local School assistant, helping {user['name']} ({user['role']}). "
        f"Today is {today:%A, %B} {today.day}, {today.year} ({today.isoformat()}).\n\n"
        "Answer using ONLY the numbered sources below.\n"
        "Rules:\n"
        "- Cite every factual statement with its source number in square brackets, e.g. [2]. "
        "Use several when needed, e.g. [1][3].\n"
        f"- If the sources don't contain the answer, reply exactly: \"{NOT_FOUND}\" and, if useful, "
        "name the kind of document that would answer it. Never guess facts about students, "
        "dates, or policies.\n"
        "- Lead with the direct answer, then short bullets if helpful. Be concise.\n"
        "- Use student names exactly as written. Compare dates against today's date.\n"
        "- Brief greetings or thanks may be answered without sources.\n\n"
        f"Sources:\n{body}"
    )


# -- citations ------------------------------------------------------------------------

def validate_citations(text: str, sources: list[Source]) -> tuple[str, list[Source]]:
    """Drop citation numbers that don't exist; return cleaned text + sources actually cited."""
    valid = {s.n: s for s in sources}
    used: list[int] = []

    def fix(m: re.Match) -> str:
        nums = [int(x) for x in re.split(r"\s*,\s*", m.group(1))]
        keep = [n for n in nums if n in valid]
        for n in keep:
            if n not in used:
                used.append(n)
        return "".join(f"[{n}]" for n in keep)

    cleaned = _CITE.sub(fix, text)
    cleaned = re.sub(r"[ \t]+([.,;:])", r"\1", cleaned).strip()
    return cleaned, [valid[n] for n in used]


# -- conversation storage -------------------------------------------------------------

def _conversation(db: sqlite3.Connection, user_id: int, conversation_id: int | None, question: str) -> int:
    if conversation_id is not None:
        row = db.execute(
            "SELECT id FROM conversations WHERE id = ? AND user_id = ?", (conversation_id, user_id)
        ).fetchone()
        if row:
            return int(row["id"])
    title = re.sub(r"\s+", " ", question).strip()
    title = title if len(title) <= 60 else title[:57].rstrip() + "…"
    return int(db.execute(
        "INSERT INTO conversations(user_id, title) VALUES (?, ?)", (user_id, title)
    ).lastrowid)


def _history(db: sqlite3.Connection, conversation_id: int) -> list[ChatMessage]:
    rows = db.execute(
        "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
        (conversation_id, HISTORY_TURNS),
    ).fetchall()
    return [ChatMessage(r["role"], r["content"]) for r in reversed(rows)]


# -- main entry -----------------------------------------------------------------------

async def answer(
    runtime: Runtime,
    user: sqlite3.Row,
    question: str,
    conversation_id: int | None = None,
    *,
    today: date | None = None,
) -> AsyncIterator[dict]:
    question = question.strip()
    if not question:
        yield {"type": "error", "message": "Ask a question to get started."}
        return
    today = today or date.today()
    chat_model = runtime.active_model("chat")
    embed_model = runtime.active_model("embed")

    with connect(runtime.db_path) as db:
        conv_id = _conversation(db, user["id"], conversation_id, question)
        history = _history(db, conv_id)
        db.execute(
            "INSERT INTO messages(conversation_id, role, content) VALUES (?, 'user', ?)", (conv_id, question)
        )
        db.execute("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", (conv_id,))
        space = embeddings.get_space(db, embed_model)
    yield {"type": "conversation", "id": conv_id}

    # Query vector (best effort — keyword search alone still works)
    query_vec = None
    if space is not None:
        try:
            provider = await runtime.provider()
            query_vec = (await asyncio.wait_for(provider.embed(embed_model, [question]), EMBED_TIMEOUT_S))[0]
        except (RuntimeError_, asyncio.TimeoutError, IndexError):
            query_vec = None

    with connect(runtime.db_path) as db:
        sources = build_sources(db, user, question, space_id=space["id"] if space else None,
                                query_vec=query_vec)
    yield {"type": "sources", "sources": [asdict(s) for s in sources]}

    messages = [ChatMessage("system", system_prompt(user, sources, today)), *history,
                ChatMessage("user", question)]

    # Wait for a generation slot so one GPU isn't oversubscribed.
    if runtime.generation_slots.locked():
        runtime.waiting += 1
        yield {"type": "queued", "position": runtime.waiting}
        try:
            await runtime.generation_slots.acquire()
        finally:
            runtime.waiting -= 1
    else:
        await runtime.generation_slots.acquire()

    parts: list[str] = []
    try:
        provider = await runtime.provider()
        stream = provider.chat(chat_model, messages).__aiter__()
        warned = False
        while True:
            nxt = asyncio.ensure_future(stream.__anext__())
            if not parts and not warned:
                done, _ = await asyncio.wait({nxt}, timeout=WARM_AFTER_S)
                if not done:
                    warned = True
                    yield {"type": "status", "status": "warming",
                           "message": "Waking up the GPU — the first answer can take a minute."}
            try:
                piece = await nxt
            except StopAsyncIteration:
                break
            parts.append(piece)
            yield {"type": "token", "text": piece}
    except RuntimeError_ as e:
        runtime.note_error(str(e))
        yield {"type": "error", "message": str(e)}
        return
    finally:
        runtime.generation_slots.release()
    runtime.note_ok()

    content, cited = validate_citations("".join(parts), sources)
    if not content:
        content = NOT_FOUND
    with connect(runtime.db_path) as db:
        msg_id = int(db.execute(
            "INSERT INTO messages(conversation_id, role, content, sources_json, model) "
            "VALUES (?, 'assistant', ?, ?, ?)",
            (conv_id, content, json.dumps([asdict(s) for s in cited]), chat_model),
        ).lastrowid)
    yield {"type": "done", "message_id": msg_id, "content": content,
           "sources": [asdict(s) for s in cited], "model": chat_model}
