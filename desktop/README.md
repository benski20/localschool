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
{"url": "http://maplegrove.local:8000", "name": "Maple Grove Middle School"}
```

A teacher's own choice (*Switch School Server…*) overrides it.

For discovery, start the server with `ADVERTISE_MDNS=true` and `SCHOOL_NAME="…"`.

## Keep my data on this Mac

For a teacher whose data should stay on their own laptop, the app can run its own server.
The server is bundled in the app at `Contents/Resources/server`, staged by
`desktop/stage-server.sh`. On the connect screen the teacher chooses
*Keep my data on this Mac instead* and enters:
- their name, email and a password;
- the school's **AI server** (the box's Ollama address) and access key.

`scripts/setup-local-mac.sh` then:
1. Refuses to continue unless FileVault is on.
2. Installs `uv` and a private Python 3.12 into `~/Library/Application Support/org.localschool.desktop/local`. Nothing is installed system-wide.
3. Copies the server there and installs its dependencies.
4. Writes `server.env` (mode 600), with the bootstrap password removed after the first start.
5. Starts it with launchd (`org.localschool.desk`) on **127.0.0.1:8765 only**.

All data lives in `local/data`. When the app opens, it updates the server if the app is newer and restarts it if it isn't running.

| Stays on the Mac | Leaves the Mac |
|---|---|
| Documents and their search index, roster, chats, drafts, meeting audio (until notes are approved) | Per question: the passages it needs, sent to the AI server you named. Meetings: the audio, for transcription. |

Use the school box as the AI server. A cloud runtime (the Modal pilot) would receive those passages.

**IT, without the app UI:**

```bash
S="/Applications/Teacher's Desk.app/Contents/Resources/server/scripts/setup-local-mac.sh"
TEACHER_NAME="Jordan Lee" TEACHER_EMAIL=… TEACHER_PASSWORD=… SCHOOL_NAME="The Shipley School" \
  RUNTIME_URL=http://ai.school.local:11434 RUNTIME_TOKEN=… bash "$S"
LS_REMOVE=1 bash "$S"   # stop it and delete this Mac's copy of the data (cannot be undone)
```

Logs: `~/Library/Logs/Teachers Desk/`. The **Desktop (macOS)** workflow tests the whole path on a real Mac: setup, sign-in, upload, restart, update and removal.

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
