"""Process configuration.

Everything here comes from the environment (or `.env`). Settings an admin can change
from the UI at runtime (the model runtime URL, active models) live in the database and
override these defaults — see `app/llm/registry.py`.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    # Storage
    data_dir: Path = ROOT / "data"

    # Model runtime (defaults; admins can override from the Admin page)
    runtime_kind: str = Field("ollama", description="ollama | openai | fake")
    runtime_url: str = "http://127.0.0.1:11434"
    runtime_token: str = ""
    runtime_headers: str = Field("", description='Extra headers as JSON, e.g. {"X-Api-Key": "..."}')
    runtime_timeout_s: float = 120.0

    # Default models per role (used until an admin picks others)
    chat_model: str = "qwen3:8b"
    embed_model: str = "nomic-embed-text"

    # Capacity
    max_concurrent_generations: int = 2

    # Bootstrap admin (created on first start if no users exist)
    admin_email: str = "admin@school.local"
    admin_password: str = "change-me"
    admin_name: str = "Administrator"

    # Personal desk: one teacher's own server on their Mac (scripts/setup-local-mac.sh).
    # Their documents, roster, chats and recordings stay on that Mac; only the models are remote.
    local_mode: bool = False

    # Identity + discovery (the Mac app finds servers on the LAN via mDNS/Bonjour)
    school_name: str = "Local School"
    advertise_mdns: bool = False
    public_port: int = 8000
    # Where teacher Macs download the app when DATA_DIR/downloads has no zip
    mac_app_url: str = ""
    # The address teachers use, when it differs from the one this server sees (a front door)
    public_url: str = ""

    # Hosted demo: show the demo-teacher sign-in on the login page (synthetic data only)
    demo_logins: bool = False
    # SQLite journal: "wal" (default) or "delete" — use delete on network/snapshot volumes
    # (Modal), where the db file alone must always be a consistent snapshot.
    sqlite_journal: str = "wal"

    # Serving
    web_dist: Path = ROOT / "web" / "dist"
    cookie_secure: bool = False
    session_days: int = 14

    @property
    def db_path(self) -> Path:
        return self.data_dir / "localschool.db"

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"

    @property
    def audio_dir(self) -> Path:
        """Meeting recordings, kept only until the teacher approves the notes."""
        return self.data_dir / "audio"


@lru_cache
def get_settings() -> Settings:
    return Settings()
