# Teacher's Desk for Mac

A native Mac app for teachers. It's a thin client: **no AI models run on the Mac**. It
connects to the school's Teacher's Desk server and shows the same interface, plus what a
browser tab can't do:

| | |
|---|---|
| **Finds the server automatically** | Bonjour discovery of `_localschool._tcp` on school Wi-Fi. Teachers click their school's name instead of typing an address. |
| **Remembers it** | Reconnects on launch. If the server isn't responding, a clear screen offers *Try again* or *Choose another server*. |
| **⌥Space from anywhere** | Brings Teacher's Desk forward with the cursor in the question box. |
| **Mac menus and shortcuts** | ⌘N new question, ⌘1–4 Ask/Library/Roster/Admin, ⌘K command palette, ⌘R reload, full Edit menu (copy/paste), *Switch School Server…*, *Open in Browser*. |
| **Mac window behavior** | Unified title bar, remembered size and position, closing the window keeps the app in the Dock (⌘Q quits). |
| **Downloads** | Original documents and templates save to ~/Downloads and are revealed in Finder. |
| **Contained** | Only the connect screen and the school server load in the window; other links open in the default browser. Server pages get no native access beyond dragging the window. |

## Install: no Apple Developer ID needed

**Teachers: one line in Terminal** (Admin → People → *Teacher Macs* shows it, with your server's address):

```bash
curl -fsSL http://<school-server>:8000/install/mac.sh | bash
```

This downloads the app from the school server, puts it in Applications, and opens it already connected. There's no security prompt. macOS only checks apps carrying the "quarantine" tag that browsers add to downloads; `curl` (and MDM) never add it. The server installer (`scripts/install-server-mac.sh`) puts the app on the server for you via `LS_APP_ZIP`. The app itself comes from the **Desktop (macOS)** GitHub Action (`LocalSchool-macOS.zip`) or a `desktop-v*` release.

**IT with an MDM** (Jamf, Mosyle, Kandji): deploy `LocalSchool-macOS.zip` (or the app inside it) plus the managed `server.json` below. MDM installs aren't quarantined either.

**Opening a DMG downloaded in a browser** works too. Because the app is ad-hoc signed rather than notarized, macOS shows a warning the first time. On macOS 15+, open **System Settings → Privacy & Security** and click **Open Anyway**; on older versions, right-click the app and choose **Open**.

**When a Developer ID ($99/yr) is worth it:** only if staff outside your MDM will install from browser downloads, or a district security review asks for notarized software. Add the secrets listed in `.github/workflows/desktop-macos.yml` and builds come out signed and notarized. Nothing else changes.

## Pre-configure for every teacher (IT)

Push this file with your MDM (Jamf, Mosyle, Kandji…) and teachers never see the connect
screen:

```
/Library/Application Support/Teachers Desk/server.json
{"url": "http://shipley.local:8000", "name": "The Shipley School"}
```

A teacher's own choice (*Switch School Server…*) overrides it.

For discovery, start the server with `ADVERTISE_MDNS=true` and `SCHOOL_NAME="…"`.

## Sign in with Google or Microsoft

Google refuses sign-in inside embedded web views, so the app does it in the teacher's browser:
1. The **Continue with Google** button gets the provider's address from the school (`/api/auth/sso/google/start?mode=app&json=1`) and goes there. The app's navigation rule sends any other site to the default browser.
2. When the teacher has signed in, the school's page opens `teachersdesk://signin?code=…`. The code is one-time and expires in two minutes.
3. The app (`tauri-plugin-deep-link`, URL scheme `teachersdesk`) loads `/api/auth/sso/redeem?code=…` in its window, which signs that window in.

*Keep my data on this Mac* works the same way with `teachersdesk://desk?code=…`. The teacher's own desk then gets a random password, stored in the login Keychain (`Teacher's Desk (this Mac)`). The app always opens that desk already signed in, using `/api/auth/code` on the desk.

## Keep my data on this Mac

For a teacher whose data should stay on their own laptop, the app runs its own server for them. It is bundled at `Contents/Resources/server`, staged by `desktop/stage-server.sh`.

On the connect screen the teacher chooses *Keep my data on this Mac instead* and signs in with their **school email and password**. There's nothing else to type.

1. **The app signs in to the school's server.** That is the saved one, else the IT default, else the built-in one. The call is `POST /api/auth/device`, and it returns:
   - the teacher's name and the school;
   - the school's chat and embedding models;
   - a key for this Mac, stored only as a hash at school.
2. **`scripts/setup-local-mac.sh` sets up the Mac:**
   - it refuses to continue unless FileVault is on;
   - it installs `uv` and a private Python 3.12 into `~/Library/Application Support/org.localschool.desktop/local`. Nothing is installed system-wide;
   - it copies the server there and writes `server.env` (mode 600), with the bootstrap password removed after the first start;
   - it starts the server with launchd (`org.localschool.desk`) on **127.0.0.1:8765 only**.
3. **The teacher's server uses the school's AI through `/api/relay`** (`RUNTIME_KIND=relay`, `app/llm/relay.py`). Only model calls go through it: chat, embeddings, transcription and the model list. They pass through the school's runtime and its capacity limits. The runtime's own address and token never leave the school's server, and nothing is stored there.

When the app opens, it updates the server if the app is newer, and restarts it if it isn't running.

| Stays on the Mac | Leaves the Mac |
|---|---|
| Documents and their search index, roster, chats, drafts, meeting audio (until notes are approved) | Per question, the passages it needs, sent to the school's server for its AI. For meetings, the audio, for transcription. |

The school's server forwards these to its AI runtime. On the school box that stays on-site; on the hosted pilot it reaches the cloud runtime, so use the pilot with fictional data only.

**Admins** see these Macs in Settings › People (*Macs keeping their own data*). **Remove** cuts that Mac off from the school's AI, and so does deleting the teacher's account.

**IT, without the app UI:** the CI step in `.github/workflows/desktop-macos.yml` shows the two calls: get a key from `/api/auth/device`, then run the bundled script with `RUNTIME_KIND=relay`. To stop it and delete this Mac's copy of the data (this cannot be undone):

```bash
LS_REMOVE=1 bash "/Applications/Teacher's Desk.app/Contents/Resources/server/scripts/setup-local-mac.sh"
```

Logs: `~/Library/Logs/Teachers Desk/`. The **Desktop (macOS)** workflow tests the whole path on a real Mac:
- the sign-in for a key, and setup;
- a question answered through the relay;
- a restart, and an update that keeps the data;
- the admin removing the Mac, and removal.

## Develop

Requires Rust and Node, on a Mac.

```bash
cd desktop
npm install
npx tauri dev                                   # run against any server
npx tauri build --target universal-apple-darwin # .app + .dmg in src-tauri/target/…/bundle
```

```
desktop/
  src/                 connect screen (HTML/CSS/JS, same design tokens as the web app)
  src-tauri/src/lib.rs window, menus, ⌥Space, navigation policy, downloads, commands
  src-tauri/src/server.rs   address parsing, health check, saved + MDM-managed server
  src-tauri/src/discovery.rs Bonjour browsing
  src-tauri/capabilities/   connect screen: 4 app commands; server pages: window drag only
  src-tauri/Info.plist      local-network permission text, LAN http allowance
```

The web app detects the shell via its user agent (`LocalSchoolDesktop/…`). It then adds
title-bar spacing and skips the PWA service worker.
