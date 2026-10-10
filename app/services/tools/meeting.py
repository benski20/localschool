"""Meeting notes: recording (or pasted transcript) → transcript segments → structured
notes for the meeting type. Every item cites the transcript lines it came from (`refs`,
segment indices), which the UI turns into timestamp chips.

Long meetings are written part by part (each part fits a small model's context), then
merged; the summary is rewritten once from the part summaries."""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, Field, create_model, field_validator

from ...llm import ChatMessage
from .common import JobContext, Prepared, ToolError, clip, generate_json, scoped_student

TOOL = "meeting"
WINDOW_CHARS = 8_000          # transcript per model call (~2k tokens)
MAX_TRANSCRIPT_CHARS = 600_000
MAX_SEGMENTS = 20_000


@dataclass(frozen=True)
class Section:
    key: str
    title: str
    guide: str


@dataclass(frozen=True)
class MeetingType:
    key: str
    label: str
    guide: str
    sections: tuple[Section, ...]
    summary_guide: str = "2 to 4 sentences: why the meeting was held and its main outcomes."
    actions_guide: str = "Who will do what, and by when if a time was said."


_OPEN = Section("open_questions", "Open questions",
                "Questions or issues left unresolved, or anything unclear that needs following up.")

TYPES: dict[str, MeetingType] = {t.key: t for t in (
    MeetingType(
        "iep", "IEP meeting",
        "These are the teacher's working notes from an IEP meeting, not the official IEP document. Record "
        "what the team discussed and agreed; don't make eligibility, placement or legal determinations "
        "beyond what the team itself stated.",
        (
            Section("present_levels", "Progress and present levels",
                    "Progress and current performance that was reported (academic, behavior, social, "
                    "communication), as stated, including any data mentioned."),
            Section("decisions", "Decisions", "What the team agreed or decided: goals, services, placement, "
                    "changes to the plan."),
            Section("services_discussed", "Services discussed",
                    "Services discussed: what (e.g. reading support, speech), how often, who provides it, "
                    "and whether it is new, continuing or changing."),
            Section("accommodations", "Accommodations and supports",
                    "Accommodations and supports discussed: kept, added, changed or removed."),
            Section("family_input", "Family and student input",
                    "What the parent, guardian or student shared: concerns, priorities, questions."),
            _OPEN,
        ),
    ),
    MeetingType(
        "parent_conference", "Parent conference",
        "A conference between the teacher and a student's family. Capture what each side shared and what "
        "you agreed on, in a tone the teacher could share with the family.",
        (
            Section("strengths", "Strengths and progress", "Strengths and progress shared about the student."),
            Section("concerns", "Concerns", "Concerns raised, and by whom if clear."),
            Section("family_input", "What the family shared",
                    "What the family shared: home context, goals for the student, questions."),
            Section("agreements", "Agreements", "What the teacher and family agreed to try or change."),
            _OPEN,
        ),
        actions_guide="Next steps for the teacher, the family and the student, and when if a time was said.",
    ),
    MeetingType(
        "sst", "Student support team",
        "A student support team (SST / MTSS) meeting about one student's needs. Be precise about data and "
        "about the plan: what support, how often, who, for how long, and how progress will be checked.",
        (
            Section("concerns", "Concerns", "The concerns that brought the student to the team, with any data "
                    "mentioned (grades, attendance, assessment results, behavior counts) exactly as stated."),
            Section("data_reviewed", "Data reviewed", "Data, work samples or observations the team reviewed."),
            Section("interventions", "Interventions planned",
                    "Interventions or supports planned: what, how often, who provides it, for how long, and "
                    "how progress will be monitored — only the parts that were said."),
            Section("decisions", "Decisions", "Decisions, including when the team will meet again."),
            _OPEN,
        ),
    ),
    MeetingType(
        "plc", "Team / PLC",
        "A teacher team or PLC meeting. Students may come up in groups; name an individual student only "
        "when the transcript does.",
        (
            Section("topics", "Topics", "The topics discussed, one item each."),
            Section("data_reviewed", "Student work and data",
                    "Student work or data the team looked at, and what the team noticed."),
            Section("decisions", "Decisions", "Decisions and agreements (common assessments, pacing, "
                    "instructional moves, norms)."),
            Section("open_questions", "Questions and parking lot", "Questions raised and items set aside "
                    "for later."),
        ),
    ),
    MeetingType(
        "other", "Other meeting",
        "A school meeting. Capture the main points, decisions and next steps.",
        (
            Section("key_points", "Key points", "The main points discussed, one item each."),
            Section("decisions", "Decisions", "What was decided or agreed."),
            _OPEN,
        ),
    ),
)}


class Item(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    refs: list[int] = Field(default_factory=list, max_length=40)


class Action(BaseModel):
    owner: str = Field(default="", max_length=120)
    task: str = Field(min_length=1, max_length=1500)
    due: str | None = Field(default=None, max_length=120)
    refs: list[int] = Field(default_factory=list, max_length=40)


class MeetingSummary(BaseModel):
    summary: str = Field(min_length=1, max_length=3000)


def notes_model(t: MeetingType) -> type[BaseModel]:
    fields: dict = {"summary": (str, Field(default="", max_length=3000))}
    for s in t.sections:
        fields[s.key] = (list[Item], Field(default_factory=list, max_length=40))
    fields["action_items"] = (list[Action], Field(default_factory=list, max_length=60))
    return create_model(f"MeetingNotes_{t.key}", **fields)


NOTES_MODELS = {k: notes_model(t) for k, t in TYPES.items()}


def layout(meeting_type: str) -> list[dict]:
    """How the UI renders a type's notes: ordered sections of the output object."""
    t = TYPES[meeting_type]
    return ([{"key": "summary", "title": "Summary", "kind": "text"}]
            + [{"key": s.key, "title": s.title, "kind": "items"} for s in t.sections]
            + [{"key": "action_items", "title": "Action items", "kind": "actions"}])


# -- requests and transcripts ---------------------------------------------------------

class Request(BaseModel):
    meeting_type: str = "other"
    student_id: int | None = None
    title: str = Field(default="", max_length=200)
    transcript_text: str | None = Field(default=None, max_length=MAX_TRANSCRIPT_CHARS)  # "Paste a transcript"
    language: str | None = Field(default=None, max_length=10)  # spoken language hint, e.g. "en"
    consent: bool = False  # "Everyone here has agreed to be recorded" (required for audio)
    model: str | None = Field(default=None, max_length=200)

    @field_validator("meeting_type")
    @classmethod
    def _type(cls, v: str) -> str:
        if v not in TYPES:
            raise ValueError(f"meeting_type must be one of: {', '.join(TYPES)}")
        return v


_TS = r"(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?"
_CUE = re.compile(rf"^({_TS})\s*-->\s*({_TS})")
_LEAD = re.compile(rf"^[\[(]?({_TS})[\])]?\s*[-–:]?\s+(.+)$")
_TAGS = re.compile(r"<[^>]+>")


def _seconds(ts: str) -> float:
    parts = ts.replace(",", ".").split(":")
    out = 0.0
    for p in parts:
        out = out * 60 + float(p)
    return round(out, 2)


def parse_transcript(text: str) -> list[dict]:
    """A pasted transcript → segments. Understands WebVTT/SRT cues (Zoom, Teams, Meet
    exports), lines that start with a timestamp ("[00:12] Ms. Rivera: …"), and plain lines
    (no times: start/end are null and the UI shows line numbers)."""
    segs: list[dict] = []
    cue: dict | None = None
    for raw in text.replace("\r\n", "\n").split("\n"):
        line = _TAGS.sub("", raw).strip()
        if not line:
            cue = None
            continue
        if line == "WEBVTT" or line.startswith(("NOTE ", "Kind:", "Language:")) or (line.isdigit() and cue is None):
            continue
        if m := _CUE.match(line):
            cue = {"start": _seconds(m.group(1)), "end": _seconds(m.group(2)), "text": ""}
            segs.append(cue)
            continue
        if cue is not None:
            cue["text"] = f"{cue['text']} {line}".strip()
            continue
        if m := _LEAD.match(line):
            segs.append({"start": _seconds(m.group(1)), "end": None, "text": m.group(2).strip()})
        else:
            segs.append({"start": None, "end": None, "text": line})
    segs = [s for s in segs if s["text"]]
    for a, b in zip(segs, segs[1:]):  # a timestamped line ends where the next begins
        if a["start"] is not None and a["end"] is None and b["start"] is not None:
            a["end"] = b["start"]
    for s in segs:
        if s["start"] is not None and s["end"] is None:
            s["end"] = s["start"]
    return segs[:MAX_SEGMENTS]


def prepare(db: sqlite3.Connection, user: sqlite3.Row, req: Request) -> list[Prepared]:
    student = scoped_student(db, user, req.student_id)
    t = TYPES[req.meeting_type]
    transcript = None
    if req.transcript_text is not None:
        transcript = parse_transcript(req.transcript_text)
        if not transcript:
            raise ValueError("The transcript is empty.")
    title = req.title.strip() or (f"{t.label} · {student['name']}" if student else t.label)
    return [Prepared(
        title=clip(title, 80),
        input={"meeting_type": t.key, "title": req.title.strip(), "student": student, "teacher": user["name"],
               "language": req.language or None, "source": "paste" if transcript else "audio",
               "consent": bool(req.consent)},
        student_id=student["id"] if student else None,
        transcript=transcript,
    )]


# -- prompts --------------------------------------------------------------------------

def _clock(s: float | None) -> str:
    if s is None:
        return ""
    h, rem = divmod(int(s), 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02}:{sec:02}" if h else f"{m:02}:{sec:02}"


def transcript_lines(segments: list[dict]) -> list[str]:
    return [f"[{i}] ({_clock(s['start'])}) {s['text']}" if s.get("start") is not None else f"[{i}] {s['text']}"
            for i, s in enumerate(segments)]


def windows(lines: list[str], max_chars: int = WINDOW_CHARS) -> list[list[str]]:
    out: list[list[str]] = [[]]
    size = 0
    for line in lines:
        if out[-1] and size + len(line) > max_chars:
            out.append([])
            size = 0
        out[-1].append(line)
        size += len(line) + 1
    return [w for w in out if w]


def _student_line(student: dict | None) -> str:
    if not student:
        return ""
    bits = [f"grade {student['grade']}" if student["grade"] else "", student["plan_type"] and f"{student['plan_type']}",
            student["case_manager"] and f"case manager {student['case_manager']}"]
    extra = ", ".join(b for b in bits if b)
    return (f"The meeting is about {student['name']}{f' ({extra})' if extra else ''}. Use this only to spell "
            "names correctly; never add anything that wasn't said in the meeting.\n\n")


def system_prompt(inp: dict, part: tuple[int, int] = (1, 1)) -> str:
    t = TYPES[inp["meeting_type"]]
    sections = "".join(f"- {s.key}: {s.guide}\n" for s in t.sections)
    example = ", ".join(['"summary": "..."', *[f'"{s.key}": [{{"text": "...", "refs": [3]}}]' for s in t.sections],
                         '"action_items": [{"owner": "...", "task": "...", "due": null, "refs": [5]}]'])
    k, n = part
    part_line = (f"- This is part {k} of {n} of a long meeting. Write notes for this part only; line numbers "
                 "continue from earlier parts. The summary covers this part.\n" if n > 1 else "")
    return (
        f"Teacher's Desk — Meeting notes ({t.label})\n\n"
        f"You turn a meeting transcript into the notes {inp['teacher']} keeps for their records. The teacher "
        "checks every item against the recording before approving, so accuracy matters more than polish.\n\n"
        f"{t.guide}\n\n"
        f"{_student_line(inp.get('student'))}"
        "The transcript comes from speech-to-text: it has no speaker labels and may mishear words. Each line is "
        "numbered: [n] (time) text.\n\n"
        "Rules:\n"
        "- Use only what was said. No facts, diagnoses, opinions or recommendations that nobody stated. If "
        "something is unclear or may be misheard, leave it out or put it in open questions.\n"
        "- Every item lists, in \"refs\", the line numbers it comes from (e.g. [12, 13]).\n"
        "- Plain, factual notes in English: short sentences, names and roles as said (\"Ms. Rivera will…\"). "
        "Say who said something only when the transcript makes the speaker clear.\n"
        "- Keep dates and times exactly as said (\"starting Monday\"); don't turn them into calendar dates.\n"
        "- action_items: owner as named (otherwise \"Teacher\", \"Family\", \"Team\" or \"Student\" if clear), "
        "the task, and due only if a time was said, else null.\n"
        "- Leave a section as [] when nothing fits. Don't pad, and don't repeat an item in two sections.\n"
        f"{part_line}\n"
        "Sections:\n"
        f"- summary: {t.summary_guide}\n"
        f"{sections}"
        f"- action_items: {t.actions_guide}\n\n"
        f"Reply with only a JSON object with exactly these keys: {{{example}}}"
    )


def user_prompt(lines: list[str]) -> str:
    return "<transcript>\n" + "\n".join(lines) + "\n</transcript>\nWrite the notes."


def summary_prompt(inp: dict) -> str:
    t = TYPES[inp["meeting_type"]]
    return (
        f"Teacher's Desk — Meeting notes ({t.label}): overall summary\n\n"
        "Below are summaries of consecutive parts of one meeting. Write the summary of the whole meeting "
        f"for {inp['teacher']}'s notes: {t.summary_guide} Use only what the part summaries say; plain, "
        "factual sentences.\n\n"
        'Reply with only a JSON object: {"summary": "..."}'
    )


def whisper_prompt(inp: dict) -> str:
    """Primes speech-to-text with the names it's likely to hear."""
    t = TYPES[inp["meeting_type"]]
    student = inp.get("student")
    names = [n for n in (student and student["name"], inp.get("teacher"), student and student["case_manager"]) if n]
    return f"{t.label}" + (f" with {', '.join(names)}." if names else ".")


# -- job ------------------------------------------------------------------------------

def _clean(notes: BaseModel, t: MeetingType, n_segments: int) -> dict:
    data = notes.model_dump()

    def refs(r: list[int]) -> list[int]:
        return sorted({int(i) for i in r if 0 <= int(i) < n_segments})

    out: dict = {"summary": " ".join(str(data.get("summary") or "").split())}
    for s in t.sections:
        out[s.key] = [{"text": " ".join(i["text"].split()), "refs": refs(i["refs"])}
                      for i in data.get(s.key, []) if i["text"].strip()]
    out["action_items"] = [{"owner": " ".join(a["owner"].split()), "task": " ".join(a["task"].split()),
                            "due": (a["due"] or "").strip() or None, "refs": refs(a["refs"])}
                           for a in data.get("action_items", []) if a["task"].strip()]
    return out


def _merge(parts: list[dict], t: MeetingType) -> dict:
    def key(x: str) -> str:
        return re.sub(r"\W+", " ", x.casefold()).strip()

    out: dict = {"summary": parts[0]["summary"] if parts else ""}
    for field, text_key in [*((s.key, "text") for s in t.sections), ("action_items", "task")]:
        seen, items = set(), []
        for p in parts:
            for item in p.get(field, []):
                k = key(item[text_key])
                if k and k not in seen:
                    seen.add(k)
                    items.append(item)
        out[field] = items
    return out


async def transcribe(ctx: JobContext, draft: dict) -> list[dict]:
    path: Path | None = draft.get("audio_file")
    if path is None or not path.exists():
        raise ToolError("The recording is missing. Upload it again, or paste a transcript.")
    assert ctx.transcribe is not None and ctx.save_transcript is not None
    ctx.progress("transcribing", 0.05)
    segments = await ctx.transcribe(path, language=draft["input"].get("language"),
                                    prompt=whisper_prompt(draft["input"]))
    transcript = [{"start": s.start, "end": s.end, "text": s.text} for s in segments if s.text.strip()]
    if not transcript:
        raise ToolError("No speech was found in the recording.")
    ctx.save_transcript(transcript)
    return transcript


async def run(ctx: JobContext, draft: dict) -> dict:
    inp = draft["input"]
    t = TYPES[inp["meeting_type"]]
    transcript = draft.get("transcript")
    base = 0.0
    if transcript is None:
        transcript = await transcribe(ctx, draft)
        base = 0.5
    parts_lines = windows(transcript_lines(transcript))
    model = NOTES_MODELS[t.key]
    n = len(parts_lines)
    parts = []
    for k, lines in enumerate(parts_lines, start=1):
        ctx.progress("writing", base + (1 - base) * (k - 1) / (n + (1 if n > 1 else 0)))
        notes = await generate_json(ctx, [ChatMessage("system", system_prompt(inp, (k, n))),
                                          ChatMessage("user", user_prompt(lines))], model, temperature=0.2)
        parts.append(_clean(notes, t, len(transcript)))
    out = _merge(parts, t)
    if n > 1:
        ctx.progress("writing", base + (1 - base) * n / (n + 1))
        summaries = "\n".join(f"- Part {i}: {p['summary']}" for i, p in enumerate(parts, start=1) if p["summary"])
        if summaries:
            reply = await generate_json(ctx, [ChatMessage("system", summary_prompt(inp)),
                                              ChatMessage("user", f"<partial_summaries>\n{summaries}\n"
                                                                  "</partial_summaries>")],
                                        MeetingSummary, temperature=0.2)
            out["summary"] = " ".join(reply.summary.split())
    return {"meeting_type": t.key, **out}


def validate_output(output: dict, draft: dict) -> dict:
    t = TYPES[draft["input"]["meeting_type"]]
    notes = NOTES_MODELS[t.key].model_validate(output)
    n = len(draft.get("transcript") or [])
    return {"meeting_type": t.key, **_clean(notes, t, n)}
