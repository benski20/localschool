"""The one interface the app uses to talk to a model runtime.

The runtime is a separate, swappable component: a free cloud GPU for the pilot, the
on-site school box later. Everything above this layer is runtime-agnostic.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
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
        self, model: str, messages: list[ChatMessage], *, temperature: float = 0.2
    ) -> AsyncIterator[str]:
        """Stream the assistant's visible answer text (reasoning traces stripped)."""
        ...

    async def embed(self, model: str, texts: list[str]) -> list[list[float]]: ...

    async def list_models(self) -> list[ModelInfo]: ...

    def pull(self, model: str) -> AsyncIterator[PullProgress]: ...

    async def delete(self, model: str) -> None: ...

    async def health(self) -> RuntimeHealth: ...

    async def aclose(self) -> None: ...
