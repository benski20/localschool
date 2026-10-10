"""OpenAI-compatible speech-to-text for the Local School runtime: faster-whisper on CPU (int8).

Runs next to Ollama, on loopback, behind deploy/token_proxy.py (which routes /v1/audio/*
here and checks the bearer token; this server has no auth of its own).

    WHISPER_MODEL=base.en python whisper_server.py --listen 127.0.0.1:11436
    python whisper_server.py --download base.en      # fetch weights into $WHISPER_DIR

POST /v1/audio/transcriptions   multipart: file, model (any name; WHISPER_MODEL is used),
                                language?, prompt?, response_format? (json | verbose_json | text)
    → OpenAI's shapes. verbose_json: {"task", "language", "duration", "text",
      "segments": [{"id", "seek", "start", "end", "text", "tokens", "temperature",
      "avg_logprob", "compression_ratio", "no_speech_prob"}]}
GET  /health → {"ok", "model", "loaded"}

Long recordings: the 200 response starts at once and one space is written every
HEARTBEAT_S seconds while the model works, so no proxy or platform request timeout ever
sees an idle connection (JSON parsers skip leading whitespace). A failure after that point
comes back in the body as {"error": {"message", "type"}}. Audio is decoded by PyAV (bundled
FFmpeg): WebM/Opus, Ogg, M4A/AAC, MP3 and WAV all work.

Env: WHISPER_MODEL (default base.en), WHISPER_DIR (weights cache), WHISPER_THREADS (4),
WHISPER_BEAM (5).
"""

from __future__ import annotations

import argparse
import asyncio
import functools
import json
import logging
import os
import tempfile
import threading
from pathlib import Path
from typing import Protocol

from aiohttp import web

log = logging.getLogger("whisper_server")
HEARTBEAT_S = 10.0
MAX_BYTES = 512 * 1024 * 1024
FORMATS = ("json", "verbose_json", "text")


class Engine(Protocol):
    name: str

    def transcribe(self, path: str, *, language: str | None, prompt: str | None) -> dict: ...


class FasterWhisper:
    """One model, loaded once (lazily, or at startup via `load`); one file at a time."""

    def __init__(self, name: str | None = None, cache_dir: str | None = None,
                 threads: int | None = None, beam: int | None = None) -> None:
        self.name = name or os.environ.get("WHISPER_MODEL", "").strip() or "base.en"
        self.cache_dir = cache_dir or os.environ.get("WHISPER_DIR") or None
        self.threads = threads or int(os.environ.get("WHISPER_THREADS", "4"))
        self.beam = beam or int(os.environ.get("WHISPER_BEAM", "5"))
        self._model = None
        self._load_lock = threading.Lock()
        self._run_lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self):
        with self._load_lock:
            if self._model is None:
                from faster_whisper import WhisperModel

                self._model = WhisperModel(self.name, device="cpu", compute_type="int8",
                                           cpu_threads=self.threads, download_root=self.cache_dir)
                log.info("loaded whisper model %s", self.name)
            return self._model

    def transcribe(self, path: str, *, language: str | None, prompt: str | None) -> dict:
        model = self.load()
        with self._run_lock:
            segments, info = model.transcribe(
                path, language=language or None, initial_prompt=prompt or None, beam_size=self.beam,
                vad_filter=True,                  # skip silence: long meetings go faster, fewer hallucinations
                condition_on_previous_text=False,  # no runaway repetition over an hour of audio
            )
            segs = [segment_dict(s) for s in segments]  # the generator does the work
        return verbose_json(segs, language=info.language, duration=info.duration)


def segment_dict(s) -> dict:
    return {"id": s.id, "seek": s.seek, "start": round(s.start, 2), "end": round(s.end, 2), "text": s.text,
            "tokens": list(s.tokens), "temperature": s.temperature, "avg_logprob": s.avg_logprob,
            "compression_ratio": s.compression_ratio, "no_speech_prob": s.no_speech_prob}


def verbose_json(segments: list[dict], *, language: str, duration: float) -> dict:
    return {"task": "transcribe", "language": language, "duration": round(float(duration), 2),
            "text": "".join(s["text"] for s in segments).strip(), "segments": segments}


def render(result: dict, fmt: str) -> bytes:
    if fmt == "text":
        return (result["text"] + "\n").encode()
    if fmt == "json":
        return json.dumps({"text": result["text"]}).encode()
    return json.dumps(result).encode()


class _Reject(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status, self.message = status, message


def _error(status: int, message: str) -> web.Response:
    return web.json_response({"error": {"message": message, "type": "invalid_request_error"}}, status=status)


def make_app(engine: Engine, *, preload: bool = False) -> web.Application:
    async def receive(request: web.Request) -> tuple[str, dict[str, str]] | web.Response:
        """Stream the upload to a temp file: (path, other fields), or an error response."""
        reader = await request.multipart()
        fields: dict[str, str] = {}
        tmp: str | None = None
        try:
            while (part := await reader.next()) is not None:
                if part.name == "file" and tmp is None:
                    suffix = Path(part.filename or "audio").suffix[:8] or ".bin"
                    fd, tmp = tempfile.mkstemp(prefix="ls-audio-", suffix=suffix)
                    size = 0
                    with os.fdopen(fd, "wb") as fh:
                        while chunk := await part.read_chunk(1 << 20):
                            size += len(chunk)
                            if size > MAX_BYTES:
                                raise _Reject(413, "The recording is too large.")
                            fh.write(chunk)
                    if size == 0:
                        raise _Reject(400, "The recording is empty.")
                elif part.name:
                    fields[part.name] = (await part.text())[:4000]
            if tmp is None:
                raise _Reject(400, "A 'file' field is required.")
            if (fields.get("response_format") or "json") not in FORMATS:
                raise _Reject(400, f"response_format must be one of {', '.join(FORMATS)}.")
        except BaseException as e:
            if tmp:
                os.unlink(tmp)
            if isinstance(e, _Reject):
                return _error(e.status, e.message)
            raise
        return tmp, fields

    async def transcriptions(request: web.Request) -> web.StreamResponse:
        if not request.content_type.startswith("multipart/"):
            return _error(400, "Send multipart/form-data with a 'file' field.")
        got = await receive(request)
        if isinstance(got, web.Response):
            return got
        path, fields = got
        fmt = fields.get("response_format") or "json"
        job = asyncio.get_running_loop().run_in_executor(None, functools.partial(
            engine.transcribe, path, language=fields.get("language") or None, prompt=fields.get("prompt") or None))
        # The decoder owns the file now; delete it when it's done, even if the client left.
        job.add_done_callback(lambda _f: os.path.exists(path) and os.unlink(path))

        resp = web.StreamResponse(status=200, headers={
            "Content-Type": "text/plain; charset=utf-8" if fmt == "text" else "application/json",
            "Cache-Control": "no-store"})
        await resp.prepare(request)
        while True:
            done, _ = await asyncio.wait({job}, timeout=HEARTBEAT_S)
            if done:
                break
            await resp.write(b" ")  # keep-alive; JSON parsers skip leading whitespace
        try:
            body = render(job.result(), fmt)
        except Exception as e:  # undecodable audio, model failure: status is already 200
            log.warning("transcription failed: %s", e)
            body = json.dumps({"error": {"message": str(e)[:500] or type(e).__name__,
                                         "type": "server_error"}}).encode()
        await resp.write(body)
        await resp.write_eof()
        return resp

    async def health(_: web.Request) -> web.Response:
        return web.json_response({"ok": True, "model": engine.name, "loaded": bool(getattr(engine, "loaded", True))})

    async def warm(app: web.Application) -> None:
        load = getattr(engine, "load", None)
        if preload and load is not None:
            def run() -> None:
                try:
                    load()
                except Exception:  # first request will retry and report it
                    log.exception("whisper model failed to load")
            threading.Thread(target=run, daemon=True).start()

    app = web.Application()
    app.router.add_post("/v1/audio/transcriptions", transcriptions)
    app.router.add_get("/health", health)
    app.on_startup.append(warm)
    return app


def download(name: str, cache_dir: str | None) -> str:
    from faster_whisper.utils import download_model

    return download_model(name, cache_dir=cache_dir)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser()
    ap.add_argument("--listen", default="127.0.0.1:11436")
    ap.add_argument("--download", metavar="MODEL", help="download weights into $WHISPER_DIR and exit")
    args = ap.parse_args()
    if args.download:
        print(download(args.download, os.environ.get("WHISPER_DIR") or None))
        return
    host, port = args.listen.rsplit(":", 1)
    web.run_app(make_app(FasterWhisper(), preload=True), host=host, port=int(port), print=None)


if __name__ == "__main__":
    main()
