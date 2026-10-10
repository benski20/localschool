"""Pure helpers behind the teacher tools (no server)."""

from __future__ import annotations

import json

import pytest

from app.llm import ChatMessage
from app.llm.fake import FakeProvider
from app.services.tools import adapt, feedback, meeting
from app.services.tools.common import (extract_json, find_quote, grade_estimate, grade_number, json_schema_for)

WORK = "When the factory closed, she went back to school at fifty and became a nurse.\nShe said, “It's never too late.”"


@pytest.mark.parametrize("quote,expected", [
    ("she went back to school at fifty", "she went back to school at fifty"),
    ("She went back to school at fifty.", "she went back to school at fifty"),       # case + added period
    ("“when the factory closed, she went back”", "When the factory closed, she went back"),
    ("became a nurse. She said", "became a nurse.\nShe said"),                     # whitespace differs
    ('She said, "It\'s never too late."', "She said, “It's never too late"),     # curly vs straight quotes
])
def test_find_quote_forgives_typography_not_words(quote, expected):
    span = find_quote(WORK, quote)
    assert span is not None and WORK[span[0]:span[1]] == expected


@pytest.mark.parametrize("quote", [
    "she went back to college at fifty",   # a changed word
    "she went back ... a nurse",           # ellipsis
    "nurse",                               # too short to be a receipt
    "",
])
def test_find_quote_rejects_anything_not_verbatim(quote):
    assert find_quote(WORK, quote) is None


def test_extract_json_tolerates_fences_and_chatter():
    assert extract_json('```json\n{"a": [1, 2]}\n```') == {"a": [1, 2]}
    assert extract_json('Here you go: {"a": {"b": "}"}} Hope that helps!') == {"a": {"b": "}"}}
    for bad in ("no json", "[1, 2]", "{broken"):
        with pytest.raises(ValueError):
            extract_json(bad)


def test_schemas_are_flat_for_constrained_decoding():
    for cls in (feedback.FeedbackReply, adapt.AdaptedReading, *meeting.NOTES_MODELS.values()):
        text = json.dumps(json_schema_for(cls))
        assert "$ref" not in text and "$defs" not in text
    iep = json_schema_for(meeting.NOTES_MODELS["iep"])
    assert list(iep["properties"])[0] == "summary" and list(iep["properties"])[-1] == "action_items"
    assert iep["properties"]["action_items"]["items"]["properties"]["refs"]["type"] == "array"


def test_parse_transcript_formats():
    srt = "1\n00:00:01,000 --> 00:00:03,000\nHello.\n\n2\n00:00:03,000 --> 00:01:02,500\nWe agreed\non Monday.\n"
    assert meeting.parse_transcript(srt) == [{"start": 1.0, "end": 3.0, "text": "Hello."},
                                            {"start": 3.0, "end": 62.5, "text": "We agreed on Monday."}]
    lines = "[00:05] Ms. Rivera: welcome\n(1:02:03) - Dad: thanks\nno time here"
    assert meeting.parse_transcript(lines) == [
        {"start": 5.0, "end": 3723.0, "text": "Ms. Rivera: welcome"},
        {"start": 3723.0, "end": 3723.0, "text": "Dad: thanks"},
        {"start": None, "end": None, "text": "no time here"}]
    assert meeting.parse_transcript("\n \n") == []


def test_transcript_windows_keep_global_line_numbers():
    segs = [{"start": float(i), "end": float(i + 1), "text": "x" * 90} for i in range(300)]
    lines = meeting.transcript_lines(segs)
    assert lines[61].startswith("[61] (01:01) ")
    parts = meeting.windows(lines, max_chars=8000)
    assert len(parts) == 4 and sum(len(p) for p in parts) == 300 and parts[1][0].startswith("[")
    hour = meeting.transcript_lines([{"start": 3725.0, "end": 3726.0, "text": "late"}])
    assert hour == ["[0] (1:02:05) late"]


def test_rubric_lines_from_markdown_and_tables():
    text = ("# Rubric\n\n| Criterion | 4 | 3 |\n|---|---|---|\n| Ideas | Clear and focused | Mostly clear |\n"
            "- Evidence: details support the idea\n1. Organization\n- Evidence: details support the idea\n42\n")
    assert feedback.rubric_lines(text) == ["Rubric", "Criterion | 4 | 3", "Ideas | Clear and focused | Mostly clear",
                                           "Evidence: details support the idea", "Organization"]
    huge = "\n".join(f"Criterion {i}: " + "detail " * 40 for i in range(200))
    lines = feedback.rubric_lines(huge)
    assert len(lines) < 80 and sum(map(len, lines)) < feedback.RUBRIC_PROMPT_CHARS + 300


def test_grade_helpers():
    easy = "The cat sat. The dog ran. We had fun. It was a good day. The sun was hot. We ate ice cream."
    hard = ("Photosynthesis, the biochemical process whereby chlorophyll-containing organisms convert electromagnetic "
            "radiation into chemical energy, fundamentally sustains terrestrial ecosystems and atmospheric "
            "oxygenation, notwithstanding considerable variability in environmental conditions.")
    assert grade_estimate(easy) < 3 < 12 < grade_estimate(hard)
    assert grade_estimate("Too short.") is None
    assert [grade_number(x) for x in ("Grade 6", "grade_11", "K", "", "advanced")] == [6, 11, 0, None, None]


async def test_fake_provider_tool_replies_validate():
    """The offline provider's tool replies satisfy the real schemas (so demo mode works)."""
    fake = FakeProvider()
    cases = [
        (feedback.FeedbackReply, f"<rubric>\nR1: Ideas\nR2: Evidence\n</rubric>\n<student_work>\n{WORK}\n</student_work>"),
        (adapt.AdaptedReading, f"<reading>\n{WORK} {WORK}\n</reading>"),
        (meeting.NOTES_MODELS["sst"], "<transcript>\n[0] (00:00) We met.\n[1] (00:04) Ms. Lee will call home.\n</transcript>"),
    ]
    for cls, prompt in cases:
        raw = "".join([t async for t in fake.chat("fake-chat", [ChatMessage("user", prompt)],
                                                  json_schema=json_schema_for(cls))])
        cls.model_validate(extract_json(raw))
    reply = feedback.FeedbackReply.model_validate_json(
        "".join([t async for t in fake.chat("fake-chat", [ChatMessage("user", cases[0][1])],
                                            json_schema=json_schema_for(feedback.FeedbackReply))]))
    assert all(find_quote(WORK, i.quote) for i in reply.strengths + reply.next_steps)
