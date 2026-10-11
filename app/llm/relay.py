"""Relay runtime: a personal desk (a teacher's own server on their Mac) borrows the school
server's models through its /api/relay endpoints (app/routes/relay.py), with the per-Mac
key the Mac app got when the teacher signed in. Models are the school's to manage, so
there's no pull or delete here."""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from pathlib import Path

import httpx

from .base import (
    Capabilities,
    ChatMessage,
    ModelInfo,
    PullProgress,
    RuntimeError_,
    RuntimeHealth,
    RuntimeUnavailable,
    TranscriptSegment,
)

SCHOOL_MANAGES = "Your school manages the AI models."


def _error(resp: httpx.Response) -> RuntimeError_:
    try:
        msg = resp.json().get("error") or resp.text
    except (ValueError, json.JSONDecodeError):
        msg = resp.text
    msg = str(msg)[:300] or f"School server answered {resp.status_code}"
    return RuntimeUnavailable(msg) if resp.status_code in (502, 503, 504) else RuntimeError_(msg)


class RelayProvider:
    capabilities = Capabilities(pull=False, delete=False)

    def __init__(self, base_url: str, *, token: str, timeout_s: float = 120.0,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {token}", "User-Agent": "localschool-desk/0.1"},
            timeout=httpx.Timeout(timeout_s, connect=min(15.0, timeout_s)),
            transport=transport,
        )

    async def _call(self, method: str, path: str, **kw) -> httpx.Response:
        try:
            resp = await self._client.request(method, path, **kw)
        except httpx.TimeoutException as e:
            raise RuntimeUnavailable("Your school's server took too long to answer.") from e
        except httpx.TransportError as e:
            raise RuntimeUnavailable("Can't reach your school's server. Check your internet connection.") from e
        if resp.status_code >= 400:
            raise _error(resp)
        return resp

    async def chat(self, model: str, messages: list[ChatMessage], *, temperature: float = 0.2,
                   json_schema: dict | None = None) -> AsyncIterator[str]:
        body = {"model": model, "temperature": temperature, "json_schema": json_schema,
                "messages": [{"role": m.role, "content": m.content} for m in messages]}
        try:
            async with self._client.stream("POST", "/chat", json=body) as resp:
                if resp.status_code >= 400:
                    await resp.aread()
                    raise _error(resp)
                async for part in resp.aiter_text():
                    if part:
                        yield part
        except httpx.TimeoutException as e:
            raise RuntimeUnavailable("Your school's server took too long to answer.") from e
        except httpx.TransportError as e:
            raise RuntimeUnavailable("Can't reach your school's server. Check your internet connection.") from e

    async def transcribe(self, audio_path: Path, *, language: str | None = None,
                         prompt: str = "") -> list[TranscriptSegment]:
        with Path(audio_path).open("rb") as f:
            resp = await self._call("POST", "/transcribe", files={"file": ("audio", f)},
                                    data={"language": language or "", "prompt": prompt}, timeout=None)
        return [TranscriptSegment(**s) for s in resp.json()["segments"]]

    async def embed(self, model: str, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), 256):
            resp = await self._call("POST", "/embed", json={"model": model, "texts": texts[i:i + 256]})
            out.extend(resp.json()["vectors"])
        return out

    async def list_models(self) -> list[ModelInfo]:
        return [ModelInfo(**m) for m in (await self._call("GET", "/models")).json()["models"]]

    async def pull(self, model: str) -> AsyncIterator[PullProgress]:
        raise RuntimeError_(SCHOOL_MANAGES)
        yield  # pragma: no cover - makes this an async generator

    async def delete(self, model: str) -> None:
        raise RuntimeError_(SCHOOL_MANAGES)

    async def health(self) -> RuntimeHealth:
        t0 = time.perf_counter()
        try:
            h = (await self._call("GET", "/health")).json()
        except RuntimeError_ as e:
            return RuntimeHealth(ok=False, error=str(e))
        h["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        return RuntimeHealth(**h)

    async def aclose(self) -> None:
        await self._client.aclose()
