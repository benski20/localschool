"""Local School model runtime on Modal: Ollama on a serverless GPU that sleeps when idle.

Easiest: run the "Deploy Modal runtime" GitHub Action (needs repo secrets MODAL_TOKEN_ID,
MODAL_TOKEN_SECRET and LS_RUNTIME_TOKEN). By hand:

    pip install modal && modal setup
    modal secret create localschool-runtime LS_RUNTIME_TOKEN=<a long random string>
    modal deploy deploy/modal/ollama_app.py                         # prints https://…modal.run
    modal run deploy/modal/ollama_app.py::pull --model qwen3:8b       # optional pre-pull
    modal run deploy/modal/ollama_app.py::pull --model nomic-embed-text

Then Local School → Admin → Runtime: type Ollama, the URL, and the token as Access token.

Knobs (set when deploying, e.g. `LS_GPU=A10G modal deploy …`):
    LS_GPU          GPU type (default L4, 24 GB — fits gpt-oss:20b and qwen3:8b)
    LS_IDLE_SECONDS seconds of no traffic before the GPU shuts down (default 300)

Ollama has no auth, so a small token proxy (deploy/token_proxy.py) sits in front of it.
Model weights live on a Modal Volume: they download once and survive restarts.
Only use synthetic/demo data with a cloud runtime; real student data belongs on the school box.
"""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import modal

GPU = os.environ.get("LS_GPU", "L4")
IDLE_SECONDS = int(os.environ.get("LS_IDLE_SECONDS", "300"))
OLLAMA_DIR = "/root/.ollama"
PUBLIC_PORT = 11434   # token proxy (exposed)
OLLAMA_PORT = 11435   # Ollama itself (container-local)
PROXY = Path(__file__).resolve().parent.parent / "token_proxy.py"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl", "ca-certificates", "zstd")
    .run_commands("curl -fsSL https://ollama.com/install.sh | sh")
    .pip_install("aiohttp>=3.9")
    .env({
        "OLLAMA_HOST": f"127.0.0.1:{OLLAMA_PORT}",
        "OLLAMA_MODELS": f"{OLLAMA_DIR}/models",
        "OLLAMA_KEEP_ALIVE": "30m",       # keep weights in GPU memory between questions
        "OLLAMA_NUM_PARALLEL": "4",       # concurrent requests per loaded model
        "OLLAMA_MAX_LOADED_MODELS": "2",  # chat + embedding model together
    })
    .add_local_file(PROXY, "/opt/localschool/token_proxy.py")
)
models = modal.Volume.from_name("localschool-ollama-models", create_if_missing=True)
secret = modal.Secret.from_name("localschool-runtime")
app = modal.App("localschool-ollama", image=image)


def _start_ollama() -> subprocess.Popen:
    proc = subprocess.Popen(["ollama", "serve"])
    for _ in range(120):
        if subprocess.run(["ollama", "list"], capture_output=True).returncode == 0:
            return proc
        time.sleep(0.5)
    raise RuntimeError("ollama did not start")


@app.function(
    gpu=GPU,
    volumes={OLLAMA_DIR: models},
    secrets=[secret],
    scaledown_window=IDLE_SECONDS,
    timeout=24 * 3600,
    max_containers=1,  # one GPU; Ollama batches requests itself
)
@modal.concurrent(max_inputs=16)
@modal.web_server(port=PUBLIC_PORT, startup_timeout=300)
def serve() -> None:
    _start_ollama()
    subprocess.Popen([
        "python", "/opt/localschool/token_proxy.py",
        "--listen", f"0.0.0.0:{PUBLIC_PORT}", "--upstream", f"http://127.0.0.1:{OLLAMA_PORT}",
    ])


@app.function(gpu=GPU, volumes={OLLAMA_DIR: models}, timeout=3600)
def pull(model: str = "qwen3:8b") -> None:
    """Download a model into the shared volume ahead of time."""
    _start_ollama()
    subprocess.run(["ollama", "pull", model], check=True)
    models.commit()
    print(f"pulled {model}")
