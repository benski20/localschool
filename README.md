# Teacher's Desk

**Private AI for schools.** Teachers ask questions in the **Teacher's Desk Mac app** (or any browser) and get answers grounded in the school's own documents and their own class roster. Every claim links to its source. All models run on a GPU **runtime** the school controls; teacher Macs never run a model.

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

## Try it now: just open a link

**https://teachers-desk-xi.vercel.app**

Press **Try the demo** (a fictional school) or sign in as `admin@school.local`. There's nothing to install. Send teachers [TEACHERS.md](TEACHERS.md), a one-page guide.

This address is a Vercel front door that forwards everything to the hosted pilot on Modal (`Actions → Deploy Vercel front door`). The pilot runs on Modal, deployed by **Actions → Deploy Modal runtime**: the app server sits in one small container with its data on a Modal Volume, and the model runtime in another. Both sleep when idle. Use it for **demo data only**; real student data goes on the on-site server below. The admin password is the `LS_ADMIN_PASSWORD` secret, or `LS_RUNTIME_TOKEN` if that isn't set. Change it with the key icon.

The Mac app ships connected to this link, so the release zip just works. A school's own server or IT's managed `server.json` overrides it.

## Run your own server on a Mac (10 minutes)

The GPU/CPU runtime is already deployed on Modal. One Mac runs the server; that same Mac (or any other) runs the app.

```bash
brew install python@3.12 node            # once, if you don't have them
git clone https://github.com/benski20/localschool && cd localschool
LS_SEED_DEMO=1 ./scripts/install-server-mac.sh
#   runtime type: ollama
#   runtime URL:  the URL from the "Deploy Modal runtime" run
#   token:        your LS_RUNTIME_TOKEN
#   chat model:   qwen3:1.7b (CPU runtime)
curl -fsSL http://localhost:8000/install/mac.sh | bash     # installs + opens the Mac app
```

Sign in as `jordan.lee@maplegrove.demo` / `demo-pass-123` (demo teacher), or with the admin account you chose. `LS_SEED_DEMO=1` loads the fictional Maple Grove school. Leave it off for your own data.

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
4. In Teacher's Desk: **Admin → Runtime**. Set type to *Ollama*, paste that URL, and paste your `LS_RUNTIME_TOKEN` as the *Access token*. **Test connection → Save.**

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

**Keep my data on this Mac.** A teacher can also run their own server inside the Mac app. On the connect screen they choose *Keep my data on this Mac instead* and sign in with their school account. There are no technical fields.

The school's server hands that Mac a revocable key (`POST /api/auth/device`). The teacher's server then:
- runs on `127.0.0.1:8765` only, kept running by launchd, after setup requires FileVault;
- keeps documents, roster, chats, drafts and recordings on the Mac;
- uses the school's AI through `/api/relay` (model calls only; the runtime's address and token never leave the school server).

Admins see and remove these Macs in Settings › People. Details: [desktop/README.md](desktop/README.md#keep-my-data-on-this-mac).

Their documents, roster, chats, drafts and recordings stay on that Mac. Only the models are remote: point it at the school box, because a cloud runtime would receive each question's passages. Details are in [desktop/README.md](desktop/README.md#keep-my-data-on-this-mac).

## For school leaders and IT

- **Sign in with Google or Microsoft.** Settings › People › *Sign in with Google or Microsoft*.
  - Paste the client ID and secret of the school's own Google Cloud OAuth client or Entra app registration. The page shows the exact redirect address to register.
  - Set the school's email domain. Only accounts at that domain can sign in.
  - Choose whether anyone at the domain may join as a teacher; off by default, so only people you've added can sign in.
  - It's direct OpenID Connect (code flow with PKCE), with no third-party sign-in service. In the Mac app, sign-in happens in the teacher's browser and hands back to the app through a `teachersdesk://` link.
- **Activity log.** Settings › Activity records who signed in, whose student information was used and by whom, and changes to people, documents and Macs.
  - It never records the question text or document contents.
  - It's searchable, can be downloaded as CSV, and is kept for a year (`ACTIVITY_DAYS`).
- **Privacy page.** `/privacy` is public and needs no sign-in. It explains in plain language where information is kept, what the AI sees and how long things are kept, using this install's real settings (`/api/trust`). It prints as one page.
- **Word export.** Teachers can download any answer or draft as a .docx. It's generated on the server and nothing is stored.

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
    base.py         ModelProvider protocol: chat(stream, optional JSON schema) · embed · transcribe ·
                    list/pull/delete models · health
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
    tools/          teacher tools (meeting notes, feedback, adapt a reading, parent email): prompts,
                    strict-JSON jobs with one repair retry, verbatim-quote checks, private drafts;
                    the drafts table is the job queue (API reference atop routes/tools.py)
    auth.py         local accounts (scrypt) + cookie sessions
  routes/         thin HTTP layer (FastAPI); SSE for chat
web/              Vite + React + TypeScript + Tailwind (design tokens in src/styles/tokens.css)
desktop/          Mac app (Tauri): connect screen, Bonjour discovery, menus, ⌥Space, downloads
deploy/           modal/ · kaggle/ · box/   (runtime-as-code for every target); token_proxy.py guards
                  the runtime, whisper_server.py is its speech-to-text (/v1/audio/transcriptions)
```

Key decisions:

- **The runtime is swappable.** Everything above `llm/` is runtime-agnostic. Admins repoint the URL or swap models live, with no restart.
- **Model swaps can't corrupt search.** Each embedding model gets its own vector table, and search only uses the active model's table. Changing the embed model re-indexes in the background; keyword search keeps working meanwhile.
- **Grounding is enforced, not requested.** The model only sees sources the user may see. Citations that don't map to a real source are removed before saving. With no sources, the answer is "I couldn't find that…".
- **Access is enforced in SQL, not in the prompt.** Roster scoping happens in `roster.students_for`, the same rule as the SIS.
- **Costs stay predictable.** Status comes from last-known state (no polling of the GPU), a semaphore caps concurrent generations, and Modal scales to zero.
- **Tools are drafts, with receipts.** Every tool output is a private draft the teacher edits; nothing is sent or graded. Feedback quotes are checked word for word against the student's work, and meeting notes cite transcript lines. Recordings are deleted when the teacher approves the notes.
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
