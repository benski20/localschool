"""Teacher Mac install, served by the school server itself.

    curl -fsSL http://<server>:8000/install/mac.sh | bash

The script is scripts/install-mac-app.sh with this server's address filled in, so the app
installs without a Gatekeeper prompt and opens already connected. The app zip is whatever
the admin placed at DATA_DIR/downloads/LocalSchool-macOS.zip (the install-server script
does this for you), else MAC_APP_URL (e.g. the latest GitHub release).
"""

from __future__ import annotations

import plistlib
import re
import sqlite3
import zipfile
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


_version_cache: dict[str, tuple[float, str]] = {}


def mac_zip_version(settings: Settings) -> str:
    """The version of the Mac app this server hands out (from Info.plist inside the zip),
    so installed apps can update themselves. "" if there's no zip."""
    path = zip_path(settings)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return ""
    cached = _version_cache.get(str(path))
    if cached and cached[0] == mtime:
        return cached[1]
    version = ""
    try:
        with zipfile.ZipFile(path) as z:
            name = next((n for n in z.namelist() if n.endswith(".app/Contents/Info.plist")), None)
            if name:
                version = str(plistlib.loads(z.read(name)).get("CFBundleShortVersionString", ""))
    except (zipfile.BadZipFile, plistlib.InvalidFileException, OSError, ValueError):
        version = ""
    _version_cache[str(path)] = (mtime, version)
    return version


def _shell_safe(value: str) -> str:
    # Values land inside "${VAR:-…}" — strip anything that could break out of it.
    return re.sub(r'[\\"`$\n\r]', "", value)


def _base(request: Request, settings: Settings | None = None) -> str:
    if settings is not None and settings.public_url:
        return settings.public_url.rstrip("/")  # the address teachers use (e.g. a Vercel front door)
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
        return f"{_base(request, settings)}/install/{ZIP_NAME}"
    return settings.mac_app_url or None


@router.get("/install/mac.sh", response_class=PlainTextResponse)
def install_script(request: Request, settings: Settings = Depends(deps.settings)):
    zip_url = _zip_url(request, settings)
    if not zip_url:
        raise HTTPException(404, "The Mac app hasn't been uploaded to this server yet. Ask your administrator.")
    text = (
        SCRIPT.read_text()
        .replace("__SERVER__", _shell_safe(_base(request, settings)))
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
        "command": f"curl -fsSL {_base(request, settings)}/install/mac.sh | bash",
        "zip_location": str(path),
    }
