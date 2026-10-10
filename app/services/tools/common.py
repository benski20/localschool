"""What every teacher tool shares: strict-JSON generation with one repair retry, the
generation-slot discipline, verbatim-quote checking, student context and readability."""

from __future__ import annotations

import json
import re
import sqlite3
import unicodedata
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from ...llm import ChatMessage, Runtime, RuntimeError_

T = TypeVar("T", bound=BaseModel)

TOOLS = ("meeting", "feedback", "adapt", "email")

REPAIR = (
    "Your reply can't be used yet: {problem}\n"
    "Reply again with ONLY the corrected JSON object, in the same format. No other text."
)
FORMAT_FAILED = ("The AI's reply wasn't in the expected format, even after a retry. "
                 "Try again, or pick a different model.")


class ToolError(Exception):
    """A problem to show the teacher as the draft's error (plain language)."""


class NotFound(LookupError):
    """Something the request names isn't visible to this teacher (→ 404)."""


@dataclass
class Prepared:
    """One draft to create: what the job will need, snapshotted at request time."""

    title: str
    input: dict
    student_id: int | None = None
    transcript: list[dict] | None = None  # meetings: a pasted transcript (no audio needed)


def scoped_student(db: sqlite3.Connection, user: sqlite3.Row, student_id: int | None) -> dict | None:
    """The student's snapshot, via roster scoping only: a teacher can't target a student
    outside their own sections (NotFound, so the API can't confirm the student exists)."""
    if student_id is None:
        return None
    from .. import roster

    row = roster.student_for(db, user, int(student_id))
    if row is None:
        raise NotFound("Student not found in your roster.")
    return student_snapshot(row)


# -- JSON in, JSON out ----------------------------------------------------------------

def json_schema_for(cls: type[BaseModel]) -> dict:
    """The model's JSON schema with $refs inlined: runtimes that constrain decoding to a
    schema (Ollama `format`) handle a flat schema most reliably."""
    schema = cls.model_json_schema()
    defs = schema.pop("$defs", {})

    def inline(node):
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/$defs/"):
                return inline(dict(defs[ref.rsplit("/", 1)[1]]))
            return {k: inline(v) for k, v in node.items()}
        if isinstance(node, list):
            return [inline(v) for v in node]
        return node

    return inline(schema)


_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")


def extract_json(text: str) -> dict:
    """The JSON object in a model reply (tolerates code fences and chatter around it)."""
    s = _FENCE.sub("", text.strip())
    start, end = s.find("{"), s.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object found")
    data = json.loads(s[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError("expected a JSON object")
    return data


def describe_error(e: Exception) -> str:
    if isinstance(e, ValidationError):
        parts = []
        for err in e.errors()[:4]:
            where = ".".join(str(x) for x in err["loc"]) or "reply"
            parts.append(f"{where}: {err['msg']}")
        return "; ".join(parts)
    return str(e)[:200]


@dataclass
class JobContext:
    """Handed to a tool's `run`: which model, and how to report progress."""

    runtime: Runtime
    draft_id: int
    model: str
    report: Callable[[str, float | None], None]  # (stage, progress 0..1 or None = unchanged)
    stage: str = "writing"
    # meetings: speech-to-text (one at a time, see ToolWorker) and saving its result
    transcribe: Callable[..., Awaitable[list]] | None = None
    save_transcript: Callable[[list[dict]], None] | None = None

    def progress(self, stage: str, fraction: float | None = None) -> None:
        self.stage = stage
        self.report(stage, fraction)

    async def chat(self, messages: list[ChatMessage], schema: dict | None, temperature: float) -> str:
        """One model call inside a generation slot, shared with grounded chat, so tools
        never oversubscribe the GPU. While waiting the draft shows stage 'waiting'."""
        rt = self.runtime
        if rt.generation_slots.locked():
            rt.waiting += 1
            self.report("waiting", None)
            try:
                await rt.generation_slots.acquire()
            finally:
                rt.waiting -= 1
            self.report(self.stage, None)
        else:
            await rt.generation_slots.acquire()
        try:
            provider = await rt.provider()
            parts = [p async for p in provider.chat(self.model, messages, temperature=temperature,
                                                    json_schema=schema)]
        except RuntimeError_ as e:
            rt.note_error(str(e))
            raise
        finally:
            rt.generation_slots.release()
        rt.note_ok()
        return "".join(parts)


async def generate_json(
    ctx: JobContext,
    messages: list[ChatMessage],
    cls: type[T],
    *,
    check: Callable[[T], list[str]] | None = None,
    temperature: float = 0.2,
) -> T:
    """Ask for JSON shaped like `cls`, validate it, and on failure retry ONCE with the
    problem spelled out. `check` adds tool rules beyond the schema (e.g. quotes must be
    verbatim); a reply that parses but fails `check` is still usable if the retry is worse."""
    schema = json_schema_for(cls)
    convo = list(messages)
    best: tuple[int, T] | None = None
    for attempt in range(2):
        raw = await ctx.chat(convo, schema, temperature)
        try:
            obj = cls.model_validate(extract_json(raw))
        except (ValueError, ValidationError) as e:
            problem = f"it isn't valid JSON in the required format ({describe_error(e)})."
        else:
            problems = check(obj) if check else []
            if not problems:
                return obj
            if best is None or len(problems) < best[0]:
                best = (len(problems), obj)
            problem = " ".join(problems)
        if attempt == 0:
            convo = [*messages, ChatMessage("assistant", raw[:8000]),
                     ChatMessage("user", REPAIR.format(problem=problem))]
    if best is not None:
        return best[1]
    raise ToolError(FORMAT_FAILED)


# -- verbatim quotes ------------------------------------------------------------------

_PUNCT_MAP = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "′": "'",
    "“": '"', "”": '"', "„": '"', "″": '"',
    "–": "-", "—": "-", "‐": "-", "‑": "-", " ": " ",
})
_ELLIPSIS = ("...", "…")
_EDGE = " \t\n\"'“”‘’«»"


def _normalize(text: str) -> tuple[str, list[int]]:
    """Casefolded, whitespace-collapsed, typographically plain text, plus for each output
    character the index of the original character it came from."""
    out: list[str] = []
    where: list[int] = []
    space = True
    for i, ch in enumerate(text):
        for c in unicodedata.normalize("NFKC", ch).translate(_PUNCT_MAP).casefold():
            if c.isspace():
                if space:
                    continue
                c, space = " ", True
            else:
                space = False
            out.append(c)
            where.append(i)
    if out and out[-1] == " ":
        out.pop()
        where.pop()
    return "".join(out), where


def find_quote(work: str, quote: str) -> tuple[int, int] | None:
    """Where `quote` occurs in `work`, as (start, end) character offsets, or None.

    Verbatim means the same words in the same order: differences in case, whitespace,
    curly vs straight quotes and dashes, surrounding quote marks and a trailing period
    are forgiven; anything else (a changed word, an ellipsis) is not."""
    q = quote.strip().strip(_EDGE)
    if any(e in q for e in _ELLIPSIS):
        return None
    qn, _ = _normalize(q)
    qn = qn.strip(" \"'«».,;:!?")  # quote marks and end punctuation around the quote
    if len(qn) < 8 or len(qn.split()) < 2:
        return None
    wn, where = _normalize(work)
    pos = wn.find(qn)
    if pos < 0:
        return None
    return where[pos], where[pos + len(qn) - 1] + 1


# -- context --------------------------------------------------------------------------

def student_snapshot(s: sqlite3.Row) -> dict:
    """What a tool may know about a student (already roster-scoped by the caller)."""
    return {
        "id": s["id"],
        "name": s["name"],
        "first_name": s["name"].split()[0] if s["name"].split() else s["name"],
        "grade": s["grade"],
        "section": s["section_name"],
        "reading_level": s["reading_level"],
        "el_level": s["el_level"],
        "home_language": s["home_language"],
        "plan_type": s["plan_type"],
        "accommodations": [a for a in s["accommodations"].split("; ") if a],
        "case_manager": s["case_manager"],
    }


def short_name(student: dict) -> str:
    parts = student["name"].split()
    return f"{parts[0]} {parts[-1][0]}." if len(parts) > 1 else student["name"]


def grade_number(level: str) -> int | None:
    """'Grade 6' / '6' / 'grade_6' / 'K' → a number (K = 0), else None."""
    s = (level or "").strip().lower()
    if s in ("k", "kindergarten"):
        return 0
    m = re.search(r"\d{1,2}", s)
    return int(m.group(0)) if m else None


# -- readability ------------------------------------------------------------------------

_WORDS = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_SENT_END = re.compile(r"[.!?]+(?=\s|$)|\n\s*\n")


def _syllables(word: str) -> int:
    w = word.lower()
    groups = re.findall(r"[aeiouy]+", w)
    n = len(groups)
    if w.endswith("e") and not w.endswith(("le", "ee", "ye")) and n > 1:
        n -= 1
    return max(1, n)


def word_count(text: str) -> int:
    return len(text.split())


def grade_estimate(text: str) -> float | None:
    """Flesch–Kincaid grade level (English only; a rough guide, never shown as a score
    of the student's work)."""
    words = _WORDS.findall(text)
    if len(words) < 20:
        return None
    sentences = max(1, len([s for s in _SENT_END.split(text) if _WORDS.search(s)]))
    syll = sum(_syllables(w) for w in words)
    grade = 0.39 * len(words) / sentences + 11.8 * syll / len(words) - 15.59
    return round(min(max(grade, 0.0), 18.0), 1)


def clip(text: str, n: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"
