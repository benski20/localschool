"""The one interface the app uses to talk to a model runtime.

The runtime is a separate, swappable component: a free cloud GPU for the pilot, the
on-site school box later. Everything above this layer is runtime-agnostic.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol, runtime_checkable

Role = Literal["system", "user", "assistant"]


@dataclass(frozen=True)
class ChatMessage:
    role: Role
    content: str


@dataclass(frozen=True)
class ModelInfo:
    name: str
    size_bytes: int | None = None
    parameter_size: str = ""
    quantization: str = ""
    family: str = ""
    loaded: bool = False


@dataclass(frozen=True)
class PullProgress:
    status: str
    completed: int | None = None
    total: int | None = None


@dataclass(frozen=True)
class RuntimeHealth:
    ok: bool
    latency_ms: float | None = None
    version: str = ""
    loaded_models: list[str] = field(default_factory=list)
    vram_bytes: int | None = None
    error: str = ""


@dataclass(frozen=True)
class TranscriptSegment:
    """One timed stretch of speech (seconds from the start of the recording)."""

    start: float
    end: float
    text: str


# Shown to the teacher when the runtime has no speech-to-text endpoint.
TRANSCRIBE_UNSUPPORTED = "This runtime can't transcribe audio yet."
# The model name sent to /v1/audio/transcriptions; the runtime maps it to its Whisper build.
TRANSCRIBE_MODEL = "whisper"


@dataclass(frozen=True)
class Capabilities:
    pull: bool = False    # can download new models onto the runtime
    delete: bool = False  # can remove models from the runtime


class RuntimeError_(Exception):
    """The model runtime failed or is unreachable."""


class RuntimeUnavailable(RuntimeError_):
    """Could not reach the runtime at all (down, wrong URL, cold-starting past timeout)."""


@runtime_checkable
class ModelProvider(Protocol):
    capabilities: Capabilities

    def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.2,
        json_schema: dict | None = None,
    ) -> AsyncIterator[str]:
        """Stream the assistant's visible answer text (reasoning traces stripped).

        `json_schema`: ask for a JSON reply of this shape (constrained decoding where the
        runtime supports it). Callers still validate: it's a strong hint, not a guarantee."""
        ...

    async def transcribe(
        self, audio_path: Path, *, language: str | None = None, prompt: str = ""
    ) -> list[TranscriptSegment]:
        """Speech-to-text for one recording. `prompt` primes spelling (names, terms).
        Raises RuntimeError_(TRANSCRIBE_UNSUPPORTED) when the runtime has no endpoint."""
        ...

    async def embed(self, model: str, texts: list[str]) -> list[list[float]]: ...

    async def list_models(self) -> list[ModelInfo]: ...

    def pull(self, model: str) -> AsyncIterator[PullProgress]: ...

    async def delete(self, model: str) -> None: ...

    async def health(self) -> RuntimeHealth: ...

    async def aclose(self) -> None: ...
