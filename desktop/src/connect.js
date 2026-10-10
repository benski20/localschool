// Connect screen: reconnect to the saved school server, or find/enter one.
// Native work (Bonjour, health checks, saving) happens in Rust; see src-tauri/src/lib.rs.
"use strict";

// The product name is about to change: this is the only place it lives in the connect screen.
const PRODUCT_NAME = "Teacher's Desk";

const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

document.title = PRODUCT_NAME;
for (const el of document.querySelectorAll("[data-product]")) el.textContent = PRODUCT_NAME;

// ---------------------------------------------------------------- helpers

let currentView = null;
function show(view) {
  const next = $(`view-${view}`);
  if (currentView === next) return;
  const prev = currentView;
  currentView = next;
  for (const v of ["checking", "unreachable", "choose"]) {
    const el = $(`view-${v}`);
    if (el !== next && el !== prev) el.hidden = true;
  }
  if (prev && !reduceMotion()) {
    prev.classList.remove("is-entering");
    prev.classList.add("is-leaving");
    setTimeout(() => {
      prev.classList.remove("is-leaving");
      if (prev !== currentView) prev.hidden = true;
    }, 140);
  } else if (prev) {
    prev.hidden = true;
  }
  next.classList.remove("is-leaving", "is-entering");
  next.hidden = false;
  void next.offsetWidth; // restart the entrance animation
  next.classList.add("is-entering");
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// "The Shipley School" → "S": the first letter of the first meaningful word.
function monogramOf(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  const word = words.find((w) => !/^(the|a|an)$/i.test(w)) || words[0] || "?";
  const ch = word.match(/[\p{L}\p{N}]/u);
  return (ch ? ch[0] : "?").toLocaleUpperCase();
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
  button.setAttribute("aria-busy", String(busy));
  const slot = button.querySelector(".btn-label") || button;
  slot.textContent = label;
  const spin = button.querySelector(".spinner");
  if (busy && !spin) {
    const s = document.createElement("span");
    s.className = "spinner";
    s.setAttribute("aria-hidden", "true");
    button.prepend(s);
  } else if (!busy && spin) {
    spin.remove();
  }
}

function shake(el) {
  if (reduceMotion()) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

async function connect(info) {
  await invoke("connect_server", { url: info.url, name: info.name });
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

// ---------------------------------------------------------------- saved server

let attempt = 0; // a newer action makes an in-flight reconnect stale

async function reconnect(saved) {
  const mine = ++attempt;
  show("checking");
  $("checking-mono").textContent = monogramOf(saved.name);
  $("checking-title").textContent = `Connecting to ${saved.name}…`;
  $("checking-host").textContent = hostOf(saved.url);
  $("checking-other").onclick = () => {
    attempt++;
    choose(saved);
  };
  try {
    const info = await invoke("check_server", { address: saved.url });
    if (mine !== attempt) return;
    await connect(info);
  } catch {
    if (mine !== attempt) return;
    unreachable(saved);
  }
}

function unreachable(saved) {
  show("unreachable");
  $("unreachable-mono").textContent = monogramOf(saved.name);
  $("unreachable-title").textContent = `Can't reach ${saved.name}`;
  const host = document.createElement("span");
  host.className = "host-chip";
  host.textContent = hostOf(saved.url);
  $("unreachable-body").replaceChildren(host, " isn't responding right now.");
  $("unreachable-meta").textContent = `Last tried at ${timeFmt.format(new Date())}`;
  $("choose-other").onclick = () => {
    attempt++;
    choose(saved);
  };
  const retry = $("retry");
  retry.onclick = async () => {
    const mine = ++attempt;
    setBusy(retry, true, "Trying…");
    $("unreachable-meta").textContent = `Checking ${hostOf(saved.url)}…`;
    try {
      const info = await invoke("check_server", { address: saved.url });
      if (mine !== attempt) return;
      await connect(info);
    } catch {
      if (mine !== attempt) return;
      setBusy(retry, false, "Try again");
      $("unreachable-meta").textContent = `Still not responding · last tried at ${timeFmt.format(new Date())}`;
      const view = $("view-unreachable");
      if (!reduceMotion()) {
        view.classList.remove("shake-retry");
        void view.offsetWidth;
        view.classList.add("shake-retry");
      }
      retry.focus();
    }
  };
}

// ---------------------------------------------------------------- choose a server

let scanning = false;

function setGroupState(state) {
  $("found-group").dataset.state = state;
}

function serverRow(s, i) {
  const li = document.createElement("li");
  li.style.setProperty("--i", i);
  const b = document.createElement("button");
  b.className = "server";
  b.type = "button";
  b.innerHTML =
    '<span class="monogram" aria-hidden="true"></span>' +
    '<span class="server-text"><span class="server-name"></span>' +
    '<span class="server-host"><span class="live" aria-hidden="true"></span><span class="host-text"></span></span></span>' +
    '<span class="server-go"><span class="go-label">Connect</span>' +
    '<svg class="chev" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  b.querySelector(".monogram").textContent = monogramOf(s.name);
  b.querySelector(".server-name").textContent = s.name;
  b.querySelector(".host-text").textContent = s.host || hostOf(s.url);
  b.setAttribute("aria-label", `Connect to ${s.name}, ${s.host || hostOf(s.url)}`);
  b.onclick = () => tryAddress(s.url, b);
  li.append(b);
  return li;
}

async function scan(quiet = false) {
  if (scanning) return;
  scanning = true;
  const list = $("found");
  const status = $("scan-status");
  const section = $("found-group").parentElement;
  section.classList.add("is-scanning");
  $("scan-pill-text").textContent = "Searching";
  // Skeletons only when there's nothing on screen yet; a quiet rescan keeps the empty state.
  if (!quiet && !list.children.length) setGroupState("scanning");
  try {
    const servers = await invoke("discover_servers");
    const same =
      servers.length === list.children.length &&
      servers.every((s, i) => list.children[i]?.dataset.url === s.url);
    if (!same) {
      list.replaceChildren(
        ...servers.map((s, i) => {
          const li = serverRow(s, i);
          li.dataset.url = s.url;
          return li;
        }),
      );
    }
    if (servers.length) {
      setGroupState("found");
    } else {
      $("empty-title").textContent = "No schools found yet";
      status.textContent = `Still looking for ${PRODUCT_NAME} servers. If macOS asks to find devices on your local network, choose Allow — or enter the address below.`;
      setGroupState("empty");
    }
    // Keep looking while nothing is found: the first scan often runs before the teacher
    // answers macOS's local-network prompt, and the school should appear on its own after.
    if (!servers.length) scheduleRescan();
  } catch (err) {
    $("empty-title").textContent = "Can't search this network";
    status.textContent = String(err);
    if (!list.children.length) setGroupState("empty");
    scheduleRescan();
  } finally {
    scanning = false;
    // While nothing is found we keep searching quietly, so the pill stays on.
    if (list.children.length) section.classList.remove("is-scanning");
    else $("scan-pill-text").textContent = "Still searching";
  }
}

let rescanTimer = null;
function scheduleRescan() {
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(() => {
    if (!$("view-choose").hidden && !$("found").children.length) scan(true);
  }, 4000);
}

// ---------------------------------------------------------------- manual entry + connecting

const field = $("field");
const address = $("address");

function setFieldError(message) {
  const err = $("error");
  if (message) {
    err.textContent = message;
    err.hidden = false;
    address.setAttribute("aria-invalid", "true");
    field.classList.add("is-invalid");
    shake(field);
  } else {
    err.hidden = true;
    address.removeAttribute("aria-invalid");
    field.classList.remove("is-invalid");
  }
}

// Catch obvious typos before asking the network; the server check does the rest.
function validate(v) {
  if (!v) return "Enter your school server's address, e.g. school.local:8000";
  if (/\s/.test(v)) return "Addresses can't contain spaces.";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !/^https?:\/\//i.test(v)) return "Use an http:// or https:// address.";
  const host = v.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  if (!host || !/^(\[[0-9a-f:.]+\]|[\p{L}\p{N}.-]+)(:\d{1,5})?$/iu.test(host)) return "That doesn't look like a server address.";
  return "";
}

function clearRowErrors() {
  for (const e of document.querySelectorAll(".server-error")) e.remove();
}

async function tryAddress(address, button) {
  setFieldError("");
  clearRowErrors();
  const btn = button || $("connect");
  btn.disabled = true;
  if (button) {
    btn.setAttribute("aria-busy", "true");
    btn.querySelector(".go-label").textContent = "Connecting";
    const sp = document.createElement("span");
    sp.className = "spinner";
    sp.setAttribute("aria-hidden", "true");
    btn.querySelector(".server-go").prepend(sp);
    btn.querySelector(".chev").style.display = "none";
  } else {
    setBusy(btn, true, "Connecting");
  }
  try {
    const info = await invoke("check_server", { address });
    await connect(info);
  } catch (e) {
    if (button) {
      btn.removeAttribute("aria-busy");
      btn.querySelector(".go-label").textContent = "Connect";
      btn.querySelector(".server-go .spinner")?.remove();
      btn.querySelector(".chev").style.display = "";
      const p = document.createElement("span");
      p.className = "server-error";
      p.setAttribute("role", "alert");
      p.textContent = String(e);
      btn.querySelector(".server-text").append(p);
    } else {
      setBusy(btn, false, "Connect");
      setFieldError(String(e));
    }
    btn.disabled = false;
  }
}

function choose(saved) {
  show("choose");
  setBusy($("connect"), false, "Connect");
  if (saved) address.value = hostOf(saved.url);
  address.focus({ preventScroll: true });
  scan();
}

$("rescan").onclick = () => scan();
address.addEventListener("input", () => {
  if (!$("error").hidden) setFieldError("");
});
$("manual").onsubmit = (e) => {
  e.preventDefault();
  const v = address.value.trim();
  const problem = validate(v);
  if (problem) {
    setFieldError(problem);
    address.focus();
    return;
  }
  tryAddress(v);
};

// ---------------------------------------------------------------- start

(async () => {
  const saved = await invoke("current_server").catch(() => null);
  if (saved && !params.has("switch")) reconnect(saved);
  else choose(saved);
})();
