from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import connect, init_db
from app.llm import Runtime
from app.llm.fake import FakeProvider
from app.main import bootstrap, create_app
from app.services import ingest, roster
from app.services.auth import create_user

DEMO = Path(__file__).resolve().parent.parent / "demo"
PASSWORD = "demo-pass-123"


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        data_dir=tmp_path / "data",
        runtime_kind="fake",
        runtime_url="http://127.0.0.1:11434",
        chat_model="fake-chat",
        embed_model="fake-embed",
        admin_email="admin@test.local",
        admin_password="admin-pass-123",
        web_dist=tmp_path / "no-web",
        max_concurrent_generations=2,
        email_codes=True,
    )


@pytest.fixture
def fake() -> FakeProvider:
    return FakeProvider(models=["fake-chat", "fake-embed"])


@pytest.fixture
def runtime(settings, fake) -> Runtime:
    bootstrap(settings)
    return Runtime(settings, factory=lambda cfg, s: fake)


def seed(settings: Settings) -> None:
    init_db(settings.db_path)
    with connect(settings.db_path) as db:
        for email, name in (("jordan.lee@shipley.demo", "Jordan Lee"), ("sam.patel@shipley.demo", "Sam Patel")):
            if not db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                create_user(db, email=email, name=name, role="teacher", password=PASSWORD)
        for title, fn in (("Handbook", "student-handbook.md"), ("ELA 7 Pacing Guide", "ela7-pacing-guide.md")):
            ingest.store_document(db, title=title, filename=fn, mime="text/markdown",
                                  data=(DEMO / fn).read_bytes(), owner_id=None, files_dir=settings.files_dir)
        roster.import_roster(db, roster.parse_roster_csv((DEMO / "roster.csv").read_text()))


@pytest.fixture
def seeded(settings, runtime) -> Runtime:
    seed(settings)
    return runtime


def user(settings: Settings, email: str):
    with connect(settings.db_path) as db:
        return db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


@pytest.fixture
def client(settings, fake):
    app = create_app(settings, factory=lambda cfg, s: fake)
    with TestClient(app) as c:
        seed(settings)
        c.app.state.worker.kick()
        yield c


def login(c: TestClient, email: str, password: str = PASSWORD) -> None:
    r = c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text


def sse(resp) -> list[dict]:
    return [json.loads(line[5:]) for line in resp.text.splitlines() if line.startswith("data:")]


def wait_index(c: TestClient, timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        idx = c.get("/api/status").json()["index"]
        if idx["ready"] and idx["total_chunks"]:
            return idx
        time.sleep(0.05)
    raise AssertionError(f"index not ready: {idx}")
