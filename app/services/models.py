"""Model management on the runtime: presets, background pulls, role assignment."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import yaml

from ..config import ROOT
from ..llm import Runtime, RuntimeError_

log = logging.getLogger(__name__)
PRESETS_FILE = ROOT / "config" / "models.yaml"


def load_presets(path: Path = PRESETS_FILE) -> dict:
    try:
        return yaml.safe_load(path.read_text()).get("presets", {})
    except (OSError, AttributeError, yaml.YAMLError):
        return {}


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

    async def wait(self, model: str) -> PullState:
        if task := self._tasks.get(model):
            await task
        return self._states[model]

    async def stop(self) -> None:
        for t in self._tasks.values():
            t.cancel()
