"""OllamaProvider against Ollama's real wire formats (mocked HTTP, no server)."""

from __future__ import annotations

import io
import json

import httpx
import pytest

from app.llm import ChatMessage, RuntimeError_
from app.llm.ollama import OllamaProvider
from app.services.ingest import parse_file


def handler(request: httpx.Request) -> httpx.Response:
    assert request.headers["authorization"] == "Bearer tok"
    assert request.headers["modal-key"] == "k"
    path = request.url.path
    if path == "/v1/chat/completions":
        body = json.loads(request.content)
        assert body["stream"] is True and body["model"] == "qwen3:8b"
        chunks = ["<think>", "plan the answer", "</think>", "Room ", "114 [1]."]
        lines = [f"data: {json.dumps({'choices': [{'delta': {'content': c}}]})}\n\n" for c in chunks]
        lines.append("data: [DONE]\n\n")
        return httpx.Response(200, text="".join(lines), headers={"content-type": "text/event-stream"})
    if path == "/v1/embeddings":
        inputs = json.loads(request.content)["input"]
        data = [{"index": i, "embedding": [float(i), 1.0]} for i in reversed(range(len(inputs)))]
        return httpx.Response(200, json={"data": data})
    if path == "/api/tags":
        return httpx.Response(200, json={"models": [
            {"name": "qwen3:8b", "size": 5_200_000_000,
             "details": {"parameter_size": "8.2B", "quantization_level": "Q4_K_M", "family": "qwen3"}},
            {"name": "nomic-embed-text:latest", "size": 274_000_000, "details": {}},
        ]})
    if path == "/api/ps":
        return httpx.Response(200, json={"models": [{"name": "qwen3:8b", "size_vram": 6_000_000_000}]})
    if path == "/api/version":
        return httpx.Response(200, json={"version": "0.12.0"})
    if path == "/api/pull":
        name = json.loads(request.content)["model"]
        if name == "nope":
            return httpx.Response(200, text=json.dumps({"error": "pull model manifest: file does not exist"}) + "\n")
        evts = [{"status": "pulling manifest"}, {"status": "downloading", "total": 10, "completed": 4},
                {"status": "downloading", "total": 10, "completed": 10}, {"status": "success"}]
        return httpx.Response(200, text="\n".join(json.dumps(e) for e in evts) + "\n")
    if path == "/api/delete":
        return httpx.Response(200)
    return httpx.Response(404, json={"error": "not found"})


@pytest.fixture
def provider():
    return OllamaProvider("https://demo--ollama.modal.run", token="tok", headers={"Modal-Key": "k"},
                          transport=httpx.MockTransport(handler))


async def test_chat_streams_visible_text_only(provider):
    out = [t async for t in provider.chat("qwen3:8b", [ChatMessage("user", "hi")])]
    assert "".join(out) == "Room 114 [1]."


async def test_embed_orders_by_index(provider):
    assert await provider.embed("nomic-embed-text", ["a", "b", "c"]) == [[0.0, 1.0], [1.0, 1.0], [2.0, 1.0]]


async def test_models_health_pull_delete(provider):
    models = await provider.list_models()
    assert [m.name for m in models] == ["nomic-embed-text:latest", "qwen3:8b"]
    assert models[1].loaded and models[1].parameter_size == "8.2B"
    h = await provider.health()
    assert h.ok and h.version == "0.12.0" and h.vram_bytes == 6_000_000_000
    progress = [p async for p in provider.pull("qwen3:8b")]
    assert progress[-1].status == "success" and progress[2].completed == 10
    with pytest.raises(RuntimeError_, match="does not exist"):
        _ = [p async for p in provider.pull("nope")]
    await provider.delete("qwen3:8b")


async def test_auth_error_is_explained():
    p = OllamaProvider("http://x", transport=httpx.MockTransport(lambda r: httpx.Response(401, text="no")))
    with pytest.raises(RuntimeError_, match="credentials"):
        await p.list_models()
    h = await p.health()
    assert not h.ok and "credentials" in h.error


def test_parse_docx_headings_and_tables():
    import docx

    d = docx.Document()
    d.add_heading("Dress code", level=1)
    d.add_paragraph("Hats are not allowed indoors.")
    t = d.add_table(rows=1, cols=2)
    t.rows[0].cells[0].text, t.rows[0].cells[1].text = "Period 1", "8:00"
    buf = io.BytesIO()
    d.save(buf)
    text = parse_file("policy.docx", buf.getvalue())[0].text
    assert "# Dress code" in text and "Hats are not allowed" in text and "Period 1 | 8:00" in text
