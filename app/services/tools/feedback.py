"""Feedback on student work: two strengths and two next steps, each quoting the work
word for word and citing the rubric line it relates to. Never a score or grade.

Receipts are checked server-side: an item whose quote isn't really in the work, or whose
rubric line doesn't exist, is dropped (after one retry that names the problem)."""

from __future__ import annotations

import re
import sqlite3

from pydantic import BaseModel, Field

from ...llm import ChatMessage
from ..retrieval import VISIBLE, visible_param
from .common import (JobContext, NotFound, Prepared, ToolError, clip, find_quote, generate_json,
                     scoped_student)

TOOL = "feedback"
MAX_WORK = 16_000      # one piece (~2,700 words)
MAX_RUBRIC = 20_000           # accepted input; only the first ~6,000 characters reach the prompt
RUBRIC_PROMPT_CHARS = 6_000
MAX_PIECES = 40
PER_KIND = 2

_SCORE = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:/|out of)\s*\d+\b|\b\d{1,3}\s?%|\b\d+\s*points?\b|"
    r"\b(?:score[ds]?|scoring|letter grade|grade of|graded)\b|"
    r"\b(?:meets|exceeds|approaching|below)\s+(?:the\s+)?(?:standards?|expectations)\b",
    re.I,
)


class Piece(BaseModel):
    title: str = Field(default="", max_length=200)
    text: str = Field(min_length=1, max_length=MAX_WORK)


class Request(BaseModel):
    work: str | None = Field(default=None, max_length=MAX_WORK)   # one pasted piece
    title: str = Field(default="", max_length=200)
    works: list[Piece] = Field(default_factory=list, max_length=MAX_PIECES)  # several pieces
    rubric_text: str | None = Field(default=None, max_length=MAX_RUBRIC)
    rubric_document_id: int | None = None
    focus: str = Field(default="", max_length=200)
    student_id: int | None = None
    model: str | None = Field(default=None, max_length=200)


class FeedbackItem(BaseModel):
    comment: str = Field(min_length=1, max_length=1200)
    quote: str = Field(min_length=1, max_length=600)
    rubric_line: int


class FeedbackReply(BaseModel):
    strengths: list[FeedbackItem] = Field(default_factory=list, max_length=6)
    next_steps: list[FeedbackItem] = Field(default_factory=list, max_length=6)


class OutItem(FeedbackItem):
    rubric: str = ""                 # the cited rubric line's text
    span: list[int] | None = None    # [start, end) of the quote in the work, for highlighting


class Output(BaseModel):
    strengths: list[OutItem] = Field(default_factory=list, max_length=6)
    next_steps: list[OutItem] = Field(default_factory=list, max_length=6)
    focus: str = ""
    dropped: int = 0                 # items removed because their quote or rubric line didn't check out


# -- inputs ---------------------------------------------------------------------------

def rubric_lines(text: str) -> list[str]:
    """Numbered rubric lines (R1, R2, …): one per criterion/descriptor line. Capped (80
    lines, ~6,000 characters) so the rubric plus a long essay fit an 8k context."""
    out: list[str] = []
    seen: set[str] = set()
    size = 0
    for raw in text.splitlines():
        if len(out) >= 80 or size > RUBRIC_PROMPT_CHARS:
            break
        line = re.sub(r"^\s*(?:#+|[-*•]|\d+[.)])\s*", "", raw).strip()
        if not line or set(line) <= set("|-: "):
            continue
        line = re.sub(r"\s*\|\s*", " | ", line.strip("| ")).strip()
        if len(line) < 3 or not re.search(r"[^\W\d_]", line):
            continue
        key = line.casefold()
        if key not in seen:
            seen.add(key)
            out.append(clip(line, 300))
            size += len(out[-1])
    return out


def rubric_from_document(db: sqlite3.Connection, user: sqlite3.Row, doc_id: int) -> tuple[str, str]:
    """(title, text) of a library document the teacher may see."""
    doc = db.execute(f"SELECT d.id, d.title FROM documents d WHERE d.id = ? AND {VISIBLE}",
                     (doc_id, visible_param(user["id"]))).fetchone()
    if not doc:
        raise NotFound("Rubric document not found.")
    parts, heading = [], None
    for c in db.execute("SELECT heading, text FROM chunks WHERE document_id = ? ORDER BY ord", (doc_id,)):
        if c["heading"] and c["heading"] != heading:
            heading = c["heading"]
            parts.append(heading)
        parts.append(c["text"])
    return doc["title"], "\n".join(parts)


def prepare(db: sqlite3.Connection, user: sqlite3.Row, req: Request) -> list[Prepared]:
    pieces = list(req.works)
    if req.work and req.work.strip():
        pieces.insert(0, Piece(title=req.title, text=req.work))
    pieces = [p for p in pieces if p.text.strip()]
    if not pieces:
        raise ValueError("Add the student's work: paste it or upload a file.")
    if len(pieces) > MAX_PIECES:
        raise ValueError(f"Up to {MAX_PIECES} pieces at a time.")
    if req.rubric_document_id is not None:
        rubric_title, text = rubric_from_document(db, user, req.rubric_document_id)
        rubric = {"document_id": req.rubric_document_id, "title": rubric_title}
    elif req.rubric_text and req.rubric_text.strip():
        text, rubric = req.rubric_text, {"document_id": None, "title": "Pasted rubric"}
    else:
        raise ValueError("Pick a rubric from the Library or paste one.")
    lines = rubric_lines(text)
    if not lines:
        raise ValueError("The rubric has no readable lines.")
    student = scoped_student(db, user, req.student_id)
    out = []
    for i, p in enumerate(pieces, start=1):
        title = p.title.strip() or (f"Piece {i}" if len(pieces) > 1 else "Pasted work")
        if student:
            title = f"{title} · {student['first_name']}"
        out.append(Prepared(
            title=clip(title, 80),
            input={"title": p.title.strip(), "work": p.text.strip(), "rubric": {**rubric, "lines": lines},
                   "focus": " ".join(req.focus.split()), "student": student, "teacher": user["name"]},
            student_id=student["id"] if student else None,
        ))
    return out


# -- prompt ---------------------------------------------------------------------------

def _student_guidance(student: dict | None) -> str:
    if not student:
        return ""
    lines = [f"- Address the student as {student['first_name']} or \"you\"."]
    if student["grade"]:
        lines.append(f"- Write so a grade {student['grade']} student understands every word.")
    if student["el_level"]:
        lines.append(f"- The student is an English learner ({student['el_level']}): short sentences, everyday "
                     "words, no idioms. Don't comment on English mistakes unless the rubric asks for it.")
    acc = " ".join(student["accommodations"]).lower()
    if "chunk" in acc or "flexible" in acc:
        lines.append("- Keep each next step to one small, doable step.")
    if "graphic organizer" in acc:
        lines.append("- A next step may suggest using a graphic organizer to plan.")
    if "sentence frame" in acc:
        lines.append("- A next step may offer a sentence starter the student can use.")
    lines.append("- Never mention a plan, accommodation, label or reading level in the feedback.")
    return "About this student (for tone only):\n" + "\n".join(lines) + "\n\n"


def system_prompt(inp: dict) -> str:
    focus = (f"The teacher wants this feedback to focus on: {inp['focus']}. At least one next step must "
             "address it.\n\n" if inp["focus"] else "")
    n = len(inp["rubric"]["lines"])
    return (
        "Teacher's Desk — Feedback on student work\n\n"
        f"You draft written feedback that {inp['teacher']}, the teacher, will review, edit and give to a "
        "student. Write in the teacher's voice, speaking directly to the student (\"you\"): warm, specific "
        "and honest.\n\n"
        "Rules:\n"
        f"- Exactly {PER_KIND} strengths and {PER_KIND} next steps.\n"
        "- Every item quotes ONE short passage copied exactly from the student's work: 4 to 25 words, "
        "character for character, keeping the student's own spelling, punctuation and mistakes. No \"...\", "
        "no added or changed words. A strength quotes what works; a next step quotes the place it is about. "
        "Use a different passage for each item.\n"
        f"- Every item gives the number of the rubric line it relates to (\"rubric_line\": 1 to {n}, the "
        "numbers after R in the rubric). Choose the line that best matches what the comment is about.\n"
        "- A strength says what the student did well and why it works, tied to that rubric line.\n"
        "- A next step is one concrete action for the next draft, starting with a verb (\"Add…\", \"Try…\", "
        "\"Explain…\"), and says how or where. Don't list everything that's wrong.\n"
        "- Never give a score, grade, level, points, percentage or rubric rating, and never say the work "
        "\"meets\", \"exceeds\" or is \"below\" a standard. This is feedback, not grading.\n"
        "- Comment only on what is actually in the work. Don't guess at what the student meant or invent "
        "content.\n"
        "- 1 to 3 sentences per comment, plain language.\n\n"
        f"{focus}{_student_guidance(inp['student'])}"
        'Reply with only a JSON object: {"strengths": [{"comment": "...", "quote": "...", "rubric_line": 1}, '
        '...], "next_steps": [{"comment": "...", "quote": "...", "rubric_line": 2}, ...]}'
    )


def user_prompt(inp: dict) -> str:
    rubric = "\n".join(f"R{i}: {line}" for i, line in enumerate(inp["rubric"]["lines"], start=1))
    title = f' title="{inp["title"]}"' if inp["title"] else ""
    return (f"<rubric>\n{rubric}\n</rubric>\n\n<student_work{title}>\n{inp['work']}\n</student_work>\n"
            "Write the feedback.")


# -- checking -------------------------------------------------------------------------

def _item_problem(item: FeedbackItem, work: str, n_lines: int) -> str | None:
    if find_quote(work, item.quote) is None:
        return f"the quote \"{clip(item.quote, 80)}\" is not in the student's work word for word"
    if not 1 <= item.rubric_line <= n_lines:
        return f"rubric_line {item.rubric_line} doesn't exist (use 1 to {n_lines})"
    if _SCORE.search(item.comment):
        return f"the comment \"{clip(item.comment, 60)}\" gives a score or rating"
    return None


def _checker(work: str, n_lines: int):
    def check(reply: FeedbackReply) -> list[str]:
        problems = []
        for kind, items in (("strengths", reply.strengths), ("next_steps", reply.next_steps)):
            valid = 0
            for item in items:
                p = _item_problem(item, work, n_lines)
                if p:
                    problems.append(f"In {kind}, {p}.")
                else:
                    valid += 1
            if valid < PER_KIND:
                problems.append(f"Give exactly {PER_KIND} {kind.replace('_', ' ')}, each quoting the work exactly.")
        return problems

    return check


def _keep(items: list[FeedbackItem], work: str, lines: list[str]) -> tuple[list[OutItem], int]:
    kept, dropped, quotes = [], 0, set()
    for item in items:
        span = find_quote(work, item.quote)
        if _item_problem(item, work, len(lines)) or span is None or span in quotes:
            dropped += 1
            continue
        quotes.add(span)
        if len(kept) < PER_KIND:
            kept.append(OutItem(comment=item.comment.strip(), quote=work[span[0]:span[1]],
                                rubric_line=item.rubric_line, rubric=lines[item.rubric_line - 1],
                                span=list(span)))
    return kept, dropped


async def run(ctx: JobContext, draft: dict) -> dict:
    inp = draft["input"]
    work, lines = inp["work"], inp["rubric"]["lines"]
    ctx.progress("writing", 0.1)
    reply = await generate_json(ctx, [ChatMessage("system", system_prompt(inp)),
                                      ChatMessage("user", user_prompt(inp))],
                                FeedbackReply, check=_checker(work, len(lines)), temperature=0.3)
    strengths, d1 = _keep(reply.strengths, work, lines)
    next_steps, d2 = _keep(reply.next_steps, work, lines)
    if not strengths and not next_steps:
        raise ToolError("The AI couldn't quote this work accurately, so no feedback was kept. "
                        "Try again, or pick a different model.")
    return Output(strengths=strengths, next_steps=next_steps, focus=inp["focus"], dropped=d1 + d2).model_dump()


def validate_output(output: dict, draft: dict) -> dict:
    """Teacher edits: the teacher is the author, so any text is allowed; spans and rubric
    text are recomputed so highlights stay truthful."""
    out = Output.model_validate({"focus": draft["input"].get("focus", ""), **output})
    work, lines = draft["input"]["work"], draft["input"]["rubric"]["lines"]
    for item in [*out.strengths, *out.next_steps]:
        span = find_quote(work, item.quote)
        item.span = list(span) if span else None
        item.rubric = lines[item.rubric_line - 1] if 1 <= item.rubric_line <= len(lines) else ""
    return out.model_dump()
