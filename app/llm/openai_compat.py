"""Provider for any OpenAI-compatible server (Ollama's /v1, vLLM, llama.cpp server)."""

from __future__ import annotations

import asyncio
import json
import mimetypes
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
    TRANSCRIBE_MODEL,
    TRANSCRIBE_UNSUPPORTED,
    TranscriptSegment,
)

_RETRYABLE = (httpx.ConnectError, httpx.ConnectTimeout, httpx.RemoteProtocolError)
# A long meeting on a CPU runtime takes minutes to transcribe. Our runtime's sidecar
# sends keep-alive whitespace while it works; other servers may stay silent until done.
TRANSCRIBE_READ_TIMEOUT_S = 3600.0
_AUDIO_MIME = {".webm": "audio/webm", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp3": "audio/mpeg",
               ".wav": "audio/wav"}


class ThinkFilter:
    """Strips <think>…</think> reasoning blocks from a token stream (Qwen-style models).

    Tags may be split across chunks, so a possible partial tag is held back until the
    next chunk resolves it.
    """

    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self) -> None:
        self._buf = ""
        self._inside = False

    def feed(self, text: str) -> str:
        self._buf += text
        out: list[str] = []
        while self._buf:
            tag = self.CLOSE if self._inside else self.OPEN
            idx = self._buf.find(tag)
            if idx >= 0:
                if not self._inside:
                    out.append(self._buf[:idx])
                self._buf = self._buf[idx + len(tag):]
                self._inside = not self._inside
                continue
            # Hold back a suffix that could be the start of the tag.
            keep = 0
            for n in range(min(len(tag) - 1, len(self._buf)), 0, -1):
                if tag.startswith(self._buf[-n:]):
                    keep = n
                    break
            emit, self._buf = self._buf[: len(self._buf) - keep], self._buf[len(self._buf) - keep:]
            if not self._inside:
                out.append(emit)
            break
        return "".join(out)

    def flush(self) -> str:
        rest, self._buf = ("" if self._inside else self._buf), ""
        return rest


class OpenAICompatProvider:
    capabilities = Capabilities(pull=False, delete=False)

    def __init__(
        self,
        base_url: str,
        *,
        token: str = "",
        headers: dict[str, str] | None = None,
        timeout_s: float = 120.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self._no_response_format: set[str] = set()  # models whose server rejects json_schema
        hdrs = {"User-Agent": "localschool/0.1"}
        if token:
            hdrs["Authorization"] = f"Bearer {token}"
        hdrs.update(headers or {})
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers=hdrs,
            timeout=httpx.Timeout(timeout_s, connect=min(15.0, timeout_s)),
            transport=transport,
        )

    # -- helpers ---------------------------------------------------------------------

    async def _request(self, method: str, path: str, **kw) -> httpx.Response:
        """Idempotent request with small retry for connection-level failures."""
        delay = 0.5
        for attempt in range(3):
            try:
                resp = await self._client.request(method, path, **kw)
            except _RETRYABLE as e:
                if attempt == 2:
                    raise RuntimeUnavailable(f"Cannot reach model runtime at {self.base_url}: {e}") from e
                await asyncio.sleep(delay)
                delay *= 2
                continue
            except httpx.TimeoutException as e:
                raise RuntimeUnavailable(f"Model runtime timed out ({self.base_url})") from e
            if resp.status_code in (502, 503, 504) and attempt < 2:
                await asyncio.sleep(delay)
                delay *= 2
                continue
            _raise_for_status(resp)
            return resp
        raise RuntimeUnavailable("unreachable")  # pragma: no cover

    # -- ModelProvider ---------------------------------------------------------------

    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.2,
        json_schema: dict | None = None,
    ) -> AsyncIterator[str]:
        body: dict = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "temperature": temperature,
        }
        if json_schema and model not in self._no_response_format:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "reply", "schema": json_schema, "strict": False},
            }
        think = ThinkFilter()
        try:
            async with self._client.stream("POST", "/v1/chat/completions", json=body) as resp:
                if resp.status_code >= 400:
                    await resp.aread()
                    if resp.status_code == 400 and "response_format" in body:
                        # A server without structured outputs: the prompt alone asks for JSON.
                        self._no_response_format.add(model)
                        async for piece in self.chat(model, messages, temperature=temperature,
                                                     json_schema=json_schema):
                            yield piece
                        return
                    _raise_for_status(resp)
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        evt = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    for choice in evt.get("choices", []):
                        # `reasoning` / `reasoning_content` deltas are intentionally ignored.
                        piece = (choice.get("delta") or {}).get("content") or ""
                        if piece:
                            visible = think.feed(piece)
                            if visible:
                                yield visible
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            raise RuntimeUnavailable(f"Cannot reach model runtime at {self.base_url}: {e}") from e
        except httpx.TimeoutException as e:
            raise RuntimeUnavailable("Model runtime timed out while generating") from e
        tail = think.flush()
        if tail:
            yield tail

    async def embed(self, model: str, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        resp = await self._request("POST", "/v1/embeddings", json={"model": model, "input": texts})
        data = sorted(resp.json()["data"], key=lambda d: d["index"])
        return [d["embedding"] for d in data]

    async def transcribe(
        self, audio_path: Path, *, language: str | None = None, prompt: str = ""
    ) -> list[TranscriptSegment]:
        """OpenAI-compatible speech-to-text: multipart POST /v1/audio/transcriptions."""
        path = Path(audio_path)
        form = {"model": TRANSCRIBE_MODEL, "response_format": "verbose_json"}
        if language:
            form["language"] = language
        if prompt:
            form["prompt"] = prompt
        mime = (_AUDIO_MIME.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0]
                or "application/octet-stream")
        timeout = httpx.Timeout(connect=15.0, read=max(self.timeout_s, TRANSCRIBE_READ_TIMEOUT_S),
                                write=None, pool=None)
        delay = 1.0
        for attempt in range(3):
            try:
                with path.open("rb") as fh:  # reopened per attempt: a retry resends from the start
                    resp = await self._client.post("/v1/audio/transcriptions", data=form,
                                                   files={"file": (path.name, fh, mime)}, timeout=timeout)
            except _RETRYABLE as e:
                if attempt == 2:
                    raise RuntimeUnavailable(f"Cannot reach model runtime at {self.base_url}: {e}") from e
                await asyncio.sleep(delay)
                delay *= 2
                continue
            except httpx.TimeoutException as e:
                raise RuntimeUnavailable("The runtime timed out while transcribing.") from e
            if resp.status_code in (404, 405, 501):
                raise RuntimeError_(TRANSCRIBE_UNSUPPORTED)
            if resp.status_code in (502, 503, 504) and attempt < 2:
                await asyncio.sleep(delay)
                delay *= 2
                continue
            _raise_for_status(resp)
            return parse_transcription(resp.text)
        raise RuntimeUnavailable("unreachable")  # pragma: no cover

    async def list_models(self) -> list[ModelInfo]:
        resp = await self._request("GET", "/v1/models")
        return [ModelInfo(name=m["id"]) for m in resp.json().get("data", [])]

    async def pull(self, model: str) -> AsyncIterator[PullProgress]:  # pragma: no cover
        raise RuntimeError_("This runtime does not support downloading models")
        yield  # make this an async generator

    async def delete(self, model: str) -> None:
        raise RuntimeError_("This runtime does not support deleting models")

    async def health(self) -> RuntimeHealth:
        t0 = time.perf_counter()
        try:
            models = await self.list_models()
        except RuntimeError_ as e:
            return RuntimeHealth(ok=False, error=str(e))
        return RuntimeHealth(
            ok=True,
            latency_ms=round((time.perf_counter() - t0) * 1000, 1),
            loaded_models=[m.name for m in models],
        )

    async def aclose(self) -> None:
        await self._client.aclose()


def parse_transcription(body: str) -> list[TranscriptSegment]:
    """Read an OpenAI `verbose_json` transcription. Leading whitespace is fine (our
    sidecar's keep-alive bytes), and so is an `{"error": …}` body: the sidecar sends that
    with a 200 when the failure came after the response had started."""
    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        raise RuntimeError_(f"The runtime's transcription wasn't readable: {body.strip()[:200]}") from e
    if not isinstance(data, dict):
        raise RuntimeError_("The runtime's transcription wasn't readable.")
    if data.get("error"):
        err = data["error"]
        msg = err.get("message") if isinstance(err, dict) else str(err)
        raise RuntimeError_(f"Transcription failed: {msg}")
    out: list[TranscriptSegment] = []
    for seg in data.get("segments") or []:
        text = " ".join(str(seg.get("text") or "").split())
        if text:
            start = float(seg.get("start") or 0.0)
            end = max(float(seg.get("end") or start), start)
            out.append(TranscriptSegment(round(start, 2), round(end, 2), text))
    if not out and str(data.get("text") or "").strip():
        out.append(TranscriptSegment(0.0, round(float(data.get("duration") or 0.0), 2),
                                     " ".join(str(data["text"]).split())))
    return out


def _raise_for_status(resp: httpx.Response) -> None:
    if resp.status_code < 400:
        return
    try:
        detail = resp.json().get("error") or resp.text
        if isinstance(detail, dict):
            detail = detail.get("message") or json.dumps(detail)
    except Exception:
        detail = resp.text
    if resp.status_code in (401, 403):
        raise RuntimeError_(f"Runtime rejected credentials ({resp.status_code}). Check the access token.")
    if resp.status_code in (502, 503, 504):
        raise RuntimeUnavailable(f"Runtime is unavailable or warming up ({resp.status_code})")
    raise RuntimeError_(f"Runtime error {resp.status_code}: {str(detail)[:300]}")
