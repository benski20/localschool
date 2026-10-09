"""End-to-end API tests through FastAPI (FakeProvider runtime)."""

from __future__ import annotations

import time

from .conftest import PASSWORD, login, sse, wait_index


def test_auth_required_and_roles(client):
    assert client.get("/api/status").status_code == 401
    login(client, "jordan.lee@maplegrove.demo")
    assert client.get("/api/auth/me").json()["user"]["role"] == "teacher"
    assert client.get("/api/admin/models").status_code == 403
    assert client.post("/api/auth/login", json={"email": "jordan.lee@maplegrove.demo", "password": "x"}).status_code == 401


def test_chat_end_to_end_with_citations(client):
    login(client, "jordan.lee@maplegrove.demo")
    wait_index(client)
    r = client.post("/api/chat", json={"question": "Which of my students have extended time?"})
    assert r.headers["content-type"].startswith("text/event-stream")
    events = sse(r)
    done = events[-1]
    assert done["type"] == "done", events
    assert done["sources"] and done["content"]
    conv_id = events[0]["id"]
    conv = client.get(f"/api/conversations/{conv_id}").json()
    assert [m["role"] for m in conv["messages"]] == ["user", "assistant"]
    assert conv["messages"][1]["sources"] == done["sources"]

    # follow-up in same conversation; other users can't read it
    sse(client.post("/api/chat", json={"question": "And the cell phone policy?", "conversation_id": conv_id}))
    assert len(client.get(f"/api/conversations/{conv_id}").json()["messages"]) == 4
    client.post("/api/auth/logout")
    login(client, "sam.patel@maplegrove.demo")
    assert client.get(f"/api/conversations/{conv_id}").status_code == 404


def test_library_upload_paste_cite_delete(client):
    login(client, "jordan.lee@maplegrove.demo")
    r = client.post("/api/documents", files=[("files", ("bus-policy.md", b"# Buses\n\nBus 12 leaves at 3:05 pm sharp.", "text/markdown")),
                                             ("files", ("bad.exe", b"MZ", "application/octet-stream"))])
    body = r.json()
    assert len(body["created"]) == 1 and body["errors"][0]["filename"] == "bad.exe"
    doc_id = body["created"][0]
    client.post("/api/documents/text", json={"title": "Snow days", "text": "Snow days are announced by 6 am."})
    docs = client.get("/api/documents").json()["documents"]
    assert {"bus policy", "Snow days"} <= {d["title"] for d in docs}

    wait_index(client)
    done = sse(client.post("/api/chat", json={"question": "When does bus 12 leave?"}))[-1]
    src = next(s for s in done["sources"] if s["kind"] == "document")
    passage = client.get(f"/api/documents/{src['document_id']}/chunks/{src['chunk_id']}").json()
    assert any(p["cited"] and "3:05" in p["text"] for p in passage["passages"])

    client.post("/api/auth/logout")
    login(client, "sam.patel@maplegrove.demo")
    assert client.delete(f"/api/documents/{doc_id}").status_code == 403
    client.post("/api/auth/logout")
    login(client, "admin@test.local", "admin-pass-123")
    assert client.delete(f"/api/documents/{doc_id}").status_code == 200
    assert client.get(f"/api/documents/{doc_id}/file").status_code == 404


def test_roster_preview_import_and_scope(client):
    login(client, "admin@test.local", "admin-pass-123")
    csv = b"student_name,section,period,teacher_email,accommodations\nZed,Art,5,new.teacher@x.org,Breaks\n"
    prev = client.post("/api/roster/preview", files={"file": ("r.csv", csv, "text/csv")}).json()
    assert prev["students"] == 1 and not prev["errors"]
    res = client.post("/api/roster/import", files={"file": ("r.csv", csv, "text/csv")}).json()
    assert res["unmatched_teachers"] == ["new.teacher@x.org"]
    # creating the teacher afterwards links their section automatically
    assert client.post("/api/admin/users", json={"email": "new.teacher@x.org", "name": "New",
                                                 "role": "teacher", "password": PASSWORD}).status_code == 200
    client.post("/api/auth/logout")
    login(client, "new.teacher@x.org")
    data = client.get("/api/roster").json()
    assert [s["name"] for s in data["students"]] == ["Zed"]
    assert data["students"][0]["accommodations"] == ["Breaks"]


def test_admin_models_pull_activate_and_runtime(client):
    login(client, "admin@test.local", "admin-pass-123")
    m = client.get("/api/admin/models").json()
    assert m["active"] == {"chat": "fake-chat", "embed": "fake-embed"}
    assert {x["name"] for x in m["installed"]} == {"fake-chat", "fake-embed"}
    assert m["presets"]["chat"]

    assert client.put("/api/admin/models/active", json={"role": "chat", "model": "qwen3:8b"}).status_code == 400
    client.post("/api/admin/models/pull", json={"model": "qwen3:8b"})
    deadline = time.time() + 3
    while time.time() < deadline:
        pulls = client.get("/api/admin/models/pulls").json()["pulls"]
        if pulls and pulls[0]["done"]:
            break
        time.sleep(0.02)
    assert pulls[0]["status"] == "ready"
    r = client.put("/api/admin/models/active", json={"role": "chat", "model": "qwen3:8b"})
    assert r.json()["active"]["chat"] == "qwen3:8b"
    assert client.delete("/api/admin/models/qwen3:8b").status_code == 400  # in use

    t = client.post("/api/admin/runtime/test").json()
    assert t["health"]["ok"] and t["is_local"]
    put = client.put("/api/admin/runtime", json={"kind": "ollama", "url": "https://demo--ollama.modal.run",
                                                  "token": "tok-abcdefgh1234"})
    assert put.json()["config"]["is_local"] is False
    status = client.get("/api/status").json()
    assert status["runtime"]["is_local"] is False and status["runtime"]["state"] == "idle"


def test_spa_fallback_message_without_build(client):
    r = client.get("/chat")
    assert r.status_code == 404 and "not built" in r.json()["error"]
    assert client.get("/api/nope").status_code == 404
