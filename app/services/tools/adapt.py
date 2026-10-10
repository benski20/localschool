"""Adapt a reading: rewrite a text for a reading level or for one student (their
accommodations applied), optionally in another language, with a short glossary.
Up to three versions side by side; each is one model call."""

from __future__ import annotations

import sqlite3

from pydantic import BaseModel, Field, field_validator

from ...llm import ChatMessage
from .common import (JobContext, Prepared, clip, generate_json, grade_estimate, grade_number, scoped_student,
                     short_name, word_count)

TOOL = "adapt"
MAX_CHARS = 12_000  # ~2,000 words: the reading and its rewrite both fit an 8k context
LEVELS = {f"grade_{n}": f"Grade {n}" for n in range(2, 13)} | {
    "simpler": "Simpler", "same_chunked": "Same level, chunked"}
ENGLISH = ("", "english", "en")


class Version(BaseModel):
    level: str | None = None          # grade_2 … grade_12 | simpler | same_chunked
    student_id: int | None = None     # their accommodations (and reading level, if no level)
    language: str | None = Field(default=None, max_length=40)

    @field_validator("level")
    @classmethod
    def _level(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        if v not in LEVELS:
            raise ValueError(f"level must be one of: {', '.join(LEVELS)}")
        return v


class Request(BaseModel):
    text: str = Field(min_length=20, max_length=MAX_CHARS)
    title: str = Field(default="", max_length=200)
    versions: list[Version] = Field(min_length=1, max_length=3)
    model: str | None = Field(default=None, max_length=200)


class GlossaryItem(BaseModel):
    term: str = Field(min_length=1, max_length=120)
    meaning: str = Field(min_length=1, max_length=400)


class AdaptedReading(BaseModel):
    title: str = Field(default="", max_length=300)
    text: str = Field(min_length=1)
    glossary: list[GlossaryItem] = Field(default_factory=list, max_length=12)
    changes: str = Field(default="", max_length=1000)


class VersionOut(AdaptedReading):
    label: str
    level: str
    language: str = ""
    student: dict | None = None  # {"id", "name"}
    readability: dict = Field(default_factory=dict)  # {"grade": float|None, "words": int}


class Output(BaseModel):
    original: dict = Field(default_factory=dict)  # {"words", "grade"}
    versions: list[VersionOut] = Field(min_length=1, max_length=3)


def prepare(db: sqlite3.Connection, user: sqlite3.Row, req: Request) -> list[Prepared]:
    versions, students = [], set()
    for v in req.versions:
        student = scoped_student(db, user, v.student_id)
        level = v.level
        if level is None and student:
            n = grade_number(student["reading_level"])
            level = f"grade_{min(max(n, 2), 12)}" if n is not None else "simpler"
        if level is None:
            raise ValueError("Choose a reading level or a student for each version.")
        language = (v.language or "").strip()
        bilingual = student and any("bilingual" in a.lower() for a in student["accommodations"])
        glossary_language = (student["home_language"] if bilingual and language.lower() in ENGLISH
                             and student["home_language"].lower() not in ENGLISH else "")
        label = LEVELS[level]
        if student:
            label = f"For {short_name(student)} · {label}"
        if language and language.lower() not in ENGLISH:
            label += f" · {language}"
        versions.append({"level": level, "label": label, "language": language, "student": student,
                         "glossary_language": glossary_language})
        if student:
            students.add(student["id"])
    title = req.title.strip() or clip(req.text.strip().splitlines()[0].lstrip("# "), 60)
    original = {"words": word_count(req.text), "grade": grade_estimate(req.text)}
    only = next((v["student"] for v in versions if v["student"]), None) if len(students) == 1 else None
    return [Prepared(title=title, input={"title": req.title.strip(), "text": req.text.strip(), "versions": versions,
                                         "original": original, "teacher": user["name"], "student": only},
                     student_id=only["id"] if only else None)]


_BANDS = [
    (3, "Most sentences 5 to 10 words, one idea each. Everyday words a seven-year-old knows. "
        "Paragraphs of 2 or 3 sentences."),
    (5, "Most sentences 8 to 14 words. Common words; explain any harder word right in the "
        "sentence. Paragraphs of 3 or 4 sentences."),
    (8, "Most sentences 10 to 18 words. Keep subject vocabulary, explained in context. Start "
        "each paragraph with a clear topic sentence."),
    (12, "Sentences up to about 22 words. Keep academic vocabulary; untangle dense or abstract "
         "sentences and split the longest ones."),
]


def _band(grade: int) -> str:
    return next(rule for top, rule in _BANDS if grade <= top)


def _target(version: dict, original: dict) -> tuple[str, int | None]:
    """(target description, target grade or None)."""
    level, orig = version["level"], original.get("grade")
    if level == "same_chunked":
        return ("Same reading level as the original. Keep its wording as much as you can, but break it "
                "into short chunks of 2 to 4 sentences, each under a '## ' heading that says what the "
                "chunk is about, and end each chunk with one short line starting 'Check:' — a question "
                "a student can answer from that chunk."), None
    if level == "simpler":
        grade = max(2, round(orig) - 2) if orig else 5
        about = f" (the original reads at about grade {round(orig)}; aim for about grade {grade})" if orig else ""
        return (f"Noticeably easier than the original{about}. {_band(grade)}"), grade
    grade = int(level.split("_")[1])
    return f"A grade {grade} reading level. {_band(grade)}", grade


def _length_goal(version: dict, original: dict, target_grade: int | None) -> int | None:
    """Words to stay under when the version should come out shorter than the original."""
    orig = original.get("grade")
    if version["level"] == "same_chunked" or target_grade is None:
        return None
    if version["level"] == "simpler" or (orig is not None and target_grade < orig - 0.5):
        return max(40, round(original["words"] * 0.75))
    return None


def _supports(student: dict) -> list[str]:
    acc = " ".join(student["accommodations"]).lower()
    out = []
    if "chunk" in acc:
        out.append("Break the text into short chunks under '## ' headings.")
    if "graphic organizer" in acc:
        out.append("End with a '## Key ideas' section: 3 to 5 short bullet points that sum up the reading.")
    if "sentence frame" in acc:
        out.append("End with a '## Talk about it' section: 2 sentence frames the student can complete "
                   "(e.g. 'One reason ___ is ___.').")
    if "picture" in acc:
        out.append("Where a picture would help, add a line like '[Picture: a volcano erupting]' so the "
                   "teacher can add one.")
    if "read-aloud" in acc or "read aloud" in acc:
        out.append("Make it read aloud smoothly: no tables, spell out symbols and abbreviations.")
    if student["el_level"]:
        out.append(f"The student is an English learner ({student['el_level']}): prefer common words, avoid "
                   "idioms and phrasal verbs, and keep sentence patterns simple and consistent.")
    return out


def system_prompt(inp: dict, version: dict) -> str:
    original = inp["original"]
    target, grade = _target(version, original)
    goal = _length_goal(version, original, grade)
    length = (f"- Make it shorter than the original: about {goal} words or fewer (the original has "
              f"{original['words']}). Cut side details and repetition before key ideas.\n" if goal else
              "- About the same length as the original.\n")
    language = version["language"]
    if language and language.lower() not in ENGLISH:
        lang = (f"- Write the title, the text and the glossary in {language}, as a fluent native speaker "
                f"would — natural, not word-for-word. Each glossary term is the {language} word followed by "
                f"the English word in parentheses. Write \"changes\" in English, for the teacher.\n")
    elif version["glossary_language"]:
        lang = (f"- Write in English. End each glossary meaning with the word in {version['glossary_language']} "
                f"in parentheses, e.g. \"(In {version['glossary_language']}: …)\".\n")
    else:
        lang = ""
    student = version["student"]
    support = ""
    if student:
        lines = _supports(student)
        level = f" (reading level: {student['reading_level']})" if student["reading_level"] else ""
        support = (f"\nThis version is for one student{level}. Build in these supports, without naming the "
                   "student or mentioning any plan or accommodation in the text:\n"
                   + ("".join(f"- {x}\n" for x in lines) if lines else "- None beyond the reading level.\n"))
    return (
        "Teacher's Desk — Adapt a reading\n\n"
        f"You adapt a reading for {inp['teacher']}'s students. The teacher will check your version "
        "before sharing it, so it must stay accurate to the original.\n\n"
        f"Target: {target}\n\n"
        "Rules:\n"
        "- Keep every key idea, fact, name, number and date, in the original order. Don't add facts, "
        "opinions, examples or conclusions that aren't in the original.\n"
        f"{length}"
        "- Keep names and essential subject words (like \"photosynthesis\"); explain each in simple "
        "words the first time it appears, and put it in the glossary.\n"
        "- Short paragraphs separated by a blank line. Keep the title and section headings (simplified "
        "if needed); headings are lines starting with '## '.\n"
        "- Write for students. No notes to the teacher inside the text.\n"
        "- Glossary: 3 to 8 key words from your version that a student at this level might not know, "
        "each with a short, student-friendly meaning (under 15 words).\n"
        f"{lang}"
        "- \"changes\": one or two sentences telling the teacher what you changed (e.g. \"Split long "
        "sentences, explained 'erosion', cut the side note about mining.\").\n"
        f"{support}\n"
        'Reply with only a JSON object: {"title": "...", "text": "...", "glossary": [{"term": "...", '
        '"meaning": "..."}], "changes": "..."} (the text uses \\n for line breaks).'
    )


def user_prompt(inp: dict) -> str:
    title = f"<title>{inp['title']}</title>\n" if inp["title"] else ""
    return f"{title}<reading>\n{inp['text']}\n</reading>\nAdapt this reading."


async def run(ctx: JobContext, draft: dict) -> dict:
    inp = draft["input"]
    original = inp["original"]
    out = []
    n = len(inp["versions"])
    for i, version in enumerate(inp["versions"]):
        ctx.progress("writing", i / n)
        _, grade = _target(version, original)
        goal = _length_goal(version, original, grade)

        english = (version["language"] or "").lower() in ENGLISH

        def check(r: AdaptedReading, goal=goal, grade=grade, english=english) -> list[str]:
            problems = []
            words = word_count(r.text)
            if goal and words > goal * 1.15:
                problems.append(f"Your version has {words} words; it must be shorter, about {goal} words or fewer.")
            reads = grade_estimate(r.text) if english and grade else None
            if reads is not None and reads > grade + 2:
                problems.append(
                    f"Your version reads at about grade {round(reads)}, but the target is grade {grade}. "
                    f"Rewrite it much more simply: {_band(grade)} Split every long sentence.")
            return problems

        reply = await generate_json(ctx, [ChatMessage("system", system_prompt(inp, version)),
                                          ChatMessage("user", user_prompt(inp))],
                                    AdaptedReading, check=check, temperature=0.3)
        student = version["student"]
        out.append(VersionOut(
            **reply.model_dump(), label=version["label"], level=version["level"], language=version["language"],
            student={"id": student["id"], "name": student["name"]} if student else None,
            readability={"words": word_count(reply.text), "grade": grade_estimate(reply.text) if english else None},
        ))
    return Output(original=original, versions=out).model_dump()


def validate_output(output: dict, draft: dict) -> dict:
    out = Output.model_validate(output)
    for v in out.versions:
        english = (v.language or "").lower() in ENGLISH
        v.readability = {"words": word_count(v.text), "grade": grade_estimate(v.text) if english else None}
    return out.model_dump()
