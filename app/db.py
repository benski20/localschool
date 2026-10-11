"""SQLite storage: one file, no server. FTS5 for keyword search, sqlite-vec for vectors.

Connections are cheap; each request/job opens its own via `connect()`.
Schema changes are ordered migrations keyed on `PRAGMA user_version`.

Driver: the standard `sqlite3` module when it can load extensions. Some Python builds
(notably the python.org installers for macOS) can't, so we fall back to `sqlean`, a
drop-in SQLite build with extension loading enabled.
"""

from __future__ import annotations

import logging
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import sqlite_vec

MIGRATIONS: list[str] = [
    # 1 — initial schema
    """
    CREATE TABLE users (
        id            INTEGER PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name          TEXT NOT NULL,
        role          TEXT NOT NULL CHECK (role IN ('admin', 'teacher')),
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE sessions (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
    );

    -- Admin-editable key/value settings (runtime connection, etc.)
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    -- Which model serves each role (chat, embed, ...)
    CREATE TABLE model_settings (
        role  TEXT PRIMARY KEY,
        model TEXT NOT NULL
    );

    CREATE TABLE sections (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        period     TEXT NOT NULL DEFAULT '',
        teacher_email TEXT NOT NULL DEFAULT '' COLLATE NOCASE,  -- from the roster file
        teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (name, period)
    );

    CREATE TABLE students (
        id              INTEGER PRIMARY KEY,
        external_id     TEXT,
        name            TEXT NOT NULL,
        grade           TEXT NOT NULL DEFAULT '',
        section_id      INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        reading_level   TEXT NOT NULL DEFAULT '',
        el_level        TEXT NOT NULL DEFAULT '',
        home_language   TEXT NOT NULL DEFAULT '',
        accommodations  TEXT NOT NULL DEFAULT '',   -- semicolon-separated
        plan_type       TEXT NOT NULL DEFAULT '',   -- IEP | 504 | ''
        iep_review_date TEXT NOT NULL DEFAULT '',   -- ISO date
        case_manager    TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX students_section ON students(section_id);

    CREATE TABLE documents (
        id         INTEGER PRIMARY KEY,
        title      TEXT NOT NULL,
        filename   TEXT NOT NULL,
        mime       TEXT NOT NULL DEFAULT '',
        size       INTEGER NOT NULL DEFAULT 0,
        owner_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status     TEXT NOT NULL DEFAULT 'processing'
                   CHECK (status IN ('processing', 'ready', 'error')),
        error      TEXT NOT NULL DEFAULT '',
        pages      INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE chunks (
        id          INTEGER PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ord         INTEGER NOT NULL,
        page        INTEGER,
        heading     TEXT NOT NULL DEFAULT '',
        text        TEXT NOT NULL
    );
    CREATE INDEX chunks_document ON chunks(document_id);

    CREATE VIRTUAL TABLE chunks_fts USING fts5(
        text, heading, content='chunks', content_rowid='id', tokenize='porter unicode61'
    );
    CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, text, heading) VALUES (new.id, new.text, new.heading);
    END;
    CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, text, heading)
        VALUES ('delete', old.id, old.text, old.heading);
    END;

    -- One vector table per embedding model, so swapping models never mixes vector spaces.
    CREATE TABLE embedding_spaces (
        id         INTEGER PRIMARY KEY,
        model      TEXT NOT NULL UNIQUE,
        dim        INTEGER NOT NULL,
        status     TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'ready')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Which chunks have a vector in which space (vec0 tables can't be joined cheaply for this)
    CREATE TABLE chunk_vectors (
        chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
        space_id INTEGER NOT NULL REFERENCES embedding_spaces(id) ON DELETE CASCADE,
        PRIMARY KEY (chunk_id, space_id)
    );

    CREATE TABLE conversations (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL DEFAULT 'New chat',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE messages (
        id              INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content         TEXT NOT NULL,
        sources_json    TEXT NOT NULL DEFAULT '[]',
        model           TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX messages_conversation ON messages(conversation_id);
    """,
    # 2 — teacher-selectable chat models; private documents (chat attachments)
    """
    -- Chat models teachers may pick from ("Fast", "Thorough", ...). The teacher-facing
    -- default lives in settings under 'chat_default'.
    CREATE TABLE chat_choices (
        model       TEXT PRIMARY KEY,
        label       TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        position    INTEGER NOT NULL DEFAULT 0
    );

    -- 'private' documents are visible (and citable) only to their owner.
    ALTER TABLE documents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'school'
        CHECK (visibility IN ('school', 'private'));
    CREATE INDEX documents_owner ON documents(owner_id);

    -- Private documents attached to a conversation (JSON list of ids); follow-ups reuse them.
    ALTER TABLE conversations ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]';
    """,
    # 3 — teacher tools (meeting notes, feedback, adapt a reading, parent email): every
    # output is a private draft of its teacher. The table is also the job queue.
    """
    CREATE TABLE drafts (
        id              INTEGER PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tool            TEXT NOT NULL CHECK (tool IN ('meeting', 'feedback', 'adapt', 'email')),
        title           TEXT NOT NULL DEFAULT '',
        input_json      TEXT NOT NULL DEFAULT '{}',
        output_json     TEXT,               -- NULL until generated; teacher edits replace it
        status          TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('awaiting_audio', 'queued', 'running', 'ready', 'error')),
        stage           TEXT NOT NULL DEFAULT '',   -- what a running job is doing right now
        error           TEXT NOT NULL DEFAULT '',
        progress        REAL NOT NULL DEFAULT 0,    -- 0..1
        student_id      INTEGER REFERENCES students(id) ON DELETE SET NULL,
        batch_id        TEXT,                       -- feedback: pieces submitted together
        model           TEXT NOT NULL DEFAULT '',
        -- meetings
        audio_path      TEXT,                       -- file name under DATA_DIR/audio; deleted on approve
        audio_bytes     INTEGER NOT NULL DEFAULT 0,
        transcript_json TEXT,                       -- [{start, end, text}]
        approved_at     TEXT,
        edited_at       TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX drafts_owner ON drafts(user_id, tool, updated_at);
    CREATE INDEX drafts_queue ON drafts(status, id);
    CREATE INDEX drafts_batch ON drafts(batch_id);
    """,
]


def _driver():
    if os.environ.get("LS_SQLITE_DRIVER") != "sqlean" and hasattr(sqlite3.Connection, "enable_load_extension"):
        return sqlite3
    try:
        import sqlean
    except ImportError as e:  # pragma: no cover - depends on the Python build
        raise RuntimeError(
            "This Python's sqlite3 can't load extensions (needed for vector search). "
            "Install the fallback with: pip install sqlean.py"
        ) from e
    return sqlean


DRIVER = _driver()
log = logging.getLogger(__name__)


def vec_table(space_id: int) -> str:
    return f"vec_space_{int(space_id)}"


def _open(path: Path | str) -> sqlite3.Connection:
    conn = DRIVER.connect(str(path), check_same_thread=False, timeout=30)
    conn.row_factory = DRIVER.Row
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def init_db(path: Path, journal: str = "wal") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = _open(path)
    try:
        mode = "DELETE" if journal.lower() == "delete" else "WAL"
        conn.execute(f"PRAGMA journal_mode = {mode}")
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        for i, script in enumerate(MIGRATIONS[version:], start=version + 1):
            conn.executescript(f"BEGIN; {script}; PRAGMA user_version = {i}; COMMIT;")
        repair_search_index(conn)
    finally:
        conn.close()


def repair_search_index(conn) -> bool:
    """Rebuild the keyword index if it no longer matches the passages (e.g. after a storage
    layer restored an older copy of the database file). Returns True if it was rebuilt."""
    try:
        conn.execute("INSERT INTO chunks_fts(chunks_fts, rank) VALUES ('integrity-check', 1)")  # 1: compare with the passages
        return False
    except DRIVER.DatabaseError:
        conn.execute("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')")
        conn.commit()
        log.warning("Keyword index was out of sync with the library; rebuilt it.")
        return True


@contextmanager
def connect(path: Path | str) -> Iterator[sqlite3.Connection]:
    """Open a connection; commit on success, roll back on error."""
    conn = _open(path)
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()
