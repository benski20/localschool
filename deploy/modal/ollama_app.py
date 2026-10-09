"""Local School model runtime on Modal: Ollama on a serverless GPU that sleeps when idle.

One-time setup (free Modal account, includes monthly credits):
    pip install modal && modal setup
    modal deploy deploy/modal/ollama_app.py
    modal run deploy/modal/ollama_app.py::pull --model qwen3:8b       # optional pre-pull
    modal run deploy/modal/ollama_app.py::pull --model nomic-embed-text

Then in Modal's dashboard create a *Proxy Auth Token* (Settings → Proxy Auth Tokens) and
paste into Local School → Admin → Runtime:
    URL:     the https://…modal.run URL printed by `modal deploy`
    Headers: {"Modal-Key": "wk-…", "Modal-Secret": "ws-…"}

Knobs (set when deploying, e.g. `LS_GPU=A10G modal deploy …`):
    LS_GPU          GPU type (default L4, 24 GB — fits gpt-oss:20b and qwen3:8b)
    LS_IDLE_SECONDS seconds of no traffic before the GPU shuts down (default 300)

Model weights live on a Modal Volume, so they download once and survive restarts.
Only use synthetic/demo data with a cloud runtime; real student data belongs on the school box.
"""

from __future__ import annotations

import os
import subprocess
import time

import modal

GPU = os.environ.get("LS_GPU", "L4")
IDLE_SECONDS = int(os.environ.get("LS_IDLE_SECONDS", "300"))
OLLAMA_DIR = "/root/.ollama"
PORT = 11434

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl", "ca-certificates", "zstd")
    .run_commands("curl -fsSL https://ollama.com/install.sh | sh")
    .env({
        "OLLAMA_HOST": f"0.0.0.0:{PORT}",
        "OLLAMA_MODELS": f"{OLLAMA_DIR}/models",
        "OLLAMA_KEEP_ALIVE": "30m",     # keep weights in GPU memory between questions
        "OLLAMA_NUM_PARALLEL": "4",     # concurrent requests per loaded model
        "OLLAMA_MAX_LOADED_MODELS": "2",  # chat + embedding model together
    })
)
models = modal.Volume.from_name("localschool-ollama-models", create_if_missing=True)
app = modal.App("localschool-ollama", image=image)


def _start_ollama() -> subprocess.Popen:
    proc = subprocess.Popen(["ollama", "serve"])
    for _ in range(120):
        try:
            subprocess.run(["ollama", "list"], check=True, capture_output=True)
            return proc
        except subprocess.CalledProcessError:
            time.sleep(0.5)
    raise RuntimeError("ollama did not start")


@app.function(
    gpu=GPU,
    volumes={OLLAMA_DIR: models},
    scaledown_window=IDLE_SECONDS,
    timeout=24 * 3600,
    max_containers=1,  # one GPU; Ollama batches requests itself
)
@modal.concurrent(max_inputs=16)
@modal.web_server(port=PORT, startup_timeout=300, requires_proxy_auth=True)
def serve() -> None:
    _start_ollama()


@app.function(gpu=GPU, volumes={OLLAMA_DIR: models}, timeout=3600)
def pull(model: str = "qwen3:8b") -> None:
    """Download a model into the shared volume ahead of time."""
    _start_ollama()
    subprocess.run(["ollama", "pull", model], check=True)
    models.commit()
    print(f"pulled {model}")
