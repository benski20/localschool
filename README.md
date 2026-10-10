# Local School

**Private AI for schools.** Teachers ask questions in the **Local School Mac app** (or any browser) and get answers grounded in the school's own documents and their own class roster. Every claim links to its source. All models run on a GPU **runtime** the school controls; teacher Macs never run a model.

This repo is the **pilot**: grounded chat, a document library, a roster, admin tools to connect a GPU and swap models, and a native Mac app.

```
 Mac app / browsers  ──HTTP(S)──▶  App server  (FastAPI + SQLite, no models, ~200 MB RAM)
 (teachers)            Bonjour ◀──  advertises itself on the school network
                                     │  RUNTIME_URL + token/headers
                                     ▼
                     Model runtime (Ollama, OpenAI-compatible API)
                     pilot: Modal GPU or Kaggle notebook │ production: the on-site school box
```

Moving from the pilot GPU to the school box is a URL change in **Admin → Runtime**, not a code change.

---

## Pilot in 30 minutes

1. **GPU runtime.** Add the Modal secrets, then run **Actions → Deploy Modal runtime** (below). It prints a URL.
2. **Mac app.** Run **Actions → Desktop (macOS)** and download `LocalSchool-macOS.zip`.
3. **Server.** On a school Mac that stays on: `git clone … && ./scripts/install-server-mac.sh`. Answer the prompts, then paste the runtime URL and token. Set `LS_APP_ZIP=~/Downloads/LocalSchool-macOS.zip` to offer the app to teachers. It starts at login (launchd) and announces itself on the network.
4. **Teachers.** Each runs the one-liner from Admin → People → *Teacher Macs*. Then press ⌥Space anywhere to ask.

Undo with `./scripts/uninstall-server-mac.sh`.

## Quick start: offline demo (2 minutes, no GPU)

```bash
make setup        # Python venv + web deps
make web          # build the UI
make demo         # fictional "Maple Grove" school + offline fake runtime → http://localhost:8000
```

Sign in as **jordan.lee@maplegrove.demo / demo-pass-123** (teacher) or **admin@school.local / change-me** (admin; set `ADMIN_EMAIL`/`ADMIN_PASSWORD` to change).
The fake runtime returns canned, cited answers so you can walk through the UI. Connect a real GPU (below) for real answers.

## Connect a free GPU runtime (pilot)

> While models run in someone else's cloud, use **synthetic demo data only**. The app shows a "Demo runtime" banner whenever the runtime is outside the school network. Real student records wait for the on-site box.

### Option A: Modal (recommended; free monthly credits, sleeps when idle)

**From GitHub, no local setup:**

1. Create a free account at modal.com. Under **Settings → API Tokens**, create a token.
2. In this repo, go to **Settings → Secrets and variables → Actions** and add `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, and `LS_RUNTIME_TOKEN` (any long random string, e.g. `openssl rand -hex 24`).
3. **Actions → Deploy Modal runtime → Run workflow.** It deploys Ollama on an L4 GPU, downloads `qwen3:8b` and `nomic-embed-text`, runs the live eval against it, and prints the URL.
4. In Local School: **Admin → Runtime**. Set type to *Ollama*, paste that URL, and paste your `LS_RUNTIME_TOKEN` as the *Access token*. **Test connection → Save.**

By hand instead: `pip install modal && modal setup`, then `modal secret create localschool-runtime LS_RUNTIME_TOKEN=…`, then `modal deploy deploy/modal/ollama_app.py`.

Ollama has no authentication, so a small token proxy (`deploy/token_proxy.py`) runs in front of it, and requests without the token get a 401. The GPU sleeps after 5 idle minutes. The first question after that takes about 1–2 minutes while it wakes, and the UI says so. Status displays never ping the GPU, so leaving the app open costs nothing.

### Option B: Kaggle notebook ($0, short demos)

Import `deploy/kaggle/runtime.ipynb` into Kaggle, turn on **GPU T4** and **Internet**, and choose **Run all**. The notebook prints a tunnel URL and token. Paste them into **Admin → Runtime**. Sessions last at most about 12 hours and the URL changes every time.

### Production: the school box

Any NVIDIA PC (or a Mac running Ollama natively) on the school network:

```bash
cp .env.example .env    # set ADMIN_PASSWORD, COOKIE_SECURE if behind HTTPS
docker compose -f deploy/box/docker-compose.yml --profile nvidia up -d     # or --profile mac
```

Teachers open `http://<box-name>.local:8000`. Ollama is never exposed to the network; only the app talks to it.

## The Mac app (teachers)

`desktop/` is a small native Mac app (Tauri, which uses the system WebKit and bundles no browser; universal for Apple Silicon and Intel). It's a thin client to the server above:
- **Finding the server.** It discovers the school's server over Bonjour and remembers it.
- **Shortcuts.** ⌥Space brings it up from anywhere, ready to ask. ⌘N starts a new question; ⌘1–4 switch pages.
- **Downloads.** Files save to ~/Downloads.
- **Mac behavior.** Closing the window keeps the app in the Dock.
- **IT rollout.** IT can push the server address with any MDM.

Build it with the **Desktop (macOS)** GitHub Action (no Mac needed; produces `LocalSchool-macOS.zip` and a `.dmg`). Teachers install with one line from the school server, `curl -fsSL http://<server>:8000/install/mac.sh | bash`, which needs **no Apple Developer ID** and shows no security prompt. Details: [desktop/README.md](desktop/README.md).

To make the server discoverable, start it with `ADVERTISE_MDNS=true SCHOOL_NAME="Maple Grove Middle School"`.

## Using it

| Page | Who | What |
|---|---|---|
| **Ask** | everyone | Chat that streams answers with `[n]` citations. Click one to open the passage or roster record in the source panel. ⌘K jumps anywhere. |
| **Library** | everyone | Upload PDF, DOCX, Markdown or TXT, or paste text. Keyword search works instantly; meaning-based search turns on as passages are indexed. |
| **Roster** | admins import; teachers view their own | CSV import with preview (template: `/api/roster/template.csv`; example: `demo/roster.csv`). |
| **Admin** | admins | Runtime connection and health, model pulls, the active model for each role, and people. |

In a browser, the web app is also an installable **PWA**: Chrome or Edge shows **Install**, and the app opens in its own window. Unsent drafts are kept.

## Architecture

```
app/
  llm/            The one interface to a model runtime
    base.py         ModelProvider protocol: chat(stream) · embed · list/pull/delete models · health
    ollama.py       Ollama (Modal, Kaggle, box): OpenAI-compatible /v1 + native model management
    openai_compat.py  vLLM / llama.cpp; strips <think> reasoning from streams; retries + clear errors
    fake.py         Deterministic offline provider (tests, demos)
    registry.py     Runtime: live provider (rebuilt when an admin changes the URL), role→model registry,
                    generation slots (GPU concurrency), last-known reachability
  services/
    ingest.py       parse PDF/DOCX/MD → heading/page-aware chunks (citable units)
    embeddings.py   one vector space per embedding model; background worker fills the active one
    retrieval.py    hybrid search: SQLite FTS5 BM25 + sqlite-vec cosine, fused with reciprocal rank fusion
    roster.py       CSV import + SQL-enforced scoping (teachers see only their sections)
    chat.py         retrieve → numbered sources → stream → server-side citation validation → persist
    models.py       background model pulls with progress
    auth.py         local accounts (scrypt) + cookie sessions
  routes/         thin HTTP layer (FastAPI); SSE for chat
web/              Vite + React + TypeScript + Tailwind (design tokens in src/styles/tokens.css)
desktop/          Mac app (Tauri): connect screen, Bonjour discovery, menus, ⌥Space, downloads
deploy/           modal/ · kaggle/ · box/   (runtime-as-code for every target)
```

Key decisions:

- **The runtime is swappable.** Everything above `llm/` is runtime-agnostic. Admins repoint the URL or swap models live, with no restart.
- **Model swaps can't corrupt search.** Each embedding model gets its own vector table, and search only uses the active model's table. Changing the embed model re-indexes in the background; keyword search keeps working meanwhile.
- **Grounding is enforced, not requested.** The model only sees sources the user may see. Citations that don't map to a real source are removed before saving. With no sources, the answer is "I couldn't find that…".
- **Access is enforced in SQL, not in the prompt.** Roster scoping happens in `roster.students_for`, the same rule as the SIS.
- **Costs stay predictable.** Status comes from last-known state (no polling of the GPU), a semaphore caps concurrent generations, and Modal scales to zero.
- **Zero ops.** One SQLite file holds everything (FTS5 + sqlite-vec). Backup is a file copy.

## Development

```bash
make dev     # API on :8000 (reload) + Vite on :5173 (proxying /api)
make test    # 30+ unit/API tests with the fake runtime: no GPU or network
make e2e     # Playwright: login → upload → ask → cite → swap model → ask; axe accessibility audit (light + dark)
make check   # tests + TypeScript typecheck
```

Configuration lives in `.env` (see `.env.example`). The API docs are at `/api/docs`.

## Roadmap after the pilot

Tool-calling over the roster (precise filters and date math), an audit log export, Google Classroom/LTI, meeting notes on the box (the Mac app can capture meeting audio), and signed auto-updates for the Mac app.
