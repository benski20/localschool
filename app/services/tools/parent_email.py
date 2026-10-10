"""Parent email: a draft from the teacher to a student's family. Never sent by us; the
teacher copies it or opens it in their own mail app."""

from __future__ import annotations

import sqlite3
from typing import Literal
from urllib.parse import quote

from pydantic import BaseModel, Field, field_validator

from ...llm import ChatMessage
from .common import JobContext, Prepared, clip, generate_json, scoped_student

TOOL = "email"
TONES = ("warm", "neutral", "firm")

_TONE = {
    "warm": ("Warm and encouraging: friendly, appreciative of the family as a partner, and "
             "hopeful. Lead with something genuine about the student if the topic allows."),
    "neutral": "Neutral and informative: clear, calm and concise. Just the facts and the next step.",
    "firm": ("Firm and respectful: state the concern and the expectation plainly, say exactly "
             "what happens next and what you need from the family. No blame, no sarcasm, no "
             "threats, and no softening that hides the message."),
}


class Request(BaseModel):
    student_id: int
    topic: str = Field(min_length=3, max_length=500)
    tone: Literal["warm", "neutral", "firm"] = "warm"
    language: str = Field(default="English", max_length=40)
    model: str | None = Field(default=None, max_length=200)

    @field_validator("topic", "language")
    @classmethod
    def _strip(cls, v: str) -> str:
        return " ".join(v.split())


class ParentEmail(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=6000)


class Output(ParentEmail):
    language: str = "English"


def prepare(db: sqlite3.Connection, user: sqlite3.Row, req: Request) -> list[Prepared]:
    student = scoped_student(db, user, req.student_id)
    assert student is not None
    language = req.language or "English"
    return [Prepared(
        title=clip(f"{student['name']}: {req.topic}", 80),
        input={"topic": req.topic, "tone": req.tone, "language": language, "student": student,
               "teacher": user["name"], "suggested_language": student["home_language"] or "English"},
        student_id=student["id"],
    )]


def system_prompt(inp: dict) -> str:
    s = inp["student"]
    language = inp["language"]
    lang_rule = (
        f"- Write the subject and the whole email in {language}, as a fluent native speaker "
        f"would write to a family — natural, not a word-for-word translation. Keep names as "
        f"they are.\n" if language.lower() not in ("english", "en") else
        "- Write in plain, everyday English that is easy to read on a phone (and easy to "
        "translate, if the family uses a translation tool).\n"
    )
    return (
        "Teacher's Desk — Parent email\n\n"
        f"You draft an email from {inp['teacher']}, {s['first_name']}'s {s['section'] or 'teacher'} "
        f"teacher, to {s['first_name']}'s family. The teacher will read it, change what they "
        "like and send it themselves, so write it as the teacher, in the first person.\n\n"
        f"Tone: {_TONE[inp['tone']]}\n\n"
        "Rules:\n"
        "- Say why you're writing in the first two sentences, and stay on that one topic.\n"
        "- Use only the facts the teacher gave in the topic. Don't invent dates, grades, "
        "scores, incidents, quotes or plans. If a specific would help but wasn't given, "
        "write around it in general terms; never use [brackets] or placeholders.\n"
        "- Never give or mention a grade or score unless the teacher's topic states one.\n"
        "- Don't mention an IEP, 504 plan, accommodations, English-learner status, reading "
        "level or any other student, unless the topic itself is about it.\n"
        "- Be specific about the next step: what you will do, what you're asking the "
        "family to do (if anything), and how to reach you (reply to this email).\n"
        f"- Greet the family naturally (for example \"Dear {s['first_name']}'s family,\") and "
        f"sign off with \"{inp['teacher']}\" on the last line.\n"
        "- 90 to 180 words, short paragraphs. No subject line inside the body.\n"
        f"{lang_rule}"
        "- Subject: short and specific (under 70 characters), no last names.\n\n"
        'Reply with only a JSON object: {"subject": "...", "body": "..."} '
        "(the body uses \\n between paragraphs)."
    )


def user_prompt(inp: dict) -> str:
    s = inp["student"]
    about = " — ".join(x for x in (s["name"], f"Grade {s['grade']}" if s["grade"] else "", s["section"]) if x)
    return (f"<teacher>{inp['teacher']}</teacher>\n<student>{about}</student>\n"
            f"<topic>{inp['topic']}</topic>\nWrite the email.")


async def run(ctx: JobContext, draft: dict) -> dict:
    inp = draft["input"]
    ctx.progress("writing", 0.1)
    reply = await generate_json(ctx, [ChatMessage("system", system_prompt(inp)),
                                      ChatMessage("user", user_prompt(inp))],
                                ParentEmail, check=_check, temperature=0.4)
    return Output(subject=" ".join(reply.subject.split()), body=reply.body.strip(),
                  language=inp["language"]).model_dump()


def _check(reply: ParentEmail) -> list[str]:
    problems = []
    if "[" in reply.body and "]" in reply.body:
        problems.append("The body has a [placeholder]; write around missing details instead.")
    return problems


def validate_output(output: dict, draft: dict) -> dict:
    return Output.model_validate({"language": draft["input"].get("language", "English"), **output}).model_dump()


def mailto(output: dict) -> str:
    """For "Open in Mail": no recipient (the roster has no family addresses)."""
    return f"mailto:?subject={quote(output['subject'])}&body={quote(output['body'])}"
