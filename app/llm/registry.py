"""Runtime + model registry.

`Runtime` owns the live provider. An admin can repoint it (URL/token) or change which
model serves each role from the UI; both take effect immediately, no restart.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlparse

from ..config import Settings
from ..db import connect
from .base import ModelProvider
from .fake import FakeProvider
from .ollama import OllamaProvider
from .openai_compat import OpenAICompatProvider

ROLES = ("chat", "embed")
_RUNTIME_KEYS = ("runtime_kind", "runtime_url", "runtime_token", "runtime_headers")


@dataclass(frozen=True)
class RuntimeConfig:
    kind: str
    url: str
    token: str = ""
    headers: str = ""  # JSON object

    def header_dict(self) -> dict[str, str]:
        if not self.headers.strip():
            return {}
        data = json.loads(self.headers)
        if not isinstance(data, dict):
            raise ValueError("headers must be a JSON object")
        return {str(k): str(v) for k, v in data.items()}

    def public(self) -> dict:
        """Safe-to-display view (secrets masked)."""
        d = asdict(self)
        d["token"] = _mask(self.token)
        d["headers"] = json.dumps({k: _mask(v) for k, v in self.header_dict().items()}) if self.headers else ""
        d["has_token"] = bool(self.token)
        d["is_local"] = is_local_url(self.url) or self.kind == "fake"
        return d


def _mask(s: str) -> str:
    if not s:
        return ""
    return "•" * 6 + s[-4:] if len(s) > 8 else "•" * 6


def is_local_url(url: str) -> bool:
    """True when the runtime is inside the building: loopback, private IP, mDNS, or a
    bare docker/LAN hostname. Anything else is someone else's cloud → demo data only."""
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return False
    if host == "localhost" or host.endswith(".local") or host.endswith(".lan") or "." not in host:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip.is_link_local


ProviderFactory = Callable[[RuntimeConfig, Settings], ModelProvider]


def default_factory(cfg: RuntimeConfig, settings: Settings) -> ModelProvider:
    if cfg.kind == "fake":
        return FakeProvider()
    cls = OllamaProvider if cfg.kind == "ollama" else OpenAICompatProvider
    return cls(cfg.url, token=cfg.token, headers=cfg.header_dict(), timeout_s=settings.runtime_timeout_s)


class Runtime:
    def __init__(
        self, settings: Settings, *, factory: ProviderFactory = default_factory
    ) -> None:
        self.settings = settings
        self._factory = factory
        self._provider: ModelProvider | None = None
        self._provider_cfg: RuntimeConfig | None = None
        self._lock = asyncio.Lock()
        self.generation_slots = asyncio.Semaphore(settings.max_concurrent_generations)
        self.waiting = 0  # requests queued for a generation slot
        # Last-known reachability, updated by real traffic. Status displays use this
        # instead of pinging, so a scale-to-zero GPU is never woken (or billed) by polling.
        self.last_ok: float | None = None
        self.last_error: tuple[float, str] | None = None

    def note_ok(self) -> None:
        self.last_ok = time.time()

    def note_error(self, message: str) -> None:
        self.last_error = (time.time(), message)

    def reachability(self) -> dict:
        now = time.time()
        err_at, err = self.last_error or (None, "")
        if err_at and (self.last_ok is None or err_at > self.last_ok):
            state = "unreachable"
        elif self.last_ok and now - self.last_ok < 600:
            state = "connected"
        else:
            state = "idle"  # not used recently; a cloud GPU may be scaled to zero
        return {"state": state, "last_ok": self.last_ok, "error": err if state == "unreachable" else ""}

    @property
    def db_path(self) -> Path:
        return self.settings.db_path

    # -- connection config -----------------------------------------------------------

    def config(self) -> RuntimeConfig:
        s = self.settings
        values = {
            "runtime_kind": s.runtime_kind,
            "runtime_url": s.runtime_url,
            "runtime_token": s.runtime_token,
            "runtime_headers": s.runtime_headers,
        }
        with connect(self.db_path) as db:
            for row in db.execute(
                f"SELECT key, value FROM settings WHERE key IN ({','.join('?' * len(_RUNTIME_KEYS))})",
                _RUNTIME_KEYS,
            ):
                values[row["key"]] = row["value"]
        return RuntimeConfig(
            kind=values["runtime_kind"],
            url=values["runtime_url"],
            token=values["runtime_token"],
            headers=values["runtime_headers"],
        )

    def save_config(self, cfg: RuntimeConfig) -> None:
        if cfg.kind not in ("ollama", "openai", "fake"):
            raise ValueError("kind must be ollama, openai or fake")
        if cfg.kind != "fake" and urlparse(cfg.url).scheme not in ("http", "https"):
            raise ValueError("URL must start with http:// or https://")
        cfg.header_dict()  # validates JSON
        with connect(self.db_path) as db:
            for key, value in zip(_RUNTIME_KEYS, (cfg.kind, cfg.url.rstrip("/"), cfg.token, cfg.headers)):
                db.execute(
                    "INSERT INTO settings(key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (key, value),
                )

    async def provider(self) -> ModelProvider:
        cfg = self.config()
        async with self._lock:
            if self._provider is None or cfg != self._provider_cfg:
                if self._provider is not None:
                    await self._provider.aclose()
                self._provider = self._factory(cfg, self.settings)
                self._provider_cfg = cfg
            return self._provider

    def build_provider(self, cfg: RuntimeConfig) -> ModelProvider:
        """A throwaway provider for 'Test connection' before saving."""
        return self._factory(cfg, self.settings)

    async def aclose(self) -> None:
        if self._provider is not None:
            await self._provider.aclose()
            self._provider = None

    # -- model roles -----------------------------------------------------------------

    def active_model(self, role: str) -> str:
        if role not in ROLES:
            raise ValueError(f"unknown role {role}")
        with connect(self.db_path) as db:
            row = db.execute("SELECT model FROM model_settings WHERE role = ?", (role,)).fetchone()
        if row:
            return row["model"]
        return self.settings.chat_model if role == "chat" else self.settings.embed_model

    def active_models(self) -> dict[str, str]:
        return {r: self.active_model(r) for r in ROLES}

    def set_active_model(self, role: str, model: str) -> None:
        if role not in ROLES:
            raise ValueError(f"unknown role {role}")
        if not model.strip():
            raise ValueError("model name required")
        with connect(self.db_path) as db:
            db.execute(
                "INSERT INTO model_settings(role, model) VALUES (?, ?) "
                "ON CONFLICT(role) DO UPDATE SET model = excluded.model",
                (role, model.strip()),
            )
