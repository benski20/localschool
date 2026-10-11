// Connect screen: reconnect to the saved school server, or find/enter one.
// Native work (Bonjour, health checks, saving) happens in Rust; see src-tauri/src/lib.rs.
"use strict";

// The product name is about to change: this const is the single source for the connect screen
// (the static <title> in index.html mirrors it for the first paint).
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
  for (const v of ["checking", "unreachable", "choose", "local", "installing"]) {
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
  $("checking-name").textContent = saved.name;
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
  $("unreachable-body").textContent = "Your saved server isn't responding right now.";
  $("unreachable-name").textContent = saved.name;
  $("unreachable-host").textContent = hostOf(saved.url);
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

let lastSaved = null;

function choose(saved) {
  lastSaved = saved;
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

// ---------------------------------------------------------------- keep my data on this Mac
// This Mac runs its own server for one teacher (127.0.0.1 only); models stay remote.

const LOCAL_URL = "http://127.0.0.1:8765";

const SSO_LABEL = { google: "Google", microsoft: "Microsoft" };

async function localStatus() {
  const st = await invoke("local_status").catch(() => null);
  $("go-local").hidden = !st?.bundled;
  $("filevault").hidden = !st || st.filevault;
  renderSso(st?.sso || []);
  // The hosted demo (fictional students): fill in its teacher with one click.
  $("local-demo").hidden = !st?.demo;
  $("local-demo-fill").onclick = () => {
    $("l-email").value = st.demo.email;
    $("l-password").value = st.demo.password;
    $("local-start").focus();
  };
  return st;
}

// Google / Microsoft: sign in in the browser; the school's page hands a code back to the
// app (teachersdesk://desk), which starts setting up. Meanwhile this screen waits.
function renderSso(providers) {
  $("local-sso").hidden = !providers.length;
  const box = $("local-sso-buttons");
  if (box.dataset.for === providers.join(",")) return;
  box.dataset.for = providers.join(",");
  box.replaceChildren(
    ...providers.map((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-secondary";
      b.textContent = `Continue with ${SSO_LABEL[p] || p}`;
      b.onclick = () => continueWith(p);
      return b;
    }),
  );
}

let waitingForBrowser = false;
async function continueWith(provider) {
  setLocalError("");
  const st = await localStatus();
  if (st && !st.filevault) {
    shake($("filevault"));
    return;
  }
  try {
    await invoke("setup_local_sso", { provider });
  } catch (e) {
    setLocalError(String(e));
    return;
  }
  $("local-sso-wait").hidden = false;
  if (waitingForBrowser) return;
  waitingForBrowser = true;
  const started = Date.now();
  (async function wait() {
    const p = await invoke("local_progress").catch(() => null);
    if (p?.running) {
      waitingForBrowser = false;
      $("local-sso-wait").hidden = true;
      show("installing");
      watchSetup();
    } else if (Date.now() - started < 10 * 60 * 1000 && !$("view-local").hidden) {
      setTimeout(wait, 700);
    } else {
      waitingForBrowser = false;
    }
  })();
}

async function openLocal() {
  const st = await localStatus();
  if (st?.installed) {
    // Already set up: just open it.
    reconnect({ url: LOCAL_URL, name: "this Mac" });
    return;
  }
  show("local");
  if (lastSaved && lastSaved.name !== "your school" && !lastSaved.url.startsWith(LOCAL_URL)) {
    $("local-school").textContent = lastSaved.name;
  }
  $("l-email").focus({ preventScroll: true });
}

function setLocalError(message) {
  const err = $("local-error");
  err.textContent = message || "";
  err.hidden = !message;
}

function localForm() {
  const form = { email: $("l-email").value.trim(), password: $("l-password").value };
  const problem =
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && ["l-email", "Enter your school email address."]) ||
    (!form.password && ["l-password", "Enter your password."]);
  return { form, problem };
}

async function setUpLocal() {
  setLocalError("");
  const st = await localStatus();
  if (st && !st.filevault) {
    shake($("filevault"));
    return;
  }
  const { form, problem } = localForm();
  if (problem) {
    setLocalError(problem[1]);
    $(problem[0]).focus();
    shake($("local-form"));
    return;
  }
  try {
    await invoke("setup_local", { form });
  } catch (e) {
    setLocalError(String(e));
    return;
  }
  show("installing");
  watchSetup();
}

async function watchSetup() {
  const p = await invoke("local_progress").catch(() => null);
  if (p) {
    const total = p.total || 5;
    $("installing-step").textContent = p.text || "Starting";
    $("installing-count").textContent = p.step ? `${p.step} of ${total}` : "";
    $("installing-bar").setAttribute("aria-valuenow", String(p.step || 0));
    $("installing-bar").firstElementChild.style.width = `${Math.max(4, ((p.step || 0) / total) * 100)}%`;
  }
  if (!p || p.running) {
    setTimeout(watchSetup, 700);
    return;
  }
  if (p.ready) {
    $("installing-step").textContent = "Opening";
    $("installing-bar").firstElementChild.style.width = "100%";
    $("l-password").value = "";
    try {
      await connect(await invoke("check_server", { address: LOCAL_URL }));
      return;
    } catch (e) {
      p.error = String(e);
    }
  }
  show("local");
  setLocalError(p.error || "Setup didn't finish. Try again.");
}

$("go-local").onclick = () => openLocal();
$("local-back").onclick = () => choose(lastSaved);
$("local-form").onsubmit = (e) => {
  e.preventDefault();
  setUpLocal();
};
$("filevault-open").onclick = () => invoke("open_filevault_settings").catch(() => {});
$("filevault-check").onclick = async () => {
  const st = await localStatus();
  if (st && !st.filevault) shake($("filevault"));
};

// ---------------------------------------------------------------- start

(async () => {
  localStatus();
  if (params.has("local")) {
    // "Keep my data on this Mac…" from the menu or the account menu.
    lastSaved = await invoke("current_server").catch(() => null);
    openLocal();
    return;
  }
  if (params.has("setup")) {
    // Back from signing in with Google / Microsoft: setting up is under way.
    show("installing");
    watchSetup();
    return;
  }
  const saved = await invoke("current_server").catch(() => null);
  if (saved && !params.has("switch")) reconnect(saved);
  else choose(saved);
})();
