"""End-to-end API tests through FastAPI (FakeProvider runtime)."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.main import create_app

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


def test_health_identifies_server_for_mac_app(client):
    h = client.get("/api/health").json()
    assert h["app"] == "localschool" and h["ok"] and h["school"]


def test_spa_fallback_message_without_build(client):
    r = client.get("/chat")
    assert r.status_code == 404 and "not built" in r.json()["error"]
    assert client.get("/api/nope").status_code == 404


def test_mac_install_script_served_with_this_servers_address(client, settings):
    login(client, "admin@test.local", "admin-pass-123")
    info = client.get("/api/admin/install").json()
    assert not info["mac_app_present"] and info["command"].endswith("/install/mac.sh | bash")
    assert client.get("/install/mac.sh").status_code == 404  # no app uploaded yet

    zip_file = settings.data_dir / "downloads" / "LocalSchool-macOS.zip"
    zip_file.parent.mkdir(parents=True, exist_ok=True)
    zip_file.write_bytes(b"PK\x05\x06" + b"\x00" * 18)
    script = client.get("/install/mac.sh").text
    assert 'LOCALSCHOOL_SERVER:-http://testserver}' in script
    assert 'LOCALSCHOOL_ZIP_URL:-http://testserver/install/LocalSchool-macOS.zip}' in script
    assert "__SERVER__" not in script and "set -euo pipefail" in script
    assert client.get("/install/LocalSchool-macOS.zip").content.startswith(b"PK")
    assert client.get("/api/admin/install").json()["mac_app_present"]


def test_mac_install_falls_back_to_release_url_behind_https_proxy(client, settings):
    settings.mac_app_url = "https://github.com/o/r/releases/latest/download/LocalSchool-macOS.zip"
    script = client.get("/install/mac.sh", headers={"x-forwarded-proto": "https"}).text
    assert 'LOCALSCHOOL_SERVER:-https://testserver}' in script
    assert f'LOCALSCHOOL_ZIP_URL:-{settings.mac_app_url}}}' in script
    assert client.get("/api/health").json()["mac_release_page"] == "https://github.com/o/r/releases/latest"
    script = client.get("/install/mac.sh", headers={"x-forwarded-proto": "https",
                                                    "x-forwarded-host": "desk.example.org"}).text
    assert 'LOCALSCHOOL_SERVER:-https://desk.example.org}' in script
    settings.public_url = "https://desk.example.net/"
    assert 'LOCALSCHOOL_SERVER:-https://desk.example.net}' in client.get("/install/mac.sh").text
    settings.public_url = ""
    bad = client.get("/install/mac.sh", headers={"x-forwarded-host": "evil.org/\"; rm -rf ~"}).text
    assert "evil" not in bad
    r = client.get("/install/LocalSchool-macOS.zip", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == settings.mac_app_url


def test_db_dependency_commits_before_the_response_is_sent():
    """With FastAPI's default request scope, a yield dependency's teardown (our commit)
    can run after the response is sent, so a client's very next request (e.g. right after
    login) may not see the new session row. Every use must be function-scoped."""
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "app"
    uses = []
    for path in [root / "deps.py", *sorted((root / "routes").glob("*.py"))]:
        uses += [(path.name, m.group(0)) for m in re.finditer(r"Depends\((?:deps\.)?db\b[^)]*\)", path.read_text())]
    assert uses, "expected database dependencies"
    unscoped = [u for u in uses if 'scope="function"' not in u[1]]
    assert not unscoped, unscoped


def test_change_password(client):
    login(client, "jordan.lee@maplegrove.demo")
    assert client.put("/api/auth/password", json={"current": "wrong", "new": "brand-new-pass"}).status_code == 400
    assert client.put("/api/auth/password", json={"current": PASSWORD, "new": "short"}).status_code == 400
    assert client.put("/api/auth/password", json={"current": PASSWORD, "new": "brand-new-pass"}).status_code == 200
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"email": "jordan.lee@maplegrove.demo", "password": PASSWORD}).status_code == 401
    login(client, "jordan.lee@maplegrove.demo", "brand-new-pass")


def test_health_offers_demo_login_only_in_demo_mode(client, settings):
    assert "demo" not in client.get("/api/health").json()
    settings.demo_logins = True
    assert client.get("/api/health").json()["demo"]["email"] == "jordan.lee@maplegrove.demo"


def test_personal_desk_on_a_teachers_mac(settings, fake):
    # scripts/setup-local-mac.sh: the teacher is the one account, and health says so.
    settings.local_mode = True
    settings.admin_name = "Jordan Lee"
    settings.admin_email = "jordan@shipley.test"
    with TestClient(create_app(settings, factory=lambda cfg, s: fake)) as c:
        assert c.get("/api/health").json()["local"] is True
        login(c, "jordan@shipley.test", "admin-pass-123")
        me = c.get("/api/auth/me").json()["user"]
        assert me["name"] == "Jordan Lee" and me["role"] == "admin"


TRIP = (b"# Field trip permission\n\nGrade 7 science museum visit on November 14. "
        b"Signed zebrafish permission forms are due November 7.")


def _relogin(c, email, password=PASSWORD):
    c.post("/api/auth/logout")
    login(c, email, password)


def test_private_documents_are_invisible_to_everyone_else(client):
    login(client, "jordan.lee@maplegrove.demo")
    up = client.post("/api/documents", data={"visibility": "private"},
                     files=[("files", ("trip.md", TRIP, "text/markdown"))]).json()
    doc_id = up["created"][0]
    pasted = client.post("/api/documents/text", json={
        "title": "My notes", "text": "Zebrafish tank cleaning on Fridays.", "visibility": "private"}).json()["id"]
    assert client.post("/api/documents", data={"visibility": "secret"},
                       files=[("files", ("x.md", b"x", "text/markdown"))]).status_code == 400
    mine = {d["id"]: d for d in client.get("/api/documents").json()["documents"]}
    assert mine[doc_id]["visibility"] == mine[pasted]["visibility"] == "private" and mine[doc_id]["mine"] is True
    school = next(d for d in mine.values() if d["title"] == "Handbook")
    assert school["visibility"] == "school" and school["mine"] is False
    assert client.get(f"/api/documents/{doc_id}/file").status_code == 200
    assert client.get(f"/api/documents/{doc_id}/preview").json()["passages"]

    wait_index(client)  # vectors too: neither keyword nor vector search may leak it
    done = sse(client.post("/api/chat", json={"question": "When are the zebrafish permission forms due?"}))[-1]
    own = [s for s in done["sources"] if s["document_id"] == doc_id]
    assert own, done  # the owner's private file is searchable for the owner
    passage = f"/api/documents/{doc_id}/chunks/{own[0]['chunk_id']}"
    assert client.get(passage).status_code == 200

    _relogin(client, "sam.patel@maplegrove.demo")
    assert not {doc_id, pasted} & {d["id"] for d in client.get("/api/documents").json()["documents"]}
    assert client.get(f"/api/documents/{doc_id}/file").status_code == 404
    assert client.get(f"/api/documents/{doc_id}/preview").status_code == 404
    assert client.get(passage).status_code == 404
    assert client.delete(f"/api/documents/{doc_id}").status_code == 404
    for body in ({"question": "When are the zebrafish permission forms due?"},
                 {"question": "When are the zebrafish permission forms due?", "attachments": [doc_id, pasted]}):
        events = sse(client.post("/api/chat", json=body))
        assert events[0]["attachments"] == []
        srcs = next(e for e in events if e["type"] == "sources")["sources"]
        assert not {s["document_id"] for s in srcs} & {doc_id, pasted}
        assert all(s["kind"] != "attachment" for s in srcs)
        assert "zebrafish" not in events[-1]["content"].lower()

    # admins don't see a teacher's private files either, but can remove them
    _relogin(client, "admin@test.local", "admin-pass-123")
    assert doc_id not in {d["id"] for d in client.get("/api/documents").json()["documents"]}
    assert client.get(f"/api/documents/{doc_id}/file").status_code == 404
    assert client.delete(f"/api/documents/{doc_id}").status_code == 200
    # and owners delete their own
    _relogin(client, "jordan.lee@maplegrove.demo")
    assert client.delete(f"/api/documents/{pasted}").status_code == 200
    assert not {doc_id, pasted} & {d["id"] for d in client.get("/api/documents").json()["documents"]}


def test_chat_attachment_is_cited_and_kept_for_follow_ups(client):
    login(client, "jordan.lee@maplegrove.demo")
    doc_id = client.post("/api/documents", data={"visibility": "private"},
                         files=[("files", ("trip.md", TRIP, "text/markdown"))]).json()["created"][0]
    events = sse(client.post("/api/chat", json={"question": "When are forms due?", "attachments": [doc_id, 99999]}))
    assert events[0]["attachments"] == [doc_id]
    done = events[-1]
    assert done["type"] == "done" and "November 7" in done["content"]
    cited = done["sources"][0]
    assert cited["kind"] == "attachment" and cited["document_id"] == doc_id and cited["title"] == "trip"
    conv_id = events[0]["id"]
    # a follow-up that doesn't re-send the attachment still uses it
    events = sse(client.post("/api/chat", json={"question": "What grade is it for?", "conversation_id": conv_id}))
    assert events[0]["attachments"] == [doc_id]
    assert next(e for e in events if e["type"] == "sources")["sources"][0]["kind"] == "attachment"
    conv = client.get(f"/api/conversations/{conv_id}").json()
    assert conv["attachments"] == [{"id": doc_id, "title": "trip"}]
    assert conv["messages"][1]["sources"][0]["kind"] == "attachment"
    # deleting the file detaches it
    client.delete(f"/api/documents/{doc_id}")
    assert client.get(f"/api/conversations/{conv_id}").json()["attachments"] == []


def _wait_pulls(c):
    deadline = time.time() + 3
    while time.time() < deadline and not all(p["done"] for p in c.get("/api/admin/models/pulls").json()["pulls"]):
        time.sleep(0.02)


def test_teacher_model_choices(client, settings):
    login(client, "jordan.lee@maplegrove.demo")
    # the seeded Fast/Thorough (qwen3) aren't on the fake runtime: the active model is the one option
    assert client.get("/api/models").json() == {"default": "fake-chat", "options": [
        {"model": "fake-chat", "label": "Standard", "description": "", "installed": True}]}
    assert client.get("/api/admin/models/choices").status_code == 403
    assert client.put("/api/admin/models/choices", json={"options": []}).status_code == 403

    _relogin(client, "admin@test.local", "admin-pass-123")
    seeded = client.get("/api/admin/models/choices").json()
    assert [(o["model"], o["label"], o["installed"]) for o in seeded["options"]] == [
        ("qwen3:1.7b", "Fast", False), ("qwen3:4b-instruct-2507-q4_K_M", "Thorough", False)]
    assert client.put("/api/admin/models/choices", json={"options": []}).status_code == 400
    assert client.put("/api/admin/models/choices", json={
        "options": [{"model": "fake-chat", "label": "Fast"}], "default": "nope"}).status_code == 400
    r = client.put("/api/admin/models/choices", json={"default": "qwen3:4b-instruct-2507-q4_K_M", "options": [
        {"model": "fake-chat", "label": "Fast", "description": "Quick answers in a few seconds."},
        {"model": "qwen3:4b-instruct-2507-q4_K_M", "label": "Thorough", "description": "Takes a little longer."}]}).json()
    assert r["default"] == "qwen3:4b-instruct-2507-q4_K_M" and [o["installed"] for o in r["options"]] == [True, False]

    _relogin(client, "jordan.lee@maplegrove.demo")
    m = client.get("/api/models").json()
    assert [o["model"] for o in m["options"]] == ["fake-chat"] and m["default"] == "fake-chat"
    done = sse(client.post("/api/chat", json={"question": "late work policy", "model": "qwen3:4b-instruct-2507-q4_K_M"}))[-1]
    assert done["model"] == "fake-chat"  # offered but not installed → silently the active model

    _relogin(client, "admin@test.local", "admin-pass-123")
    client.post("/api/admin/models/pull", json={"model": "qwen3:4b-instruct-2507-q4_K_M"})
    _wait_pulls(client)

    _relogin(client, "jordan.lee@maplegrove.demo")
    m = client.get("/api/models").json()
    assert [(o["model"], o["label"]) for o in m["options"]] == [("fake-chat", "Fast"), ("qwen3:4b-instruct-2507-q4_K_M", "Thorough")]
    assert m["default"] == "qwen3:4b-instruct-2507-q4_K_M"
    events = sse(client.post("/api/chat", json={"question": "late work policy", "model": "qwen3:4b-instruct-2507-q4_K_M"}))
    assert events[-1]["model"] == "qwen3:4b-instruct-2507-q4_K_M"
    assert client.get(f"/api/conversations/{events[0]['id']}").json()["messages"][1]["model"] == "qwen3:4b-instruct-2507-q4_K_M"
    # adapt drafts with the most thorough option, other tools with the default; an explicit choice wins
    from app.db import connect
    with connect(settings.db_path) as db:
        ava = db.execute("SELECT id FROM students WHERE name = 'Ava Thompson'").fetchone()[0]
    email = {"student_id": ava, "topic": "Field trip"}
    assert client.post("/api/tools/email/drafts", json=email).json()["draft"]["model"] == m["default"]
    reading = {"text": "Volcanoes are openings in the crust.", "versions": [{"level": "grade_3"}]}
    tool = client.post("/api/tools/adapt/drafts", json=reading).json()["draft"]
    assert tool["model"] == "qwen3:4b-instruct-2507-q4_K_M"
    tool = client.post("/api/tools/adapt/drafts", json={**reading, "model": "fake-chat"}).json()["draft"]
    assert tool["model"] == "fake-chat"
    # installed but not offered to teachers → not allowed
    assert sse(client.post("/api/chat", json={"question": "hi", "model": "fake-embed"}))[-1]["model"] == "fake-chat"


# -- personal desks: a teacher's Mac borrows the school's models ----------------------

def _device(client, password=PASSWORD):
    return client.post("/api/auth/device", json={"email": "jordan.lee@maplegrove.demo", "password": password,
                                                 "label": "Jordan's MacBook Air"})


def test_device_key_needs_the_teachers_school_sign_in(client, settings):
    assert _device(client, "wrong-password").status_code == 401
    r = _device(client)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["key"].startswith("ls_dev_") and d["relay_url"].endswith("/api/relay")
    assert d["name"] == "Jordan Lee" and d["chat_model"] == "fake-chat" and d["embed_model"] == "fake-embed"
    from app.db import connect
    with connect(settings.db_path) as db:
        stored = db.execute("SELECT key_hash FROM device_keys").fetchone()["key_hash"]
    assert d["key"] not in stored  # only the hash is kept


def test_relay_serves_only_model_calls_to_a_known_mac(client):
    key = _device(client).json()["key"]
    h = {"Authorization": f"Bearer {key}"}
    assert client.get("/api/relay/models").status_code == 401
    assert client.get("/api/relay/models", headers={"Authorization": "Bearer ls_dev_nope"}).status_code == 401
    assert client.post("/api/relay/pull", headers=h, json={"model": "x"}).status_code in (404, 405)
    assert "fake-chat" in [m["name"] for m in client.get("/api/relay/models", headers=h).json()["models"]]
    v = client.post("/api/relay/embed", headers=h, json={"model": "fake-embed", "texts": ["a", "b"]}).json()
    assert len(v["vectors"]) == 2
    r = client.post("/api/relay/chat", headers=h, json={"model": "fake-chat", "messages": [
        {"role": "user", "content": "SOURCES:\n[1] Handbook\nLate work loses 10% per day.\n\nQUESTION: late work?"}]})
    assert r.status_code == 200 and r.text
    seg = client.post("/api/relay/transcribe", headers=h, files={"file": ("a.wav", b"RIFF....")}).json()["segments"]
    assert seg and seg[0]["text"]
    assert client.post("/api/relay/chat", headers=h, json={"model": "missing", "messages": []}).status_code >= 400

    # The admin sees the Mac and can cut it off.
    login(client, "admin@test.local", "admin-pass-123")
    devs = client.get("/api/admin/devices").json()["devices"]
    assert devs[0]["label"] == "Jordan's MacBook Air" and devs[0]["last_used_at"]
    assert client.delete(f"/api/admin/devices/{devs[0]['id']}").status_code == 200
    assert client.get("/api/relay/models", headers=h).status_code == 401


def test_personal_desk_runs_on_the_relay(client, settings, tmp_path):
    """The Mac's RelayProvider against the school server, end to end."""
    import asyncio

    import httpx

    from app.llm.base import ChatMessage, RuntimeError_
    from app.llm.relay import RelayProvider

    key = _device(client).json()["key"]
    transport = httpx.ASGITransport(app=client.app)
    audio = tmp_path / "m.wav"
    audio.write_bytes(b"RIFF....")

    async def go():
        p = RelayProvider("http://school/api/relay", token=key, transport=transport)
        assert (await p.health()).ok
        assert "fake-embed" in [m.name for m in await p.list_models()]
        assert len((await p.embed("fake-embed", ["x"] * 300))[0]) > 0
        text = "".join([c async for c in p.chat("fake-chat", [ChatMessage("user", "hello")])])
        assert text
        assert await p.transcribe(audio)
        try:
            [c async for c in p.pull("x")]
            raise AssertionError("pull should be refused")
        except RuntimeError_:
            pass
        bad = RelayProvider("http://school/api/relay", token="ls_dev_revoked", transport=transport)
        assert not (await bad.health()).ok
        await p.aclose(); await bad.aclose()

    asyncio.run(go())
