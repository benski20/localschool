"""Load the demo for The Shipley School: fictional students and documents (synthetic data only — no real students).

    python -m scripts.seed_demo            # add demo teachers, docs and roster
    python -m scripts.seed_demo --reset    # wipe documents/roster/chats first

Teacher logins (password `demo-pass-123`):
    jordan.lee@shipley.demo  — ELA 7, periods 1 and 3
    sam.patel@shipley.demo   — Math 7, periods 2 and 4
Embeddings are created by the app's background worker once a runtime is connected.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import get_settings  # noqa: E402
from app.db import connect  # noqa: E402
from app.main import bootstrap  # noqa: E402
from app.services import ingest, roster  # noqa: E402
from app.services.auth import create_user  # noqa: E402

DEMO = ROOT / "demo"
PASSWORD = "demo-pass-123"
TEACHERS = [
    ("jordan.lee@shipley.demo", "Jordan Lee"),
    ("sam.patel@shipley.demo", "Sam Patel"),
]
DOCS = [
    ("Student & Family Handbook 2026–27", "student-handbook.md"),
    ("Grade 7 ELA Fall Pacing Guide", "ela7-pacing-guide.md"),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="remove existing documents, roster and chats")
    args = ap.parse_args()

    settings = get_settings()
    bootstrap(settings)
    with connect(settings.db_path) as db:
        if args.reset:
            for (doc_id,) in db.execute("SELECT id FROM documents").fetchall():
                ingest.delete_document(db, doc_id, settings.files_dir)
            db.execute("DELETE FROM conversations")
            db.execute("DELETE FROM students")
            db.execute("DELETE FROM sections")

        for email, name in TEACHERS:
            if not db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                create_user(db, email=email, name=name, role="teacher", password=PASSWORD)

        existing = {r["filename"] for r in db.execute("SELECT filename FROM documents")}
        for title, filename in DOCS:
            if filename in existing:
                continue
            ingest.store_document(db, title=title, filename=filename, mime="text/markdown",
                                  data=(DEMO / filename).read_bytes(), owner_id=None,
                                  files_dir=settings.files_dir)

        parsed = roster.parse_roster_csv((DEMO / "roster.csv").read_text())
        result = roster.import_roster(db, parsed)

    print(f"Demo school ready: {result['students']} students in {result['sections']} sections, "
          f"{len(DOCS)} documents.")
    print(f"Sign in as {TEACHERS[0][0]} / {PASSWORD}  (admin: {settings.admin_email})")


if __name__ == "__main__":
    main()
