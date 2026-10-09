"""Vector index maintenance, keyed by embedding model.

Each embedding model gets its own "space" (a sqlite-vec table with that model's
dimension). Search only ever uses the space of the *active* embed model, so swapping
models can never mix incompatible vectors; the new space fills in the background.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from dataclasses import dataclass

from ..db import connect, vec_table
from ..llm import Runtime, RuntimeError_

log = logging.getLogger(__name__)
BATCH = 32


@dataclass(frozen=True)
class IndexStatus:
    model: str
    total_chunks: int
    embedded_chunks: int
    space_id: int | None

    @property
    def ready(self) -> bool:
        return self.total_chunks == 0 or self.embedded_chunks >= self.total_chunks

    def as_dict(self) -> dict:
        return {
            "model": self.model,
            "total_chunks": self.total_chunks,
            "embedded_chunks": self.embedded_chunks,
            "ready": self.ready,
        }


def get_space(db: sqlite3.Connection, model: str) -> sqlite3.Row | None:
    return db.execute("SELECT * FROM embedding_spaces WHERE model = ?", (model,)).fetchone()


def ensure_space(db: sqlite3.Connection, model: str, dim: int) -> int:
    row = get_space(db, model)
    if row:
        if row["dim"] != dim:
            # The model behind this name changed shape (re-pulled tag); rebuild its space.
            drop_space(db, row["id"])
        else:
            return int(row["id"])
    space_id = int(db.execute(
        "INSERT INTO embedding_spaces(model, dim) VALUES (?, ?)", (model, dim)
    ).lastrowid)
    db.execute(
        f"CREATE VIRTUAL TABLE {vec_table(space_id)} USING vec0("
        f"embedding float[{int(dim)}] distance_metric=cosine)"
    )
    return space_id


def drop_space(db: sqlite3.Connection, space_id: int) -> None:
    db.execute(f"DROP TABLE IF EXISTS {vec_table(space_id)}")
    db.execute("DELETE FROM embedding_spaces WHERE id = ?", (space_id,))


def index_status(db: sqlite3.Connection, model: str) -> IndexStatus:
    total = db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    space = get_space(db, model)
    done = 0
    if space:
        done = db.execute(
            "SELECT COUNT(*) FROM chunk_vectors WHERE space_id = ?", (space["id"],)
        ).fetchone()[0]
    return IndexStatus(model, total, done, int(space["id"]) if space else None)


async def sync_embeddings(runtime: Runtime) -> int:
    """Embed every chunk missing from the active model's space. Returns # embedded."""
    model = runtime.active_model("embed")
    provider = await runtime.provider()
    embedded = 0
    while True:
        with connect(runtime.db_path) as db:
            space = get_space(db, model)
            if space:
                rows = db.execute(
                    "SELECT c.id, c.heading, c.text FROM chunks c "
                    "LEFT JOIN chunk_vectors v ON v.chunk_id = c.id AND v.space_id = ? "
                    "WHERE v.chunk_id IS NULL ORDER BY c.id LIMIT ?",
                    (space["id"], BATCH),
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT id, heading, text FROM chunks ORDER BY id LIMIT ?", (BATCH,)
                ).fetchall()
        if not rows:
            if space := _space_for(runtime, model):
                with connect(runtime.db_path) as db:
                    db.execute("UPDATE embedding_spaces SET status = 'ready' WHERE id = ?", (space,))
            return embedded

        vectors = await provider.embed(model, [_embed_text(r) for r in rows])
        if len(vectors) != len(rows) or not vectors[0]:
            raise RuntimeError_("Embedding model returned an unexpected result")
        with connect(runtime.db_path) as db:
            space_id = ensure_space(db, model, len(vectors[0]))
            table = vec_table(space_id)
            for row, vec in zip(rows, vectors):
                # chunk may have been deleted meanwhile; FK on chunk_vectors guards that
                if not db.execute("SELECT 1 FROM chunks WHERE id = ?", (row["id"],)).fetchone():
                    continue
                db.execute(f"DELETE FROM {table} WHERE rowid = ?", (row["id"],))
                db.execute(f"INSERT INTO {table}(rowid, embedding) VALUES (?, ?)",
                           (row["id"], json.dumps(vec)))
                db.execute("INSERT OR IGNORE INTO chunk_vectors(chunk_id, space_id) VALUES (?, ?)",
                           (row["id"], space_id))
        embedded += len(rows)


def _space_for(runtime: Runtime, model: str) -> int | None:
    with connect(runtime.db_path) as db:
        row = get_space(db, model)
    return int(row["id"]) if row else None


def _embed_text(row: sqlite3.Row) -> str:
    return f"{row['heading']}\n{row['text']}" if row["heading"] else row["text"]


class EmbeddingWorker:
    """One background task that keeps the active vector space complete.

    `kick()` after any change (new document, model swap). If the runtime is down or
    cold, it backs off and retries; keyword search keeps working meanwhile.
    """

    def __init__(self, runtime: Runtime) -> None:
        self.runtime = runtime
        self._event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self.last_error: str = ""
        self.running = False

    def start(self) -> None:
        if self._task is None:
            self._loop_ref = asyncio.get_running_loop()
            self._task = asyncio.create_task(self._loop(), name="embedding-worker")
            self.kick()

    def kick(self) -> None:
        """Safe to call from the event loop or from a sync route's worker thread."""
        loop = getattr(self, "_loop_ref", None)
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if loop is not None and running is not loop:
            loop.call_soon_threadsafe(self._event.set)
        else:
            self._event.set()

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def run_once(self) -> int:
        self.running = True
        try:
            n = await sync_embeddings(self.runtime)
            self.last_error = ""
            if n:
                self.runtime.note_ok()
            return n
        except RuntimeError_ as e:
            self.last_error = str(e)
            self.runtime.note_error(str(e))
            raise
        finally:
            self.running = False

    async def _loop(self) -> None:
        backoff = 5.0
        while True:
            await self._event.wait()
            self._event.clear()
            try:
                await self.run_once()
                backoff = 5.0
            except RuntimeError_ as e:
                log.warning("embedding sync paused: %s (retry in %.0fs)", e, backoff)
                try:
                    await asyncio.wait_for(self._event.wait(), timeout=backoff)
                except asyncio.TimeoutError:
                    pass
                self._event.set()
                backoff = min(backoff * 2, 300.0)
            except Exception:  # never let the worker die
                log.exception("embedding sync failed")
                await asyncio.sleep(backoff)
                self._event.set()
