"""Local School model runtime on Modal: Ollama on a serverless GPU that sleeps when idle.

Easiest: run the "Deploy Modal runtime" GitHub Action (needs repo secrets MODAL_TOKEN_ID,
MODAL_TOKEN_SECRET and LS_RUNTIME_TOKEN). By hand:

    pip install modal && modal setup
    modal secret create localschool-runtime LS_RUNTIME_TOKEN=<a long random string>
    modal deploy deploy/modal/ollama_app.py                         # prints https://…modal.run
    modal run deploy/modal/ollama_app.py::pull --model qwen3:8b       # optional pre-pull
    modal run deploy/modal/ollama_app.py::pull --model nomic-embed-text
    modal run deploy/modal/ollama_app.py::pull_whisper                # speech-to-text weights

Then Local School → Admin → Runtime: type Ollama, the URL, and the token as Access token.

Knobs (set when deploying, e.g. `LS_GPU=A10G modal deploy …`):
    LS_GPU          GPU type (default L4, 24 GB — fits gpt-oss:20b and qwen3:8b), or `none`
                    for a CPU-only runtime (8 cores, 16 GB). Modal requires a payment method
                    on the account for any GPU; CPU works on the free Starter credits.
                    Pair CPU with a small model such as qwen3:1.7b.
    LS_IDLE_SECONDS seconds of no traffic before the GPU shuts down (default 300)
    WHISPER_MODEL   speech-to-text model for meeting notes (default base.en; e.g. small.en
                    is more accurate and ~3x slower). Always runs on CPU, int8.

Ollama has no auth, so a small token proxy (deploy/token_proxy.py) sits in front of it.
Speech-to-text: a faster-whisper sidecar (deploy/whisper_server.py) serves the
OpenAI-compatible POST /v1/audio/transcriptions; the proxy routes /v1/audio/* to it
behind the same token.
Model weights (Ollama's and Whisper's) live on a Modal Volume: they download once and
survive restarts.
Only use synthetic/demo data with a cloud runtime; real student data belongs on the school box.
"""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import modal

GPU_SETTING = os.environ.get("LS_GPU", "L4").strip()
GPU = None if GPU_SETTING.lower() in ("", "none", "cpu") else GPU_SETTING
# CPU-only: give Ollama enough cores/memory for a small model; with a GPU, Modal's defaults.
RESOURCES = {"cpu": 8.0, "memory": 16384} if GPU is None else {}
IDLE_SECONDS = int(os.environ.get("LS_IDLE_SECONDS", "300"))
OLLAMA_DIR = "/root/.ollama"
PUBLIC_PORT = 11434   # token proxy (exposed)
OLLAMA_PORT = 11435   # Ollama itself (container-local)
WHISPER_PORT = 11436  # speech-to-text sidecar (container-local)
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "").strip() or "base.en"
WHISPER_DIR = f"{OLLAMA_DIR}/whisper"  # on the volume: weights download once
DEPLOY = Path(__file__).resolve().parent.parent
PROXY = DEPLOY / "token_proxy.py"
SIDECAR = DEPLOY / "whisper_server.py"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl", "ca-certificates", "zstd")
    .run_commands("curl -fsSL https://ollama.com/install.sh | sh")
    # faster-whisper decodes with PyAV (bundled FFmpeg: webm/ogg/m4a/mp3/wav); this pair is
    # known to work together (av 16+ dropped an argument faster-whisper 1.2 still passes).
    .pip_install("aiohttp>=3.9", "faster-whisper==1.2.1", "av==15.1.0")
    .env({
        "OLLAMA_HOST": f"127.0.0.1:{OLLAMA_PORT}",
        "OLLAMA_MODELS": f"{OLLAMA_DIR}/models",
        "OLLAMA_KEEP_ALIVE": "30m",       # keep weights in GPU memory between questions
        # Teacher tools send prompts of up to ~7k tokens (a student essay plus its rubric),
        # so each request gets an 8k context. On CPU, 2 parallel slots keep the KV cache the
        # same size as Ollama's default 4 x 4k.
        "OLLAMA_CONTEXT_LENGTH": "8192",
        "OLLAMA_NUM_PARALLEL": "2" if GPU is None else "4",  # concurrent requests per model
        "OLLAMA_MAX_LOADED_MODELS": "2",  # chat + embedding model together
        "WHISPER_MODEL": WHISPER_MODEL,
        "WHISPER_DIR": WHISPER_DIR,
        "WHISPER_THREADS": "4",           # leave the other cores to Ollama
        "HF_HUB_DISABLE_TELEMETRY": "1",
    })
    .add_local_file(PROXY, "/opt/localschool/token_proxy.py")
    .add_local_file(SIDECAR, "/opt/localschool/whisper_server.py")
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
    **RESOURCES,
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
    # Loads the Whisper weights from the volume in the background; first use waits for it.
    subprocess.Popen(["python", "/opt/localschool/whisper_server.py", "--listen", f"127.0.0.1:{WHISPER_PORT}"])
    subprocess.Popen([
        "python", "/opt/localschool/token_proxy.py",
        "--listen", f"0.0.0.0:{PUBLIC_PORT}", "--upstream", f"http://127.0.0.1:{OLLAMA_PORT}",
        "--audio-upstream", f"http://127.0.0.1:{WHISPER_PORT}",
    ])


# Downloading weights never needs a GPU: pull on a cheap CPU container.
@app.function(volumes={OLLAMA_DIR: models}, timeout=3600)
def pull(model: str = "qwen3:8b") -> None:
    """Download a model into the shared volume ahead of time."""
    _start_ollama()
    subprocess.run(["ollama", "pull", model], check=True)
    models.commit()
    print(f"pulled {model}")


@app.function(volumes={OLLAMA_DIR: models}, timeout=1800)
def pull_whisper(model: str = WHISPER_MODEL) -> None:
    """Download the speech-to-text weights into the shared volume ahead of time."""
    subprocess.run(["python", "/opt/localschool/whisper_server.py", "--download", model], check=True)
    models.commit()
    print(f"pulled whisper {model}")
