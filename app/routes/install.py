"""Teacher Mac install, served by the school server itself.

    curl -fsSL http://<server>:8000/install/mac.sh | bash

The script is scripts/install-mac-app.sh with this server's address filled in, so the app
installs without a Gatekeeper prompt and opens already connected. The app zip is whatever
the admin placed at DATA_DIR/downloads/LocalSchool-macOS.zip (the install-server script
does this for you), else MAC_APP_URL (e.g. the latest GitHub release).
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse, RedirectResponse

from .. import deps
from ..config import ROOT, Settings

router = APIRouter(tags=["install"])
SCRIPT = ROOT / "scripts" / "install-mac-app.sh"
ZIP_NAME = "LocalSchool-macOS.zip"


def zip_path(settings: Settings) -> Path:
    return settings.data_dir / "downloads" / ZIP_NAME


def _shell_safe(value: str) -> str:
    # Values land inside "${VAR:-…}" — strip anything that could break out of it.
    return re.sub(r'[\\"`$\n\r]', "", value)


def _base(request: Request) -> str:
    base = str(request.base_url).rstrip("/")
    # Behind a TLS-terminating proxy (Modal, a reverse proxy) keep the public scheme.
    if request.headers.get("x-forwarded-proto") == "https" and base.startswith("http://"):
        base = "https://" + base[len("http://"):]
    # Behind a front door (e.g. Vercel → Modal) teachers should see the public address.
    host = request.headers.get("x-forwarded-host", "").split(",")[0].strip()
    if host and re.fullmatch(r"[A-Za-z0-9.-]+(:\d+)?", host):
        base = f"{base.split('://', 1)[0]}://{host}"
    return base


def _zip_url(request: Request, settings: Settings) -> str | None:
    if zip_path(settings).exists():
        return f"{_base(request)}/install/{ZIP_NAME}"
    return settings.mac_app_url or None


@router.get("/install/mac.sh", response_class=PlainTextResponse)
def install_script(request: Request, settings: Settings = Depends(deps.settings)):
    zip_url = _zip_url(request, settings)
    if not zip_url:
        raise HTTPException(404, "The Mac app hasn't been uploaded to this server yet. Ask your administrator.")
    text = (
        SCRIPT.read_text()
        .replace("__SERVER__", _shell_safe(_base(request)))
        .replace("__ZIP_URL__", _shell_safe(zip_url))
        .replace("__SCHOOL__", _shell_safe(settings.school_name))
    )
    return PlainTextResponse(text, media_type="text/x-shellscript")


@router.get(f"/install/{ZIP_NAME}")
def install_zip(settings: Settings = Depends(deps.settings)):
    path = zip_path(settings)
    if not path.exists():
        if settings.mac_app_url:
            return RedirectResponse(settings.mac_app_url, status_code=302)
        raise HTTPException(404, "The Mac app hasn't been uploaded to this server yet.")
    return FileResponse(path, filename=ZIP_NAME, media_type="application/zip")


@router.get("/api/admin/install")
def install_info(
    request: Request,
    _: sqlite3.Row = Depends(deps.admin_user),
    settings: Settings = Depends(deps.settings),
):
    path = zip_path(settings)
    return {
        "mac_app_present": _zip_url(request, settings) is not None,
        "mac_app_size": path.stat().st_size if path.exists() else 0,
        "command": f"curl -fsSL {_base(request)}/install/mac.sh | bash",
        "zip_location": str(path),
    }
