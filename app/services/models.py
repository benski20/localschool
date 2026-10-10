"""Model management on the runtime: presets, background pulls, role assignment, and the
chat models teachers may pick from."""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import yaml

from ..config import ROOT
from ..db import connect
from ..llm import Runtime, RuntimeError_

log = logging.getLogger(__name__)
PRESETS_FILE = ROOT / "config" / "models.yaml"


def load_presets(path: Path = PRESETS_FILE) -> dict:
    try:
        return yaml.safe_load(path.read_text()).get("presets", {})
    except (OSError, AttributeError, yaml.YAMLError):
        return {}


# -- chat models teachers can pick ("Fast", "Thorough") -------------------------------

DEFAULT_KEY = "chat_default"  # settings key: the option the teacher picker preselects
FALLBACK_LABEL = "Standard"


def load_choice_config(path: Path = PRESETS_FILE) -> list[dict]:
    try:
        items = yaml.safe_load(path.read_text()).get("choices", []) or []
    except (OSError, AttributeError, yaml.YAMLError):
        return []
    return [
        {"model": str(c["model"]), "label": str(c.get("label") or c["model"]),
         "description": str(c.get("description") or "")}
        for c in items if isinstance(c, dict) and c.get("model")
    ]


def seed_choices(db: sqlite3.Connection, path: Path = PRESETS_FILE) -> None:
    """First run (or an emptied table): load the choices from config/models.yaml."""
    if db.execute("SELECT 1 FROM chat_choices LIMIT 1").fetchone():
        return
    _write_choices(db, load_choice_config(path))


def _write_choices(db: sqlite3.Connection, options: list[dict]) -> None:
    db.execute("DELETE FROM chat_choices")
    db.executemany(
        "INSERT INTO chat_choices(model, label, description, position) VALUES (?, ?, ?, ?)",
        [(o["model"], o["label"], o.get("description", ""), i) for i, o in enumerate(options)],
    )


def list_choices(db: sqlite3.Connection) -> list[dict]:
    return [dict(r) for r in db.execute(
        "SELECT model, label, description FROM chat_choices ORDER BY position, model"
    )]


def stored_default(db: sqlite3.Connection) -> str:
    row = db.execute("SELECT value FROM settings WHERE key = ?", (DEFAULT_KEY,)).fetchone()
    return row["value"] if row else ""


def set_choices(db: sqlite3.Connection, options: list[dict], default: str | None) -> None:
    """Replace the list (order = position) and the default. Raises ValueError."""
    clean, seen = [], set()
    for o in options:
        model, label = o["model"].strip(), o["label"].strip()
        if not model or not label:
            raise ValueError("Each option needs a model and a name.")
        if model in seen:
            raise ValueError(f"'{model}' is listed twice.")
        seen.add(model)
        clean.append({"model": model, "label": label, "description": (o.get("description") or "").strip()})
    if not clean:
        raise ValueError("Keep at least one model for teachers.")
    default = (default or "").strip() or clean[0]["model"]
    if default not in seen:
        raise ValueError("The default must be one of the options.")
    _write_choices(db, clean)
    db.execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (DEFAULT_KEY, default),
    )


def is_installed(model: str, names: set[str]) -> bool:
    return model in names or f"{model}:latest" in names or (
        model.endswith(":latest") and model.removesuffix(":latest") in names)


def pick_default(models: list[str], stored: str, active: str) -> str:
    """Stored default, else the active chat model, else the first option."""
    for m in (stored, active):
        if m and m in models:
            return m
    return models[0] if models else active


async def _installed(runtime: Runtime) -> set[str] | None:
    try:
        return await runtime.installed_models()
    except RuntimeError_ as e:
        runtime.note_error(str(e))
        return None


async def admin_choices(runtime: Runtime) -> dict:
    """Every configured option with its installed flag (admin view)."""
    with connect(runtime.db_path) as db:
        options, stored = list_choices(db), stored_default(db)
    names = await _installed(runtime)
    active = runtime.active_model("chat")
    out = [{**o, "installed": names is not None and is_installed(o["model"], names)} for o in options]
    return {
        "default": pick_default([o["model"] for o in out], stored, active),
        "options": out,
        "active": active,
        "error": "" if names is not None else "Couldn't reach the AI runtime to check installed models.",
    }


async def teacher_choices(runtime: Runtime) -> dict:
    """The installed options a teacher may pick. Never empty: if no configured choice is
    installed (or the runtime can't be listed), the active chat model is the one option."""
    with connect(runtime.db_path) as db:
        options, stored = list_choices(db), stored_default(db)
    names = await _installed(runtime)
    active = runtime.active_model("chat")
    out = [{**o, "installed": True} for o in options if names is not None and is_installed(o["model"], names)]
    if not out:
        out = [{"model": active, "label": FALLBACK_LABEL, "description": "",
                "installed": names is None or is_installed(active, names)}]
    return {"default": pick_default([o["model"] for o in out], stored, active), "options": out}


async def resolve_chat_model(runtime: Runtime, requested: str | None) -> str:
    """The model to answer with: `requested` if a teacher may use it right now, else the
    active chat model (silently: an old or tampered client still gets an answer)."""
    active = runtime.active_model("chat")
    requested = (requested or "").strip()
    if not requested or requested == active:
        return active
    allowed = {o["model"] for o in (await teacher_choices(runtime))["options"]}
    return requested if requested in allowed else active


@dataclass
class PullState:
    model: str
    status: str = "starting"
    completed: int | None = None
    total: int | None = None
    done: bool = False
    error: str = ""
    started_at: float = field(default_factory=time.time)

    @property
    def percent(self) -> float | None:
        if self.total:
            return round(100 * (self.completed or 0) / self.total, 1)
        return 100.0 if self.done and not self.error else None

    def as_dict(self) -> dict:
        return {**asdict(self), "percent": self.percent}


class PullManager:
    """Pulls run as background tasks so they survive the admin closing the tab.
    The UI polls `states()`; a model is pulled at most once concurrently."""

    def __init__(self, runtime: Runtime) -> None:
        self.runtime = runtime
        self._states: dict[str, PullState] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    def states(self) -> list[dict]:
        # finished pulls linger for 10 minutes so the UI can show the outcome
        cutoff = time.time() - 600
        for k in [k for k, s in self._states.items() if s.done and s.started_at < cutoff]:
            self._states.pop(k, None)
        return [s.as_dict() for s in self._states.values()]

    def start(self, model: str) -> PullState:
        model = model.strip()
        if not model:
            raise ValueError("Model name required")
        task = self._tasks.get(model)
        if task and not task.done():
            return self._states[model]
        state = PullState(model)
        self._states[model] = state
        self._tasks[model] = asyncio.create_task(self._run(state), name=f"pull:{model}")
        return state

    async def _run(self, state: PullState) -> None:
        try:
            provider = await self.runtime.provider()
            if not provider.capabilities.pull:
                raise RuntimeError_("This runtime can't download models; install them on the server.")
            async for p in provider.pull(state.model):
                state.status = p.status
                if p.total:
                    state.total, state.completed = p.total, p.completed or 0
            state.status = "ready"
        except RuntimeError_ as e:
            state.error = str(e)
            state.status = "failed"
        except Exception as e:  # pragma: no cover - defensive
            log.exception("pull failed")
            state.error = f"Unexpected error: {e}"
            state.status = "failed"
        finally:
            state.done = True
            self.runtime.forget_installed()

    async def wait(self, model: str) -> PullState:
        if task := self._tasks.get(model):
            await task
        return self._states[model]

    async def stop(self) -> None:
        for t in self._tasks.values():
            t.cancel()
