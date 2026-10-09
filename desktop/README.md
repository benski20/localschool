# Local School for Mac

A native Mac app for teachers. It's a thin client: **no AI models run on the Mac**. It
connects to the school's Local School server and shows the same interface, plus what a
browser tab can't do:

| | |
|---|---|
| **Finds the server automatically** | Bonjour discovery of `_localschool._tcp` on school Wi-Fi. Teachers click their school's name instead of typing an address. |
| **Remembers it** | Reconnects on launch. If the server isn't responding, a clear screen offers *Try again* or *Choose another server*. |
| **⌥Space from anywhere** | Brings Local School forward with the cursor in the question box. |
| **Mac menus and shortcuts** | ⌘N new question, ⌘1–4 Ask/Library/Roster/Admin, ⌘K command palette, ⌘R reload, full Edit menu (copy/paste), *Switch School Server…*, *Open in Browser*. |
| **Mac window behavior** | Unified title bar, remembered size and position, closing the window keeps the app in the Dock (⌘Q quits). |
| **Downloads** | Original documents and templates save to ~/Downloads and are revealed in Finder. |
| **Contained** | Only the connect screen and the school server load in the window; other links open in the default browser. Server pages get no native access beyond dragging the window. |

## Install (pilot)

Download `Local School_x.y.z_universal.dmg` from the **Desktop (macOS)** GitHub Action
(or a `desktop-v*` release), open it, and drag *Local School* to Applications.

Until the app is signed with an Apple Developer ID, macOS shows a warning the first
time. **Right-click the app → Open → Open**, once. For a district rollout, add the signing
secrets listed in `.github/workflows/desktop-macos.yml` so builds are signed and notarized.

## Pre-configure for every teacher (IT)

Push this file with your MDM (Jamf, Mosyle, Kandji…) and teachers never see the connect
screen:

```
/Library/Application Support/Local School/server.json
{"url": "http://maplegrove.local:8000", "name": "Maple Grove Middle School"}
```

A teacher's own choice (*Switch School Server…*) overrides it.

For discovery, start the server with `ADVERTISE_MDNS=true` and `SCHOOL_NAME="…"`.

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
