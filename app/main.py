"""Local School app server.

    uvicorn app.main:app --host 0.0.0.0 --port 8000

Light by design: no models run here. All inference goes to the configured runtime.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from .config import Settings, get_settings
from .db import connect, init_db
from .discovery import Advertiser
from .llm import Runtime
from .llm.registry import ProviderFactory, default_factory
from .routes import admin, auth, chat, install, library, roster
from .services.auth import create_user
from .services.embeddings import EmbeddingWorker
from .services.models import PullManager, seed_choices

log = logging.getLogger("localschool")
VERSION = "0.1.0"
DEMO_TEACHER = ("jordan.lee@maplegrove.demo", "demo-pass-123")  # scripts/seed_demo.py


def bootstrap(settings: Settings) -> None:
    init_db(settings.db_path, settings.sqlite_journal)
    settings.files_dir.mkdir(parents=True, exist_ok=True)
    with connect(settings.db_path) as db:
        if not db.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            create_user(db, email=settings.admin_email, name="Administrator", role="admin",
                        password=settings.admin_password)
            log.warning("Created first admin %s — change its password.", settings.admin_email)
        seed_choices(db)


def create_app(settings: Settings | None = None, *, factory: ProviderFactory = default_factory) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        bootstrap(settings)
        app.state.settings = settings
        app.state.runtime = Runtime(settings, factory=factory)
        app.state.worker = EmbeddingWorker(app.state.runtime)
        app.state.pulls = PullManager(app.state.runtime)
        app.state.worker.start()
        advertiser = None
        if settings.advertise_mdns:
            advertiser = Advertiser(settings.school_name, settings.public_port, VERSION)
            await advertiser.start()
        yield
        if advertiser:
            await advertiser.stop()
        await app.state.pulls.stop()
        await app.state.worker.stop()
        await app.state.runtime.aclose()

    app = FastAPI(title="Local School", version=VERSION, lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json")
    for r in (auth.router, chat.router, library.router, roster.router, admin.router, install.router):
        app.include_router(r)

    @app.get("/api/health")
    def health():
        # Public: the Mac app uses this to confirm it found a Local School server.
        out = {"ok": True, "app": "localschool", "version": VERSION, "school": settings.school_name}
        if settings.demo_logins:
            # Synthetic demo school only: lets the login page offer one-click demo sign-in.
            out["demo"] = {"email": DEMO_TEACHER[0], "password": DEMO_TEACHER[1]}
        if "/releases/" in settings.mac_app_url:
            # The /get page links here for the .dmg (browser download; see TEACHERS.md).
            out["mac_release_page"] = settings.mac_app_url.split("/download/")[0]
        return out

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException):
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    _mount_web(app, settings.web_dist)
    return app


def _mount_web(app: FastAPI, dist: Path) -> None:
    """Serve the built SPA (if present) with history-API fallback to index.html."""
    root = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found")
        index = root / "index.html"
        if not index.exists():
            return JSONResponse(
                {"error": "Web UI not built. Run `make web` (or use the Vite dev server on :5173)."},
                status_code=404,
            )
        candidate = (root / path).resolve()
        if path and candidate.is_file() and root in candidate.parents:
            headers = {"Cache-Control": "public, max-age=31536000, immutable"} if path.startswith("assets/") else {}
            return FileResponse(candidate, headers=headers)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


app = create_app()
