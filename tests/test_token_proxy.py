"""The token proxy that guards internet-reachable Ollama runtimes (Modal, tunnels)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

aiohttp = pytest.importorskip("aiohttp")
from aiohttp import web  # noqa: E402
from aiohttp.test_utils import TestClient, TestServer  # noqa: E402

spec = importlib.util.spec_from_file_location("token_proxy", Path(__file__).parents[1] / "deploy" / "token_proxy.py")
token_proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(token_proxy)

TOKEN = "t" * 24


async def _upstream_app() -> web.Application:
    async def chat(request: web.Request) -> web.StreamResponse:
        body = await request.json()
        assert "authorization" not in {k.lower() for k in request.headers}  # never forwarded
        resp = web.StreamResponse(headers={"Content-Type": "application/x-ndjson"})
        await resp.prepare(request)
        for word in ("hello ", body["model"]):
            await resp.write(f'{{"message":{{"content":"{word}"}}}}\n'.encode())
        await resp.write_eof()
        return resp

    app = web.Application()
    app.router.add_post("/api/chat", chat)
    app.router.add_get("/api/version", lambda r: web.json_response({"version": "0.12.0"}))
    return app


async def test_rejects_missing_or_wrong_token_and_streams_with_it():
    upstream = TestServer(await _upstream_app())
    await upstream.start_server()
    proxy = TestClient(TestServer(token_proxy.make_app(str(upstream.make_url("")).rstrip("/"), TOKEN)))
    await proxy.start_server()
    try:
        assert (await proxy.get("/api/version")).status == 401
        assert (await proxy.get("/api/version", headers={"Authorization": "Bearer nope"})).status == 401
        ok = await proxy.get("/api/version", headers={"Authorization": f"Bearer {TOKEN}"})
        assert ok.status == 200 and (await ok.json())["version"] == "0.12.0"
        r = await proxy.post("/api/chat", json={"model": "qwen3:8b"}, headers={"Authorization": f"Bearer {TOKEN}"})
        text = await r.text()
        assert r.status == 200 and "hello" in text and "qwen3:8b" in text
    finally:
        await proxy.close()
        await upstream.close()
