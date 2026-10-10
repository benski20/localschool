"""The tools' background worker. The drafts table is the queue: a draft is `queued`
until the worker claims it (`running`), then `ready` or `error`. Jobs survive restarts:
anything left `running` is queued again on start.

Capacity: every model call takes a slot from `runtime.generation_slots`, the same
semaphore grounded chat uses, so a batch of feedback never oversubscribes the GPU and
teachers' chat questions interleave with it. Speech-to-text runs one recording at a time
on its own lane (it doesn't use the chat model), and the queue is fair across teachers:
the next job goes to whoever has the fewest jobs running."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from ...config import Settings
from ...db import connect
from ...llm import Runtime, RuntimeError_, TranscriptSegment
from . import audio, drafts
from .common import JobContext, ToolError

log = logging.getLogger(__name__)
UNEXPECTED = "Something went wrong while writing this draft. Try again."

_CLAIM = (
    "UPDATE drafts SET status = 'running', stage = 'starting', progress = 0, error = '', "
    "updated_at = datetime('now') "
    "WHERE id = (SELECT d.id FROM drafts d WHERE d.status = 'queued' ORDER BY "
    "(SELECT COUNT(*) FROM drafts r WHERE r.user_id = d.user_id AND r.status = 'running'), d.id LIMIT 1) "
    "RETURNING id"
)


class ToolWorker:
    def __init__(self, runtime: Runtime, settings: Settings, concurrency: int | None = None) -> None:
        self.runtime = runtime
        self.settings = settings
        # One more job than generation slots, so a long transcription doesn't stall the rest.
        self.concurrency = concurrency or max(1, settings.max_concurrent_generations) + 1
        self.transcribe_slots = asyncio.Semaphore(1)
        self._event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._jobs: dict[int, asyncio.Task] = {}
        self._loop_ref: asyncio.AbstractEventLoop | None = None

    @property
    def db_path(self) -> Path:
        return self.settings.db_path

    # -- lifecycle ----------------------------------------------------------------------

    def start(self) -> None:
        if self._task is None:
            self._loop_ref = asyncio.get_running_loop()
            self.recover()
            self._task = asyncio.create_task(self._loop(), name="tools-worker")
            self.kick()

    def recover(self) -> None:
        with connect(self.db_path) as db:
            n = db.execute("UPDATE drafts SET status = 'queued', stage = '' WHERE status = 'running'").rowcount
            audio.sweep(db, self.settings.audio_dir)
        if n:
            log.info("re-queued %d interrupted tool job(s)", n)

    async def stop(self) -> None:
        tasks = [t for t in (self._task, *self._jobs.values()) if t]
        for t in tasks:
            t.cancel()
        for t in tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        self._task = None
        self._jobs.clear()

    def _threadsafe(self, fn, *args) -> None:
        loop = self._loop_ref
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if loop is not None and running is not loop:
            loop.call_soon_threadsafe(fn, *args)
        else:
            fn(*args)

    def kick(self) -> None:
        """Look for queued drafts now. Safe from the event loop or a worker thread."""
        self._threadsafe(self._event.set)

    def cancel(self, draft_id: int) -> None:
        """Stop a draft's job (it's being deleted)."""
        def _cancel() -> None:
            if task := self._jobs.get(draft_id):
                task.cancel()
        self._threadsafe(_cancel)

    @property
    def busy(self) -> int:
        return len(self._jobs)

    # -- loop ---------------------------------------------------------------------------

    async def _loop(self) -> None:
        while True:
            await self._event.wait()
            self._event.clear()
            try:
                self._fill()
            except Exception:  # never let the worker die
                log.exception("tools worker failed to claim jobs")
                await asyncio.sleep(2)
                self._event.set()

    def _fill(self) -> None:
        while len(self._jobs) < self.concurrency:
            with connect(self.db_path) as db:
                rows = db.execute(_CLAIM).fetchall()  # fetch all: RETURNING must finish before commit
            if not rows:
                return
            draft_id = int(rows[0][0])
            task = asyncio.create_task(self._run(draft_id), name=f"tool-draft:{draft_id}")
            self._jobs[draft_id] = task
            task.add_done_callback(lambda _t, i=draft_id: self._done(i))

    def _done(self, draft_id: int) -> None:
        self._jobs.pop(draft_id, None)
        self._event.set()

    # -- one job ------------------------------------------------------------------------

    def _report(self, draft_id: int, stage: str, progress: float | None) -> None:
        with connect(self.db_path) as db:
            if progress is None:
                db.execute("UPDATE drafts SET stage = ? WHERE id = ? AND status = 'running'", (stage, draft_id))
            else:
                db.execute("UPDATE drafts SET stage = ?, progress = ? WHERE id = ? AND status = 'running'",
                           (stage, round(min(max(progress, 0.0), 1.0), 3), draft_id))

    def _save_transcript(self, draft_id: int, transcript: list[dict]) -> None:
        with connect(self.db_path) as db:
            db.execute("UPDATE drafts SET transcript_json = ?, updated_at = datetime('now') WHERE id = ?",
                       (json.dumps(transcript), draft_id))

    async def _transcribe(self, path: Path, *, language: str | None = None, prompt: str = "") -> list[TranscriptSegment]:
        async with self.transcribe_slots:
            provider = await self.runtime.provider()
            try:
                segments = await provider.transcribe(path, language=language, prompt=prompt)
            except RuntimeError_ as e:
                self.runtime.note_error(str(e))
                raise
        self.runtime.note_ok()
        return segments

    def _finish(self, draft_id: int, *, output: dict | None = None, error: str = "") -> None:
        with connect(self.db_path) as db:
            if error:
                db.execute("UPDATE drafts SET status = 'error', error = ?, stage = '', updated_at = datetime('now') "
                           "WHERE id = ? AND status = 'running'", (error, draft_id))
            else:
                db.execute("UPDATE drafts SET status = 'ready', output_json = ?, error = '', stage = '', "
                           "progress = 1, edited_at = NULL, updated_at = datetime('now') "
                           "WHERE id = ? AND status = 'running'", (json.dumps(output), draft_id))

    async def _run(self, draft_id: int) -> None:
        with connect(self.db_path) as db:
            row = db.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row is None:
            return
        module = drafts.MODULES[row["tool"]]
        ctx = JobContext(
            runtime=self.runtime, draft_id=draft_id,
            model=row["model"] or self.runtime.active_model("chat"),
            report=lambda stage, p: self._report(draft_id, stage, p),
            transcribe=self._transcribe,
            save_transcript=lambda t: self._save_transcript(draft_id, t),
        )
        try:
            output = await module.run(ctx, drafts.job(row, self.settings.audio_dir))
        except asyncio.CancelledError:
            raise  # deleted, or the server is stopping (re-queued on next start)
        except (ToolError, RuntimeError_) as e:
            log.info("tool draft %s failed: %s", draft_id, e)
            self._finish(draft_id, error=str(e))
        except Exception:
            log.exception("tool draft %s crashed", draft_id)
            self._finish(draft_id, error=UNEXPECTED)
        else:
            self._finish(draft_id, output=output)
