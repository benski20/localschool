"""Local School app server.

    uvicorn app.main:app --host 0.0.0.0 --port 8000

Light by design: no models run here. All inference goes to the configured runtime.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from .config import Settings, get_settings
from .db import connect, init_db
from .discovery import Advertiser
from .llm import Runtime
from .llm.registry import ProviderFactory, default_factory, is_local_url
from .routes import admin, auth, chat, export, install, library, relay, roster, sso, tools
from .routes.install import mac_zip_version
from .services import activity
from .services import sso as sso_service
from .services.auth import create_user
from .services.embeddings import EmbeddingWorker
from .services.models import PullManager, seed_choices
from .services.tools import ToolWorker

log = logging.getLogger("localschool")
VERSION = "0.5.4"
DEMO_TEACHER = ("jordan.lee@shipley.demo", "demo-pass-123")  # scripts/seed_demo.py


def bootstrap(settings: Settings) -> None:
    init_db(settings.db_path, settings.sqlite_journal)
    settings.files_dir.mkdir(parents=True, exist_ok=True)
    settings.audio_dir.mkdir(parents=True, exist_ok=True)
    with connect(settings.db_path) as db:
        if not db.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            create_user(db, email=settings.admin_email, name=settings.admin_name, role="admin",
                        password=settings.admin_password)
            log.warning("Created first admin %s — change its password.", settings.admin_email)
        seed_choices(db)
        activity.purge(db, settings.activity_days)


async def _purge_daily(settings: Settings) -> None:
    """Old activity entries go after `activity_days`; checked once a day."""
    while True:
        await asyncio.sleep(86400)
        try:
            with connect(settings.db_path) as db:
                activity.purge(db, settings.activity_days)
        except Exception:  # noqa: BLE001 - never take the server down for housekeeping
            log.exception("activity purge failed")


def create_app(settings: Settings | None = None, *, factory: ProviderFactory = default_factory) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        bootstrap(settings)
        app.state.settings = settings
        app.state.runtime = Runtime(settings, factory=factory)
        app.state.worker = EmbeddingWorker(app.state.runtime)
        app.state.pulls = PullManager(app.state.runtime)
        app.state.tools = ToolWorker(app.state.runtime, settings)
        app.state.worker.start()
        app.state.tools.start()
        purger = asyncio.create_task(_purge_daily(settings))
        advertiser = None
        if settings.advertise_mdns:
            advertiser = Advertiser(settings.school_name, settings.public_port, VERSION)
            await advertiser.start()
        yield
        if advertiser:
            await advertiser.stop()
        purger.cancel()
        await app.state.pulls.stop()
        await app.state.tools.stop()
        await app.state.worker.stop()
        await app.state.runtime.aclose()

    app = FastAPI(title="Local School", version=VERSION, lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json")
    for r in (auth.router, chat.router, library.router, roster.router, admin.router, install.router,
              tools.router, relay.router, export.router, sso.router):
        app.include_router(r)

    @app.get("/api/health")
    def health():
        # Public: the Mac app uses this to confirm it found a Local School server.
        out = {"ok": True, "app": "localschool", "version": VERSION, "school": settings.school_name}
        with connect(settings.db_path) as db:
            enabled = sso_service.load(db, settings).enabled()
        if enabled and not settings.local_mode:
            out["sso"] = enabled  # the sign-in page shows "Continue with Google / Microsoft"
        if settings.local_mode:
            out["local"] = True  # the Mac app and sidebar say "Kept on this Mac"
        if settings.demo_logins:
            # Synthetic demo school only: lets the login page offer one-click demo sign-in.
            out["demo"] = {"email": DEMO_TEACHER[0], "password": DEMO_TEACHER[1]}
        mac = mac_zip_version(settings)
        if mac:
            out["mac_app_version"] = mac  # installed Mac apps update themselves to this
        if "/releases/" in settings.mac_app_url:
            # The /get page links here for the .dmg (browser download; see TEACHERS.md).
            out["mac_release_page"] = settings.mac_app_url.split("/download/")[0]
        return out

    @app.get("/api/trust")
    def trust():
        # Public: the facts behind the /privacy page, true for this install.
        cfg = app.state.runtime.config()
        if cfg.kind == "relay":
            ai = "school"      # a personal desk: the school's server runs the AI
        elif cfg.kind == "fake" or is_local_url(cfg.url):
            ai = "on_site"
        else:
            ai = "cloud"
        return {
            "school": settings.school_name,
            "deployment": "personal" if settings.local_mode else "demo" if settings.demo_logins else "school",
            "ai": ai,
            "activity_days": settings.activity_days,
            "session_days": settings.session_days,
            "version": VERSION,
        }

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
        # The page itself is never cached and carries no ETag/Last-Modified: every build of
        # index.html is the same size, and file times can repeat across deploys, so a
        # validator could answer "304 unchanged" with an old build (the Mac app's web view
        # kept showing one). It's 1 KB; the hashed assets it points to are cached for good.
        return HTMLResponse(index.read_text(encoding="utf-8"),
                            headers={"Cache-Control": "no-store, max-age=0", "Pragma": "no-cache"})


app = create_app()
