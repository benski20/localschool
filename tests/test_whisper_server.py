"""The runtime's speech-to-text sidecar (deploy/whisper_server.py) and its route through
the token proxy, exercised with a stand-in engine (no model download)."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import time
import types
from collections import namedtuple
from pathlib import Path

import pytest

aiohttp = pytest.importorskip("aiohttp")
from aiohttp import FormData, web  # noqa: E402
from aiohttp.test_utils import TestClient, TestServer  # noqa: E402

DEPLOY = Path(__file__).parents[1] / "deploy"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, DEPLOY / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


whisper_server = _load("whisper_server")
token_proxy = _load("token_proxy")
TOKEN = "t" * 24
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class StubEngine:
    name = "base.en"
    loaded = True

    def __init__(self, delay: float = 0.0, fail: str = "") -> None:
        self.delay, self.fail = delay, fail
        self.calls: list[dict] = []

    def transcribe(self, path: str, *, language, prompt) -> dict:
        data = Path(path).read_bytes()
        self.calls.append({"path": path, "bytes": len(data), "language": language, "prompt": prompt,
                           "suffix": Path(path).suffix})
        if self.delay:
            time.sleep(self.delay)
        if self.fail:
            raise ValueError(self.fail)
        segs = [{"id": 0, "seek": 0, "start": 0.0, "end": 2.5, "text": " This is an IEP meeting.", "tokens": [1, 2],
                 "temperature": 0.0, "avg_logprob": -0.3, "compression_ratio": 1.2, "no_speech_prob": 0.02},
                {"id": 1, "seek": 250, "start": 2.5, "end": 6.0, "text": " We agreed to a daily check-in.",
                 "tokens": [3], "temperature": 0.0, "avg_logprob": -0.25, "compression_ratio": 1.1,
                 "no_speech_prob": 0.01}]
        return whisper_server.verbose_json(segs, language="en", duration=6.04)


def _form(audio: bytes = b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 64, fmt: str | None = "verbose_json",
          **fields) -> FormData:
    form = FormData()
    form.add_field("file", audio, filename="meeting.wav", content_type="audio/wav")
    form.add_field("model", "whisper")
    if fmt:
        form.add_field("response_format", fmt)
    for k, v in fields.items():
        form.add_field(k, v)
    return form


@pytest.fixture
async def sidecar():
    engine = StubEngine()
    client = TestClient(TestServer(whisper_server.make_app(engine)))
    await client.start_server()
    client.engine = engine
    yield client
    await client.close()


async def test_verbose_json_shape(sidecar):
    r = await sidecar.post("/v1/audio/transcriptions", data=_form(language="en", prompt="Ava Thompson"))
    assert r.status == 200 and r.headers["Content-Type"].startswith("application/json")
    body = json.loads(await r.text())
    assert set(body) == {"task", "language", "duration", "text", "segments"}
    assert body["task"] == "transcribe" and body["language"] == "en" and body["duration"] == 6.04
    assert body["text"] == "This is an IEP meeting. We agreed to a daily check-in."
    seg = body["segments"][1]
    assert set(seg) == {"id", "seek", "start", "end", "text", "tokens", "temperature", "avg_logprob",
                        "compression_ratio", "no_speech_prob"}
    assert (seg["start"], seg["end"]) == (2.5, 6.0)
    call = sidecar.engine.calls[0]
    assert call["language"] == "en" and call["prompt"] == "Ava Thompson" and call["suffix"] == ".wav"
    assert not Path(call["path"]).exists()  # temp file cleaned up


async def test_other_formats_and_bad_requests(sidecar):
    r = await sidecar.post("/v1/audio/transcriptions", data=_form(fmt=None))
    assert json.loads(await r.text()) == {"text": "This is an IEP meeting. We agreed to a daily check-in."}
    r = await sidecar.post("/v1/audio/transcriptions", data=_form(fmt="text"))
    assert (await r.text()).strip().startswith("This is an IEP meeting.")
    r = await sidecar.post("/v1/audio/transcriptions", data=_form(fmt="srt"))
    assert r.status == 400 and "response_format" in (await r.json())["error"]["message"]
    no_file = FormData()
    no_file.add_field("model", "whisper")
    r = await sidecar.post("/v1/audio/transcriptions", data=no_file)
    assert r.status == 400
    r = await sidecar.post("/v1/audio/transcriptions", data=_form(audio=b""))
    assert r.status == 400 and "empty" in (await r.json())["error"]["message"]
    r = await sidecar.post("/v1/audio/transcriptions", json={"file": "x"})
    assert r.status == 400
    h = await (await sidecar.get("/health")).json()
    assert h == {"ok": True, "model": "base.en", "loaded": True}


async def test_long_transcription_sends_keepalive_and_late_errors_in_body(monkeypatch):
    monkeypatch.setattr(whisper_server, "HEARTBEAT_S", 0.05)
    for engine, check in ((StubEngine(delay=0.3), "segments"), (StubEngine(delay=0.15, fail="Invalid data"), "error")):
        client = TestClient(TestServer(whisper_server.make_app(engine)))
        await client.start_server()
        try:
            r = await client.post("/v1/audio/transcriptions", data=_form())
            raw = await r.read()
            assert r.status == 200 and raw.startswith(b" ")  # heartbeats came first
            body = json.loads(raw)
            assert check in body
            if check == "error":
                assert body["error"]["message"] == "Invalid data"
            await asyncio.sleep(0.05)
            assert not Path(engine.calls[0]["path"]).exists()
        finally:
            await client.close()


async def _ollama_stub() -> web.Application:
    app = web.Application()
    app.router.add_get("/api/version", lambda r: web.json_response({"version": "0.12.0"}))
    app.router.add_route("*", "/{tail:.*}", lambda r: web.Response(status=404, text="404 page not found"))
    return app


async def test_proxy_routes_audio_to_sidecar_behind_the_token(tmp_path):
    from app.llm import TRANSCRIBE_UNSUPPORTED, RuntimeError_
    from app.llm.ollama import OllamaProvider

    engine = StubEngine()
    stt = TestServer(whisper_server.make_app(engine))
    ollama = TestServer(await _ollama_stub())
    await stt.start_server()
    await ollama.start_server()
    proxy = TestServer(token_proxy.make_app(str(ollama.make_url("")).rstrip("/"), TOKEN,
                                            str(stt.make_url("")).rstrip("/")))
    bare = TestServer(token_proxy.make_app(str(ollama.make_url("")).rstrip("/"), TOKEN))  # no sidecar
    await proxy.start_server()
    await bare.start_server()
    audio = tmp_path / "long.webm"
    audio.write_bytes(b"\x1a\x45\xdf\xa3" + b"\x01" * (3 * 1024 * 1024))  # streamed, not buffered
    try:
        async with aiohttp.ClientSession() as s:
            r = await s.post(proxy.make_url("/v1/audio/transcriptions"), data=_form())
            assert r.status == 401  # same token as Ollama
            r = await s.get(proxy.make_url("/api/version"), headers=AUTH)
            assert (await r.json())["version"] == "0.12.0"
        p = OllamaProvider(str(proxy.make_url("")).rstrip("/"), token=TOKEN)
        segs = await p.transcribe(audio, prompt="IEP meeting.")
        await p.aclose()
        assert [s.text for s in segs] == ["This is an IEP meeting.", "We agreed to a daily check-in."]
        assert engine.calls[-1]["bytes"] == audio.stat().st_size and engine.calls[-1]["suffix"] == ".webm"
        assert engine.calls[-1]["prompt"] == "IEP meeting."

        q = OllamaProvider(str(bare.make_url("")).rstrip("/"), token=TOKEN)
        with pytest.raises(RuntimeError_) as e:
            await q.transcribe(audio)
        await q.aclose()
        assert str(e.value) == TRANSCRIBE_UNSUPPORTED
    finally:
        for srv in (proxy, bare, stt, ollama):
            await srv.close()


def test_faster_whisper_adapter(monkeypatch, tmp_path):
    """The adapter's calls into faster-whisper (CPU, int8, cached weights, VAD) and its
    segment conversion, against a stand-in module."""
    Seg = namedtuple("Seg", "id seek start end text tokens temperature avg_logprob compression_ratio no_speech_prob")
    Info = namedtuple("Info", "language duration")
    seen = {}

    class WhisperModel:
        def __init__(self, name, **kw):
            seen["init"] = (name, kw)

        def transcribe(self, path, **kw):
            seen["transcribe"] = (path, kw)
            gen = (s for s in [Seg(0, 0, 0.0, 1.234, " Hi.", [5], 0.0, -0.1, 1.0, 0.0),
                               Seg(1, 100, 1.234, 2.0, " Bye.", [6], 0.0, -0.1, 1.0, 0.0)])
            return gen, Info("en", 2.0)

    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=WhisperModel))
    engine = whisper_server.FasterWhisper("small.en", cache_dir=str(tmp_path), threads=2, beam=1)
    out = engine.transcribe("/tmp/x.wav", language=None, prompt="Ms. Rivera")
    assert seen["init"] == ("small.en", {"device": "cpu", "compute_type": "int8", "cpu_threads": 2,
                                         "download_root": str(tmp_path)})
    path, kw = seen["transcribe"]
    assert path == "/tmp/x.wav" and kw["initial_prompt"] == "Ms. Rivera" and kw["vad_filter"] is True
    assert kw["language"] is None and kw["beam_size"] == 1
    assert out["text"] == "Hi. Bye." and out["segments"][0]["end"] == 1.23 and out["duration"] == 2.0
    monkeypatch.setenv("WHISPER_MODEL", "medium.en")
    assert whisper_server.FasterWhisper().name == "medium.en"
    monkeypatch.delenv("WHISPER_MODEL")
    assert whisper_server.FasterWhisper().name == "base.en"
