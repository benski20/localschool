"""Ollama runtime: native streaming chat, OpenAI-compatible embeddings, model management.

The same provider serves every pilot/production target — a Modal GPU container, a
Kaggle notebook behind a tunnel, or the on-site box — because each runs Ollama.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator

import httpx

from .base import (
    Capabilities,
    ChatMessage,
    ModelInfo,
    PullProgress,
    RuntimeError_,
    RuntimeHealth,
    RuntimeUnavailable,
)
from .openai_compat import OpenAICompatProvider, ThinkFilter, _raise_for_status


class OllamaProvider(OpenAICompatProvider):
    capabilities = Capabilities(pull=True, delete=True)

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        # Models that reject `think: false` (non-reasoning or always-reasoning models)
        # are remembered so we stop sending it.
        self._no_think_param: set[str] = set()

    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.2,
        json_schema: dict | None = None,
    ) -> AsyncIterator[str]:
        """Native /api/chat: lets us switch reasoning off (`think: false`) so answers
        start immediately — on a CPU or a shared GPU that's the difference between
        seconds and a minute. Reasoning text, if any, arrives separately and is dropped."""
        body: dict = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "options": {"temperature": temperature},
            "keep_alive": "30m",
        }
        if model not in self._no_think_param:
            body["think"] = False
        if json_schema:
            body["format"] = json_schema  # structured outputs: decoding follows the schema
        think = ThinkFilter()
        try:
            async with self._client.stream("POST", "/api/chat", json=body) as resp:
                if resp.status_code >= 400:
                    await resp.aread()
                    if "think" in resp.text.lower() and "think" in body:
                        self._no_think_param.add(model)
                        async for piece in self.chat(model, messages, temperature=temperature,
                                                     json_schema=json_schema):
                            yield piece
                        return
                    _raise_for_status(resp)
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        evt = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if evt.get("error"):
                        raise RuntimeError_(f"Runtime error: {evt['error']}")
                    piece = (evt.get("message") or {}).get("content") or ""
                    if piece:
                        visible = think.feed(piece)
                        if visible:
                            yield visible
                    if evt.get("done"):
                        break
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            raise RuntimeUnavailable(f"Cannot reach model runtime at {self.base_url}: {e}") from e
        except httpx.TimeoutException as e:
            raise RuntimeUnavailable("Model runtime timed out while generating") from e
        tail = think.flush()
        if tail:
            yield tail

    async def list_models(self) -> list[ModelInfo]:
        tags = (await self._request("GET", "/api/tags")).json().get("models", [])
        loaded = await self._loaded()
        out = []
        for m in tags:
            d = m.get("details") or {}
            out.append(
                ModelInfo(
                    name=m.get("name") or m.get("model", ""),
                    size_bytes=m.get("size"),
                    parameter_size=d.get("parameter_size", ""),
                    quantization=d.get("quantization_level", ""),
                    family=d.get("family", ""),
                    loaded=(m.get("name") in loaded),
                )
            )
        return sorted(out, key=lambda m: m.name)

    async def _loaded(self) -> dict[str, int]:
        try:
            ps = (await self._request("GET", "/api/ps")).json().get("models", [])
        except RuntimeError_:
            return {}
        return {m.get("name", ""): int(m.get("size_vram") or 0) for m in ps}

    async def pull(self, model: str) -> AsyncIterator[PullProgress]:
        try:
            async with self._client.stream(
                "POST", "/api/pull", json={"model": model, "stream": True}, timeout=None
            ) as resp:
                if resp.status_code >= 400:
                    await resp.aread()
                    _raise_for_status(resp)
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    evt = json.loads(line)
                    if "error" in evt:
                        raise RuntimeError_(f"Pull failed: {evt['error']}")
                    yield PullProgress(
                        status=evt.get("status", ""),
                        completed=evt.get("completed"),
                        total=evt.get("total"),
                    )
        except httpx.HTTPError as e:
            raise RuntimeError_(f"Pull interrupted: {e}") from e

    async def delete(self, model: str) -> None:
        await self._request("DELETE", "/api/delete", json={"model": model})

    async def health(self) -> RuntimeHealth:
        t0 = time.perf_counter()
        try:
            version = (await self._request("GET", "/api/version")).json().get("version", "")
        except RuntimeError_ as e:
            return RuntimeHealth(ok=False, error=str(e))
        latency = round((time.perf_counter() - t0) * 1000, 1)
        loaded = await self._loaded()
        return RuntimeHealth(
            ok=True,
            latency_ms=latency,
            version=version,
            loaded_models=list(loaded),
            vram_bytes=sum(loaded.values()) or None,
        )
