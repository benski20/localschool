// Connect screen: reconnect to the saved school server, or find/enter one.
// Native work (Bonjour, health checks, saving) happens in Rust; see src-tauri/src/lib.rs.
"use strict";

const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

function show(view) {
  for (const v of ["checking", "unreachable", "choose"]) $(`view-${v}`).hidden = v !== view;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.innerHTML = busy ? `<span class="spinner" aria-hidden="true"></span>${label}` : label;
}

async function connect(info) {
  await invoke("connect_server", { url: info.url, name: info.name });
}

// ---------------------------------------------------------------- saved server

async function reconnect(saved) {
  show("checking");
  $("checking-title").textContent = `Connecting to ${saved.name}…`;
  $("checking-host").textContent = hostOf(saved.url);
  try {
    const info = await invoke("check_server", { address: saved.url });
    await connect(info);
  } catch {
    show("unreachable");
    $("unreachable-title").textContent = `Can't reach ${saved.name}`;
    $("unreachable-body").textContent = `${hostOf(saved.url)} isn't responding. Make sure you're on the school network (or its VPN), then try again.`;
    $("retry").onclick = () => reconnect(saved);
    $("choose-other").onclick = () => choose(saved);
  }
}

// ---------------------------------------------------------------- choose a server

let scanning = false;

async function scan() {
  if (scanning) return;
  scanning = true;
  const list = $("found");
  const status = $("scan-status");
  status.innerHTML = '<span class="spinner" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"></span>Looking for Local School servers…';
  try {
    const servers = await invoke("discover_servers");
    list.replaceChildren(
      ...servers.map((s) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.className = "server";
        b.type = "button";
        b.innerHTML = '<span class="dot" aria-hidden="true"></span><span><div class="name"></div><div class="host"></div></span><span class="go" aria-hidden="true">→</span>';
        b.querySelector(".name").textContent = s.name;
        b.querySelector(".host").textContent = s.host || hostOf(s.url);
        b.onclick = () => tryAddress(s.url, b);
        li.append(b);
        return li;
      }),
    );
    status.textContent = servers.length
      ? ""
      : "No servers found on this network. Enter the address below, or check you're on school Wi-Fi.";
  } catch (err) {
    status.textContent = String(err);
  } finally {
    scanning = false;
  }
}

async function tryAddress(address, button) {
  const err = $("error");
  err.hidden = true;
  const btn = button || $("connect");
  const label = btn.innerHTML;
  btn.disabled = true;
  if (!button) setBusy(btn, true, "Connecting");
  try {
    const info = await invoke("check_server", { address });
    await connect(info);
  } catch (e) {
    err.textContent = String(e);
    err.hidden = false;
    if (!button) setBusy(btn, false, "Connect");
    else btn.innerHTML = label;
    btn.disabled = false;
  }
}

function choose(saved) {
  show("choose");
  if (saved) $("address").value = hostOf(saved.url);
  $("address").focus();
  scan();
}

$("rescan").onclick = scan;
$("manual").onsubmit = (e) => {
  e.preventDefault();
  const v = $("address").value.trim();
  if (v) tryAddress(v);
};

// ---------------------------------------------------------------- start

(async () => {
  const saved = await invoke("current_server").catch(() => null);
  if (saved && !params.has("switch")) reconnect(saved);
  else choose(saved);
})();
