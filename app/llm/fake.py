"""A deterministic, offline provider for tests and UI development. No model, no GPU."""

from __future__ import annotations

import asyncio
import hashlib
import math
import re
from collections.abc import AsyncIterator

from .base import Capabilities, ChatMessage, ModelInfo, PullProgress, RuntimeError_, RuntimeHealth

_WORD = re.compile(r"[a-z0-9]+")
_SOURCE = re.compile(r"^\[(\d+)\][^\n]*\n(.+?)(?=^\[\d+\]|\Z)", re.M | re.S)


class FakeProvider:
    capabilities = Capabilities(pull=True, delete=True)

    def __init__(self, dim: int = 64, models: list[str] | None = None, delay_s: float = 0.0):
        self.dim = dim
        self.delay_s = delay_s
        self.models = set(models or ["fake-chat", "fake-embed"])
        self.calls: list[tuple[str, str]] = []  # (method, model) — for assertions

    def _vec(self, text: str, salt: str) -> list[float]:
        v = [0.0] * self.dim
        for w in _WORD.findall(text.lower()):
            h = int.from_bytes(hashlib.blake2b(f"{salt}:{w}".encode(), digest_size=8).digest(), "big")
            v[h % self.dim] += 1.0 if (h >> 63) else -1.0
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / n for x in v]

    async def chat(
        self, model: str, messages: list[ChatMessage], *, temperature: float = 0.2
    ) -> AsyncIterator[str]:
        self._require(model)
        self.calls.append(("chat", model))
        system = next((m.content for m in messages if m.role == "system"), "")
        sources = _SOURCE.findall(system)
        if sources:
            n, body = sources[0]
            snippet = " ".join(body.split())[:160].rstrip(" .,;")
            answer = f"According to your sources, {snippet} [{n}]."
        else:
            answer = "I couldn't find that in your documents or roster."
        for tok in re.findall(r"\S+\s*", answer):
            if self.delay_s:
                await asyncio.sleep(self.delay_s)
            yield tok

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
