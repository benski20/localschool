"""A deterministic, offline provider for tests and UI development. No model, no GPU.

Grounded chat gets a canned cited answer. A request with `json_schema` (the teacher
tools) gets a plausible reply built from the input itself — quotes really are quoted,
segment refs really exist — so the whole tools flow can be clicked through offline.
Tests can queue exact replies in `replies` (e.g. broken JSON, to exercise the repair).
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import re
from collections.abc import AsyncIterator
from pathlib import Path

from .base import (
    TRANSCRIBE_UNSUPPORTED,
    Capabilities,
    ChatMessage,
    ModelInfo,
    PullProgress,
    RuntimeError_,
    RuntimeHealth,
    TranscriptSegment,
)

_WORD = re.compile(r"[a-z0-9]+")
_SOURCE = re.compile(r"^\[(\d+)\][^\n]*\n(.+?)(?=^\[\d+\]|\Z)", re.M | re.S)
_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_SEGMENT = re.compile(r"^\[(\d+)\]\s*(?:\([^)]*\)\s*)?(.+)$", re.M)

# What the fake "hears" in any recording: a short IEP meeting.
DEFAULT_TRANSCRIPT = [
    TranscriptSegment(0.0, 4.5, "Thanks for coming, everyone. This is the annual IEP meeting for Ava Thompson."),
    TranscriptSegment(4.5, 11.0, "Ava has made real progress in reading fluency since the spring."),
    TranscriptSegment(11.0, 17.5, "Her mother shared that homework time at home has been stressful."),
    TranscriptSegment(17.5, 24.0, "We agreed to add a daily check-in with Ms. Rivera starting Monday."),
    TranscriptSegment(24.0, 30.0, "Extended time on tests will continue, and reading support stays at three times a week."),
    TranscriptSegment(30.0, 36.5, "Ms. Rivera will send the family a progress update by Friday, October 23."),
]


class FakeProvider:
    capabilities = Capabilities(pull=True, delete=True)

    def __init__(self, dim: int = 64, models: list[str] | None = None, delay_s: float = 0.0):
        self.dim = dim
        self.delay_s = delay_s
        self.models = set(models or ["fake-chat", "fake-embed"])
        self.calls: list[tuple[str, str]] = []  # (method, model) — for assertions
        self.replies: list[str] = []            # queued exact chat replies (tests)
        self.schemas: list[dict | None] = []    # json_schema of each chat call
        self.prompts: list[list[ChatMessage]] = []
        self.transcript: list[TranscriptSegment] = list(DEFAULT_TRANSCRIPT)
        self.can_transcribe = True
        self.transcribe_delay_s = 0.0
        self.active = 0       # chats in flight right now
        self.max_active = 0   # most chats ever in flight at once

    def _vec(self, text: str, salt: str) -> list[float]:
        v = [0.0] * self.dim
        for w in _WORD.findall(text.lower()):
            h = int.from_bytes(hashlib.blake2b(f"{salt}:{w}".encode(), digest_size=8).digest(), "big")
            v[h % self.dim] += 1.0 if (h >> 63) else -1.0
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / n for x in v]

    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.2,
        json_schema: dict | None = None,
    ) -> AsyncIterator[str]:
        self._require(model)
        self.calls.append(("chat", model))
        self.schemas.append(json_schema)
        self.prompts.append(list(messages))
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            if self.replies:
                answer = self.replies.pop(0)
            elif json_schema:
                answer = tool_reply(json_schema, messages)
            else:
                answer = self._grounded(messages)
            for tok in re.findall(r"\S+\s*", answer) or [answer]:
                if self.delay_s:
                    await asyncio.sleep(self.delay_s)
                yield tok
        finally:
            self.active -= 1

    @staticmethod
    def _grounded(messages: list[ChatMessage]) -> str:
        system = next((m.content for m in messages if m.role == "system"), "")
        sources = _SOURCE.findall(system)
        if sources:
            n, body = sources[0]
            snippet = " ".join(body.split())[:160].rstrip(" .,;")
            return f"According to your sources, {snippet} [{n}]."
        return "I couldn't find that in your documents or roster."

    async def transcribe(
        self, audio_path: Path, *, language: str | None = None, prompt: str = ""
    ) -> list[TranscriptSegment]:
        self.calls.append(("transcribe", "whisper"))
        if not self.can_transcribe:
            raise RuntimeError_(TRANSCRIBE_UNSUPPORTED)
        if not Path(audio_path).is_file():
            raise RuntimeError_("Transcription failed: no audio file")
        if self.transcribe_delay_s:
            await asyncio.sleep(self.transcribe_delay_s)
        return list(self.transcript)

    async def embed(self, model: str, texts: list[str]) -> list[list[float]]:
        self._require(model)
        self.calls.append(("embed", model))
        return [self._vec(t, salt=model) for t in texts]

    async def list_models(self) -> list[ModelInfo]:
        return [ModelInfo(name=m, parameter_size="tiny", family="fake") for m in sorted(self.models)]

    async def pull(self, model: str) -> AsyncIterator[PullProgress]:
        total = 100
        for done in (0, 50, 100):
            yield PullProgress(status="downloading", completed=done, total=total)
        self.models.add(model)
        yield PullProgress(status="success")

    async def delete(self, model: str) -> None:
        self.models.discard(model)

    async def health(self) -> RuntimeHealth:
        return RuntimeHealth(ok=True, latency_ms=0.1, version="fake", loaded_models=sorted(self.models))

    async def aclose(self) -> None:
        return None

    def _require(self, model: str) -> None:
        if model not in self.models:
            raise RuntimeError_(f"model '{model}' not found, try pulling it first")


# -- offline tool replies ---------------------------------------------------------------

def _tag(messages: list[ChatMessage], name: str) -> str:
    text = "\n".join(m.content for m in messages)
    m = re.search(rf"<{name}\b[^>]*>\n?(.*?)\n?</{name}>", text, re.S)
    return m.group(1).strip() if m else ""


def _sentences(text: str) -> list[str]:
    flat = " ".join(text.split())
    return [s for s in _SENTENCE.split(flat) if len(s.split()) >= 3] or ([flat] if flat else [])


def tool_reply(schema: dict, messages: list[ChatMessage]) -> str:
    import json

    title = str(schema.get("title", ""))
    props = schema.get("properties", {})
    if title.startswith("MeetingNotes"):
        segs = [(int(i), t.strip()) for i, t in _SEGMENT.findall(_tag(messages, "transcript"))]
        if not segs:
            return json.dumps({k: ("" if k == "summary" else []) for k in props})
        out: dict = {}
        for n, (key, spec) in enumerate(props.items()):
            if key == "summary":
                out[key] = f"Meeting notes: {segs[0][1]}"
                continue
            item_props = (spec.get("items") or {}).get("properties", {})
            i, text = segs[(n + 1) % len(segs)]
            if "owner" in item_props:
                i, text = next(((j, t) for j, t in segs if " will " in t or "agreed" in t), segs[-1])
                out[key] = [{"owner": "Teacher", "task": text, "due": None, "refs": [i]}]
            else:
                out[key] = [{"text": text, "refs": [i]}]
        return json.dumps(out)
    if title == "MeetingSummary":
        parts = [p.strip("- ").strip() for p in _tag(messages, "partial_summaries").splitlines() if p.strip()]
        return json.dumps({"summary": " ".join(parts)[:600]})
    if title == "FeedbackReply":
        sents = _sentences(_tag(messages, "student_work"))
        lines = re.findall(r"^R(\d+):", _tag(messages, "rubric"), re.M) or ["1"]

        def item(k: int, kind: str) -> dict:
            quote = " ".join(sents[k % len(sents)].split()[:20]) if sents else ""
            line = int(lines[k % len(lines)])
            comment = ("This part works well because it shows clear thinking." if kind == "strength"
                       else "Next time, add one more detail that explains your idea.")
            return {"comment": comment, "quote": quote, "rubric_line": line}

        return json.dumps({"strengths": [item(0, "strength"), item(1, "strength")],
                           "next_steps": [item(-1, "next"), item(-2, "next")]})
    if title == "AdaptedReading":
        sents = _sentences(_tag(messages, "reading"))
        keep = sents[: max(1, math.ceil(len(sents) * 0.6))]
        words = sorted({w.strip(".,;:!?\"'()") for s in keep for w in s.split()}, key=lambda w: (-len(w), w))
        return json.dumps({
            "title": "Adapted reading",
            "text": " ".join(keep),
            "glossary": [{"term": w, "meaning": "An important word from the reading."} for w in words[:3] if w],
            "changes": "Kept the main ideas and shortened the reading.",
        })
    if title == "ParentEmail":
        topic = _tag(messages, "topic") or "your child's progress"
        student = (_tag(messages, "student") or "your child").split(" — ")[0]
        teacher = _tag(messages, "teacher") or "Your child's teacher"
        first = student.split()[0]
        return json.dumps({
            "subject": f"About {topic}"[:90],
            "body": (f"Dear family of {first},\n\nI'm writing about {topic}. I wanted you to hear it from me "
                     f"and to let you know how we can work on it together.\n\nPlease reply to this email or "
                     f"call the school if you'd like to talk.\n\nThank you,\n{teacher}"),
        })
    return json.dumps({k: "" for k in props})
