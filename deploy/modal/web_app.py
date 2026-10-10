"""Hosted Local School (pilot): the server + web app on Modal, so testers just open a link.

Deployed by the "Deploy Modal runtime" GitHub Action, after the model runtime. By hand:

    cd web && npm ci && npm run build && cd ..
    modal secret create localschool-app ADMIN_EMAIL=… ADMIN_PASSWORD=… \\
        RUNTIME_URL=https://…-localschool-ollama-serve.modal.run RUNTIME_TOKEN=… \\
        CHAT_MODEL=qwen3:1.7b EMBED_MODEL=nomic-embed-text SCHOOL_NAME="Maple Grove" \\
        LS_SEED_DEMO=1 DEMO_LOGINS=true
    modal deploy deploy/modal/web_app.py        # → https://<workspace>--localschool-app-web.modal.run

One small CPU container serves everyone and sleeps when idle; data (SQLite + uploads)
lives on a Modal Volume. Cloud hosting = synthetic/demo data only; real student data
belongs on the on-site school box (deploy/box), which runs this same app.
"""

from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path

import modal

LOCAL = modal.is_local()
ROOT = Path(__file__).resolve().parents[2] if LOCAL else Path("/srv/localschool")
SRV = "/srv/localschool"
DATA = "/data"


def _dependencies() -> list[str]:
    import tomllib

    return tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["dependencies"]


image = modal.Image.debian_slim(python_version="3.12")
if LOCAL:
    if not (ROOT / "web" / "dist" / "index.html").exists():
        raise SystemExit("Build the web app first: cd web && npm ci && npm run build")
    image = (
        image.pip_install(*_dependencies())
        .add_local_dir(ROOT / "app", f"{SRV}/app")
        .add_local_dir(ROOT / "config", f"{SRV}/config")
        .add_local_dir(ROOT / "demo", f"{SRV}/demo")
        .add_local_dir(ROOT / "scripts", f"{SRV}/scripts")
        .add_local_dir(ROOT / "web" / "dist", f"{SRV}/web/dist")
    )

data = modal.Volume.from_name("localschool-app-data", create_if_missing=True)
app = modal.App("localschool-app", image=image)


def _persist_loop(interval: float = 20.0) -> None:
    # Volume changes become durable on commit; background writes (embeddings, streamed
    # chat answers) are covered by this loop, request writes by the middleware below.
    while True:
        time.sleep(interval)
        try:
            data.commit()
        except Exception:  # noqa: BLE001 — never kill the server over a commit
            pass


@app.function(
    volumes={DATA: data},
    secrets=[modal.Secret.from_name("localschool-app")],
    cpu=1.0,
    memory=1024,
    max_containers=1,       # SQLite: exactly one writer
    scaledown_window=900,   # stay warm 15 min after the last request
    timeout=3600,
)
@modal.concurrent(max_inputs=64)
@modal.asgi_app()
def web():
    import asyncio
    import sys

    sys.path.insert(0, SRV)
    os.environ.setdefault("DATA_DIR", DATA)
    os.environ.setdefault("RUNTIME_KIND", "ollama")
    os.environ.setdefault("COOKIE_SECURE", "true")
    os.environ.setdefault("SQLITE_JOURNAL", "delete")  # db file alone is always consistent
    os.environ.setdefault("RUNTIME_TIMEOUT_S", "300")

    marker = Path(DATA) / ".demo-seeded"
    if os.environ.get("LS_SEED_DEMO") == "1" and not marker.exists():
        subprocess.run([sys.executable, "-m", "scripts.seed_demo"], cwd=SRV, check=True)
        marker.touch()
        data.commit()

    from app.main import create_app

    api = create_app()

    @api.middleware("http")
    async def persist_writes(request, call_next):
        response = await call_next(request)
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            try:
                await asyncio.to_thread(data.commit)
            except Exception as e:  # noqa: BLE001 — the 20s loop retries; never fail the request
                print(f"volume commit deferred: {e!r}", flush=True)
        return response

    threading.Thread(target=_persist_loop, daemon=True).start()
    return api
