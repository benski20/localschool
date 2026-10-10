"""Service tests against a real SQLite file and the FakeProvider (no GPU needed)."""

from __future__ import annotations

import asyncio
from datetime import date

import pytest

from app.db import connect
from app.llm import RuntimeConfig
from app.llm.fake import FakeProvider
from app.services import chat, embeddings, ingest, retrieval
from app.services.models import (PullManager, is_installed, list_choices, load_choice_config, pick_default,
                                 set_choices)

from .conftest import user


async def test_embeddings_fill_active_space_and_search_hybrid(seeded):
    n = await embeddings.sync_embeddings(seeded)
    with connect(seeded.db_path) as db:
        status = embeddings.index_status(db, "fake-embed")
        assert n == status.total_chunks == status.embedded_chunks > 0
        space = embeddings.get_space(db, "fake-embed")
        assert space["status"] == "ready"
        vec = (await (await seeded.provider()).embed("fake-embed", ["separate setting Room 114"]))[0]
        hits = retrieval.hybrid_search(db, "Where do students take tests in a separate setting?",
                                       user_id=None, space_id=space["id"], query_vec=vec)
    assert hits and "Room 114" in hits[0].text
    assert "keyword" in hits[0].matched_by and "vector" in hits[0].matched_by


async def test_swapping_embed_model_builds_new_space_without_mixing(seeded, fake: FakeProvider):
    await embeddings.sync_embeddings(seeded)
    fake.models.add("other-embed")
    seeded.set_active_model("embed", "other-embed")
    with connect(seeded.db_path) as db:
        assert embeddings.index_status(db, "other-embed").embedded_chunks == 0  # old vectors not reused
    await embeddings.sync_embeddings(seeded)
    with connect(seeded.db_path) as db:
        spaces = {r["model"]: r["id"] for r in db.execute("SELECT * FROM embedding_spaces")}
        assert set(spaces) == {"fake-embed", "other-embed"}
        assert embeddings.index_status(db, "other-embed").ready
    assert ("embed", "other-embed") in fake.calls


def test_roster_scoping_per_teacher(seeded, settings):
    jordan = user(settings, "jordan.lee@maplegrove.demo")
    sam = user(settings, "sam.patel@maplegrove.demo")
    admin = user(settings, "admin@test.local")
    with connect(settings.db_path) as db:
        j = chat.build_sources(db, jordan, "Who is in my class?", space_id=None, query_vec=None)
        s = chat.build_sources(db, sam, "Who is in my class?", space_id=None, query_vec=None)
        a = chat.build_sources(db, admin, "Who is in each class?", space_id=None, query_vec=None)
    j_students = {x.title for x in j if x.kind == "student"}
    s_students = {x.title for x in s if x.kind == "student"}
    assert len(j_students) == 20 and len(s_students) == 10
    assert "Daniel Walker" in s_students and "Daniel Walker" not in j_students
    assert len([x for x in a if x.kind == "student"]) == 30


def test_named_student_narrows_roster_sources(seeded, settings):
    jordan = user(settings, "jordan.lee@maplegrove.demo")
    with connect(settings.db_path) as db:
        src = chat.build_sources(db, jordan, "When is Mateo's plan review?", space_id=None, query_vec=None)
    assert [x.title for x in src if x.kind == "student"] == ["Mateo Hernandez"]


def test_policy_question_skips_roster(seeded, settings):
    jordan = user(settings, "jordan.lee@maplegrove.demo")
    with connect(settings.db_path) as db:
        src = chat.build_sources(db, jordan, "What is the cell phone policy?", space_id=None, query_vec=None)
    assert src and all(x.kind == "document" for x in src)


async def _collect(gen):
    return [e async for e in gen]


async def test_answer_streams_validates_and_persists(seeded, settings):
    jordan = user(settings, "jordan.lee@maplegrove.demo")
    events = await _collect(chat.answer(seeded, jordan, "What is the late work policy?", today=date(2026, 10, 9)))
    kinds = [e["type"] for e in events]
    assert kinds[0] == "conversation" and kinds[1] == "sources" and kinds[-1] == "done"
    done = events[-1]
    assert done["sources"] and "[1]" in done["content"]
    with connect(settings.db_path) as db:
        rows = db.execute("SELECT role FROM messages ORDER BY id").fetchall()
    assert [r["role"] for r in rows] == ["user", "assistant"]


async def test_queue_when_generation_slots_full(seeded, settings, fake):
    fake.delay_s = 0.01
    seeded.generation_slots = asyncio.Semaphore(1)
    jordan = user(settings, "jordan.lee@maplegrove.demo")
    a, b = await asyncio.gather(
        _collect(chat.answer(seeded, jordan, "late work policy")),
        _collect(chat.answer(seeded, jordan, "cell phone policy")),
    )
    assert any(e["type"] == "queued" for e in a + b)
    assert a[-1]["type"] == b[-1]["type"] == "done"


async def test_runtime_down_yields_error_and_keyword_fallback(settings):
    from app.llm import Runtime
    from app.llm.registry import default_factory
    from app.main import bootstrap
    from .conftest import seed

    bootstrap(settings)
    seed(settings)
    rt = Runtime(settings, factory=default_factory)
    rt.save_config(RuntimeConfig(kind="ollama", url="http://127.0.0.1:9"))  # nothing listens
    rt.settings.runtime_timeout_s = 2
    jordan = user(settings, "jordan.lee@maplegrove.demo")
    events = await _collect(chat.answer(rt, jordan, "late work policy"))
    assert events[1]["type"] == "sources" and events[1]["sources"]  # keyword retrieval still worked
    assert events[-1]["type"] == "error" and "reach" in events[-1]["message"].lower()
    assert rt.reachability()["state"] == "unreachable"
    await rt.aclose()


def test_runtime_config_overrides_and_validation(runtime):
    assert runtime.config().kind == "fake"
    runtime.save_config(RuntimeConfig(kind="ollama", url="https://x.modal.run/", token="secret-token-123",
                                      headers='{"Modal-Key": "k-123456789"}'))
    cfg = runtime.config()
    assert cfg.url == "https://x.modal.run" and cfg.header_dict() == {"Modal-Key": "k-123456789"}
    pub = cfg.public()
    assert "secret" not in pub["token"] and pub["is_local"] is False and pub["has_token"]
    with pytest.raises(ValueError):
        runtime.save_config(RuntimeConfig(kind="ollama", url="ftp://nope"))
    with pytest.raises(ValueError):
        runtime.save_config(RuntimeConfig(kind="ollama", url="http://a", headers="[1]"))


def test_active_model_registry(runtime):
    assert runtime.active_models() == {"chat": "fake-chat", "embed": "fake-embed"}
    runtime.set_active_model("chat", "gpt-oss:20b")
    assert runtime.active_model("chat") == "gpt-oss:20b"
    with pytest.raises(ValueError):
        runtime.set_active_model("vision", "x")


async def test_pull_manager_runs_in_background(runtime, fake):
    pm = PullManager(runtime)
    pm.start("qwen3:8b")
    state = await pm.wait("qwen3:8b")
    assert state.done and not state.error and state.percent == 100.0
    assert "qwen3:8b" in fake.models


def _student_sources(settings, question):
    jordan = user(settings, "jordan.lee@maplegrove.demo")
    with connect(settings.db_path) as db:
        return [x.title for x in chat.build_sources(db, jordan, question, space_id=None, query_vec=None)
                if x.kind == "student"]


def test_roster_filters_give_the_model_only_matching_students(seeded, settings):
    assert sorted(_student_sources(settings, "Which of my students have an IEP?")) == [
        "Aaliyah Jackson", "Ava Thompson", "Lucas Martin", "Mateo Hernandez"]
    assert sorted(_student_sources(settings, "Who has extended-time accommodations?")) == [
        "Aaliyah Jackson", "Amara Diallo", "Ava Thompson", "Elijah Moore", "Mateo Hernandez", "Mia Johnson"]
    assert sorted(_student_sources(settings, "Which IEP students get extended time?")) == [
        "Aaliyah Jackson", "Ava Thompson", "Mateo Hernandez"]
    assert sorted(_student_sources(settings, "Which of my students are English learners?")) == [
        "Amara Diallo", "Camila Torres", "Mateo Hernandez", "Sofia Ramirez"]


def test_roster_filter_with_no_matches_says_so(seeded, settings):
    assert _student_sources(settings, "Which of my students have a 504 plan and a read-aloud accommodation?") \
        == ["Roster search"]


def test_unfiltered_roster_question_still_gets_whole_class(seeded, settings):
    assert len(_student_sources(settings, "Who is in my class?")) == 20


TRIP = ("# Field trip permission\n\nGrade 7 science museum visit on November 14.\n\n"
        "## Forms\n\nSigned permission forms are due November 7. Bring a bag lunch.")


def _private_doc(settings, owner, text=TRIP, title="Field trip") -> int:
    with connect(settings.db_path) as db:
        return ingest.store_document(db, title=title, filename="trip.md", mime="text/markdown",
                                     data=text.encode(), owner_id=owner["id"], files_dir=settings.files_dir,
                                     visibility="private")


async def test_private_documents_never_retrieved_for_others(seeded, settings):
    jordan = user(settings, "jordan.lee@maplegrove.demo")
    sam = user(settings, "sam.patel@maplegrove.demo")
    doc = _private_doc(settings, jordan)
    await embeddings.sync_embeddings(seeded)
    q = "When are the field trip permission forms due?"
    vec = (await (await seeded.provider()).embed("fake-embed", [q]))[0]
    with connect(settings.db_path) as db:
        space = embeddings.get_space(db, "fake-embed")["id"]
        private = {r[0] for r in db.execute("SELECT id FROM chunks WHERE document_id = ?", (doc,))}
        for who, sees in ((jordan, True), (sam, False), (None, False)):
            uid = who["id"] if who else None
            kw = set(retrieval.keyword_search(db, q, user_id=uid))
            vs = set(retrieval.vector_search(db, space, vec, user_id=uid, limit=200))
            hits = {h.document_id for h in retrieval.hybrid_search(db, q, user_id=uid, space_id=space, query_vec=vec)}
            assert bool(kw & private) == bool(vs & private) == (doc in hits) == sees
        # Sam naming Jordan's doc as an attachment gets nothing from it
        src = chat.build_sources(db, sam, q, space_id=space, query_vec=vec, attachments=[doc])
        assert all(s.document_id != doc and s.kind != "attachment" for s in src)
        # and an attachment must be private: a school document id is ignored
        handbook = db.execute("SELECT id FROM documents WHERE title = 'Handbook'").fetchone()[0]
        assert chat.valid_attachments(db, jordan["id"], [handbook, doc, doc]) == [doc]


async def test_attachment_cited_with_zero_embeddings(seeded, settings):
    jordan = user(settings, "jordan.lee@maplegrove.demo")
    doc = _private_doc(settings, jordan)
    with connect(settings.db_path) as db:
        assert embeddings.index_status(db, "fake-embed").embedded_chunks == 0
        # keyword match within the file (best passage first)…
        src = chat.build_sources(db, jordan, "When are forms due?", space_id=None, query_vec=None, attachments=[doc])
        assert src[0].kind == "attachment" and "November 7" in src[0].text and src[0].title == "Field trip"
        assert src[0].subtitle == "Forms" and "Your file: Field trip" in src[0].prompt_block()
        # …or, with no keyword overlap, the file's opening passages
        src = chat.build_sources(db, jordan, "Summarize this", space_id=None, query_vec=None, attachments=[doc])
        assert [s.kind for s in src[:2]] == ["attachment", "attachment"] and "November 14" in src[0].text
    events = await _collect(chat.answer(seeded, jordan, "When are forms due?", attachments=[doc]))
    done = events[-1]
    assert done["type"] == "done" and done["sources"][0]["kind"] == "attachment"
    assert "November 7" in done["content"] and "[1]" in done["content"]


async def test_chat_model_choice_and_fallback(seeded, settings, fake):
    jordan = user(settings, "jordan.lee@maplegrove.demo")
    fake.models.add("fake-thorough")
    with connect(settings.db_path) as db:
        set_choices(db, [{"model": "fake-chat", "label": "Fast"}, {"model": "fake-thorough", "label": "Thorough"}],
                    "fake-chat")
    for asked, used in (("fake-thorough", "fake-thorough"), ("gpt-oss:20b", "fake-chat"),
                        ("fake-embed", "fake-chat"), (None, "fake-chat")):
        done = (await _collect(chat.answer(seeded, jordan, "late work policy", model=asked)))[-1]
        assert done["model"] == used, asked
        assert fake.calls[-1] == ("chat", used)
    with connect(settings.db_path) as db:
        stored = [r[0] for r in db.execute("SELECT model FROM messages WHERE role = 'assistant' ORDER BY id")]
    assert stored == ["fake-thorough", "fake-chat", "fake-chat", "fake-chat"]


def test_choice_defaults():
    assert pick_default(["a", "b"], "", "b") == "b"          # active model, when offered
    assert pick_default(["a", "b"], "", "z") == "a"          # else the first option
    assert pick_default(["a", "b"], "b", "a") == "b"         # an admin-chosen default wins
    assert pick_default(["a"], "gone", "z") == "a"
    assert is_installed("qwen3:4b-instruct-2507-q4_K_M", {"qwen3:4b-instruct-2507-q4_K_M"}) and is_installed("llama3", {"llama3:latest"})
    assert not is_installed("qwen3:4b-instruct-2507-q4_K_M", {"qwen3:1.7b"})
    assert [c["label"] for c in load_choice_config()] == ["Fast", "Thorough"]


def test_migration_upgrades_an_existing_database(settings):
    """A v1 database (before choices and private documents) upgrades in place, keeping data."""
    from app.db import MIGRATIONS, _open, init_db
    from app.main import bootstrap

    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = _open(settings.db_path)
    conn.executescript(f"BEGIN; {MIGRATIONS[0]}; PRAGMA user_version = 1; COMMIT;")
    conn.execute("INSERT INTO users(email, name, role, password_hash) VALUES ('a@x', 'A', 'admin', 'x')")
    conn.execute("INSERT INTO documents(title, filename, owner_id, status) VALUES ('Old', 'old.md', 1, 'ready')")
    conn.execute("INSERT INTO conversations(user_id, title) VALUES (1, 'Old chat')")
    conn.commit()
    conn.close()

    bootstrap(settings)
    init_db(settings.db_path)  # idempotent
    with connect(settings.db_path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
        assert dict(db.execute("SELECT title, visibility FROM documents").fetchone()) == {
            "title": "Old", "visibility": "school"}
        assert db.execute("SELECT attachments_json FROM conversations").fetchone()[0] == "[]"
        assert [r["model"] for r in list_choices(db)] == ["qwen3:1.7b", "qwen3:4b-instruct-2507-q4_K_M"]
        assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1  # no second admin
        with pytest.raises(Exception):
            db.execute("INSERT INTO documents(title, filename, visibility) VALUES ('x', 'x.md', 'public')")
