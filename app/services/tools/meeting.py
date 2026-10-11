"""Meeting notes: recording (or pasted transcript) → transcript segments → structured
notes for the meeting type. Every item cites the transcript lines it came from (`refs`,
segment indices), which the UI turns into timestamp chips.

Long meetings are written part by part (each part fits a small model's context), then
merged; the summary is rewritten once from the part summaries.

The teacher's own notepad (typed while recording) is the backbone of the notes: items that
come from it are marked `mine`, which the server checks against the notepad's wording rather
than taking the model's word for it. With the Mac app's call audio the transcript has two
speakers, "You" (microphone) and "Others" (the call). `ask` answers a question about one
meeting from its transcript, citing lines."""

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
ASK_CHARS = 8_000             # transcript shown when answering a question
NOTEPAD_PROMPT_CHARS = 6_000  # the teacher's notes as shown to the model
MAX_NOTEPAD = 20_000
MAX_QUESTION = 500
NOT_HEARD = "I didn't hear that in the meeting."
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
    mine: bool = False  # from the teacher's own notes (verified against them)


class Action(BaseModel):
    owner: str = Field(default="", max_length=120)
    task: str = Field(min_length=1, max_length=1500)
    due: str | None = Field(default=None, max_length=120)
    refs: list[int] = Field(default_factory=list, max_length=40)
    mine: bool = False


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
    """`[i] (01:23) You: text` — the time and speaker only when known."""
    out = []
    for i, s in enumerate(segments):
        when = f"({_clock(s['start'])}) " if s.get("start") is not None else ""
        who = f"{s['speaker']}: " if s.get("speaker") else ""
        out.append(f"[{i}] {when}{who}{s['text']}")
    return out


def has_speakers(segments: list[dict]) -> bool:
    return any(s.get("speaker") for s in segments)


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


def _speaker_line(speakers: bool) -> str:
    if speakers:
        return ("The transcript comes from speech-to-text and may mishear words. Each line is numbered and "
                "says who spoke: \"You\" is the teacher's microphone, \"Others\" is everyone on the call: "
                "[n] (time) You: text.\n\n")
    return ("The transcript comes from speech-to-text: it has no speaker labels and may mishear words. Each "
            "line is numbered: [n] (time) text.\n\n")


def _notepad_rules(my_notes: str) -> str:
    if not my_notes.strip():
        return "- Set \"mine\" to false on every item.\n"
    return ("- <my_notes> are the teacher's own notes, typed during the meeting. Keep their wording and order "
            "where possible; they are the backbone. Add what the transcript shows that they missed. Set "
            "\"mine\": true only on items that come from the teacher's notes, false on items you added from "
            "the transcript. Still cite the transcript lines that back an item in \"refs\".\n")


def system_prompt(inp: dict, part: tuple[int, int] = (1, 1), speakers: bool = False) -> str:
    t = TYPES[inp["meeting_type"]]
    sections = "".join(f"- {s.key}: {s.guide}\n" for s in t.sections)
    example = ", ".join(['"summary": "..."',
                         *[f'"{s.key}": [{{"text": "...", "refs": [3], "mine": false}}]' for s in t.sections],
                         '"action_items": [{"owner": "...", "task": "...", "due": null, "refs": [5], '
                         '"mine": false}]'])
    k, n = part
    part_line = (f"- This is part {k} of {n} of a long meeting. Write notes for this part only; line numbers "
                 "continue from earlier parts. The summary covers this part.\n" if n > 1 else "")
    return (
        f"Teacher's Desk — Meeting notes ({t.label})\n\n"
        f"You turn a meeting transcript into the notes {inp['teacher']} keeps for their records. The teacher "
        "checks every item against the recording before approving, so accuracy matters more than polish.\n\n"
        f"{t.guide}\n\n"
        f"{_student_line(inp.get('student'))}"
        f"{_speaker_line(speakers)}"
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
        f"{_notepad_rules(inp.get('my_notes') or '')}"
        f"{part_line}\n"
        "Sections:\n"
        f"- summary: {t.summary_guide}\n"
        f"{sections}"
        f"- action_items: {t.actions_guide}\n\n"
        f"Reply with only a JSON object with exactly these keys: {{{example}}}"
    )


def _notepad_block(my_notes: str) -> str:
    notes = (my_notes or "").strip()
    if not notes:
        return ""
    if len(notes) > NOTEPAD_PROMPT_CHARS:
        notes = notes[:NOTEPAD_PROMPT_CHARS].rstrip() + "\n…"
    return f"<my_notes>\n{notes}\n</my_notes>\n"


def user_prompt(lines: list[str], my_notes: str = "") -> str:
    return _notepad_block(my_notes) + "<transcript>\n" + "\n".join(lines) + "\n</transcript>\nWrite the notes."


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


# -- the teacher's own wording ------------------------------------------------------------

_WORD = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")
STOPWORDS = frozenset("""
a an the and or but nor so yet if then than as at by for from in into of off on onto out over to up
with about after before during since until via per is are was were be been being am has have had do
does did will would shall should can could may might must not no yes it its it's this that these those
there here we i you he she they me us him her them my our your his their mine ours yours theirs who
whom whose which what when where why how all any both each few more most other some such only own
same too very just also again once ok okay well really get got going go said say says
""".split())


def content_words(text: str) -> set[str]:
    """Lowercased words that carry meaning: no stopwords, possessives and plurals folded."""
    out = set()
    for w in _WORD.findall(text.casefold().replace("’", "'")):
        if w.endswith("'s"):
            w = w[:-2]
        w = w.split("'")[0]
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        if w and w not in STOPWORDS:
            out.add(w)
    return out


def shares_wording(text: str, note_words: set[str]) -> bool:
    """True when at least half of `text`'s content words appear in the teacher's notes."""
    words = content_words(text)
    if not words or not note_words:
        return False
    return len(words & note_words) * 2 >= len(words)


# -- job ------------------------------------------------------------------------------

def _clean(notes: BaseModel, t: MeetingType, n_segments: int, my_notes: str = "") -> dict:
    data = notes.model_dump()
    note_words = content_words(my_notes)

    def refs(r: list[int]) -> list[int]:
        return sorted({int(i) for i in r if 0 <= int(i) < n_segments})

    def mine(claimed: bool, text: str) -> bool:  # the model's claim, checked against the notepad
        return bool(claimed) and shares_wording(text, note_words)

    out: dict = {"summary": " ".join(str(data.get("summary") or "").split())}
    for s in t.sections:
        out[s.key] = [{"text": text, "refs": refs(i["refs"]), "mine": mine(i["mine"], text)}
                      for i in data.get(s.key, []) if (text := " ".join(i["text"].split()))]
    out["action_items"] = [{"owner": " ".join(a["owner"].split()), "task": task,
                            "due": (a["due"] or "").strip() or None, "refs": refs(a["refs"]),
                            "mine": mine(a["mine"], task)}
                           for a in data.get("action_items", []) if (task := " ".join(a["task"].split()))]
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
    """Speech-to-text of the recording. With a call track too, both are transcribed and
    merged in time order, each line labeled "You" (microphone) or "Others" (call)."""
    path: Path | None = draft.get("audio_file")
    if path is None or not path.exists():
        raise ToolError("The recording is missing. Upload it again, or paste a transcript.")
    assert ctx.transcribe is not None and ctx.save_transcript is not None
    call: Path | None = draft.get("call_audio_file")
    tracks = [(path, "You"), *([(call, "Others")] if call is not None and call.exists() else [])]
    language, prompt = draft["input"].get("language"), whisper_prompt(draft["input"])
    transcript: list[dict] = []
    for k, (track, speaker) in enumerate(tracks):
        ctx.progress("transcribing", 0.05 + 0.4 * k / len(tracks))
        segments = await ctx.transcribe(track, language=language, prompt=prompt)
        for s in segments:
            if s.text.strip():
                seg = {"start": s.start, "end": s.end, "text": s.text}
                if len(tracks) > 1:
                    seg["speaker"] = speaker
                transcript.append(seg)
    transcript.sort(key=lambda s: s["start"] or 0.0)  # stable: the microphone first on a tie
    if not transcript:
        raise ToolError("No speech was found in the recording.")
    ctx.save_transcript(transcript)
    return transcript


async def run(ctx: JobContext, draft: dict) -> dict:
    inp = draft["input"]
    t = TYPES[inp["meeting_type"]]
    my_notes = str(inp.get("my_notes") or "")
    transcript = draft.get("transcript")
    base = 0.0
    if transcript is None:
        transcript = await transcribe(ctx, draft)
        base = 0.5
    parts_lines = windows(transcript_lines(transcript))
    speakers = has_speakers(transcript)
    model = NOTES_MODELS[t.key]
    n = len(parts_lines)
    parts = []
    for k, lines in enumerate(parts_lines, start=1):
        ctx.progress("writing", base + (1 - base) * (k - 1) / (n + (1 if n > 1 else 0)))
        notes = await generate_json(ctx, [ChatMessage("system", system_prompt(inp, (k, n), speakers)),
                                          ChatMessage("user", user_prompt(lines, my_notes))], model,
                                    temperature=0.2)
        parts.append(_clean(notes, t, len(transcript), my_notes))
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
    return {"meeting_type": t.key, **out, "my_notes": my_notes}


def validate_output(output: dict, draft: dict) -> dict:
    t = TYPES[draft["input"]["meeting_type"]]
    notes = NOTES_MODELS[t.key].model_validate(output)
    n = len(draft.get("transcript") or [])
    my_notes = output.get("my_notes")
    if not isinstance(my_notes, str):
        my_notes = str(draft["input"].get("my_notes") or "")
    my_notes = my_notes[:MAX_NOTEPAD]
    return {"meeting_type": t.key, **_clean(notes, t, n, my_notes), "my_notes": my_notes}


# -- ask about a meeting --------------------------------------------------------------

class Question(BaseModel):
    question: str = Field(min_length=1, max_length=MAX_QUESTION)

    @field_validator("question")
    @classmethod
    def _text(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Ask a question.")
        return v


class MeetingAnswer(BaseModel):
    answer: str = Field(min_length=1, max_length=3000)
    refs: list[int] = Field(default_factory=list, max_length=20)


def relevant_lines(transcript: list[dict], question: str, max_chars: int = ASK_CHARS) -> list[str]:
    """The transcript lines to answer from: all of them if they fit, otherwise the lines
    sharing the most words with the question, with a little context around each, in
    transcript order ("…" marks what was left out)."""
    lines = transcript_lines(transcript)
    if sum(len(x) + 1 for x in lines) <= max_chars:
        return lines
    asked = content_words(question)
    scores = [len(content_words(s["text"]) & asked) for s in transcript]
    order = sorted((i for i in range(len(lines)) if scores[i]), key=lambda i: (-scores[i], i))
    if not order:
        order = list(range(len(lines)))  # nothing matches: the start of the meeting
    picked: set[int] = set()
    size = 0
    for i in order:
        for j in range(max(0, i - 2), min(len(lines), i + 3)):
            if j not in picked and size + len(lines[j]) + 1 <= max_chars:
                picked.add(j)
                size += len(lines[j]) + 1
        if size >= max_chars * 0.95:
            break
    out: list[str] = []
    prev = -1
    for j in sorted(picked):
        if j != prev + 1:
            out.append("…")
        out.append(lines[j])
        prev = j
    return out


def ask_prompt(inp: dict, speakers: bool = False) -> str:
    t = TYPES[inp["meeting_type"]]
    return (
        f"Teacher's Desk — Ask about a meeting ({t.label})\n\n"
        f"{inp['teacher']} is asking about one meeting. Answer from the transcript (and the teacher's own notes, "
        "if given) only.\n\n"
        f"{_student_line(inp.get('student'))}"
        f"{_speaker_line(speakers)}"
        "Rules:\n"
        "- Use only what the transcript says. Never guess or add facts, opinions or advice.\n"
        "- Answer in one to three plain sentences, in English.\n"
        "- List in \"refs\" the line numbers the answer comes from (e.g. [12, 13]).\n"
        f"- If the transcript doesn't answer the question, reply exactly \"{NOT_HEARD}\" with refs [].\n\n"
        'Reply with only a JSON object: {"answer": "...", "refs": [3]}'
    )


async def ask(ctx: JobContext, draft: dict, question: str) -> dict:
    """{"answer", "refs"}: refs are transcript indices that exist."""
    transcript = draft["transcript"] or []
    lines = relevant_lines(transcript, question)
    user = (_notepad_block(str(draft["input"].get("my_notes") or "")) + "<transcript>\n" + "\n".join(lines)
            + f"\n</transcript>\n<question>\n{question}\n</question>")
    reply = await generate_json(ctx, [ChatMessage("system", ask_prompt(draft["input"], has_speakers(transcript))),
                                      ChatMessage("user", user)], MeetingAnswer, temperature=0.1)
    answer = " ".join(reply.answer.split())
    if answer.rstrip(".").casefold() == NOT_HEARD.rstrip(".").casefold():
        return {"answer": NOT_HEARD, "refs": []}
    refs = sorted({int(i) for i in reply.refs if 0 <= int(i) < len(transcript)})
    return {"answer": answer, "refs": refs}
