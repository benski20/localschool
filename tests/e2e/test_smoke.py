"""Browser smoke test + accessibility audit against the built web UI.

    make web && LS_E2E=1 pytest tests/e2e -q

Runs the real server (offline FakeProvider runtime) in a subprocess and drives it with
Playwright: login → upload → ask → open citation → swap chat model → ask again, then
runs axe-core on every page in light and dark mode (fails on serious/critical issues).
Set CHROMIUM_PATH to use a preinstalled Chromium.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
AXE = ROOT / "web" / "node_modules" / "axe-core" / "axe.min.js"

pytestmark = pytest.mark.skipif(os.environ.get("LS_E2E") != "1", reason="set LS_E2E=1 to run browser tests")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    if not (ROOT / "web" / "dist" / "index.html").exists():
        pytest.skip("web UI not built (run `make web`)")
    data = tmp_path_factory.mktemp("data")
    port = _free_port()
    env = {**os.environ, "DATA_DIR": str(data), "RUNTIME_KIND": "fake", "CHAT_MODEL": "fake-chat",
           "EMBED_MODEL": "fake-embed", "ADMIN_EMAIL": "admin@maplegrove.demo", "ADMIN_PASSWORD": "admin-pass-123"}
    subprocess.run([sys.executable, "-m", "scripts.seed_demo"], cwd=ROOT, env=env, check=True, capture_output=True)
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)],
                            cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    import httpx

    for _ in range(100):
        try:
            if httpx.get(base + "/api/health").status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.1)
    yield base
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    from playwright.sync_api import sync_playwright

    exe = os.environ.get("CHROMIUM_PATH")
    with sync_playwright() as p:
        b = p.chromium.launch(**({"executable_path": exe} if exe else {}))
        yield b
        b.close()


def _login(page, base, email, password):
    page.goto(base + "/chat")
    page.fill("#email", email)
    page.fill("#password", password)
    page.click("button:has-text('Sign in')")
    page.wait_for_selector("nav[aria-label='Main']")


def _axe(page) -> list[dict]:
    page.wait_for_timeout(400)  # let fade-in animations settle so contrast is measured at rest
    page.add_script_tag(path=str(AXE))
    result = page.evaluate("async () => (await axe.run(document, {resultTypes: ['violations']})).violations")
    return [v for v in result if v["impact"] in ("serious", "critical")]


def test_teacher_flow_and_model_swap(server, browser, tmp_path):
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    page = ctx.new_page()
    _login(page, server, "jordan.lee@maplegrove.demo", "demo-pass-123")

    # upload a document
    page.goto(server + "/library")
    doc = tmp_path / "bus-schedule.md"
    doc.write_text("# Buses\n\nBus 12 leaves the north loop at 3:05 pm every school day.")
    page.set_input_files("input[type=file]", str(doc))
    page.wait_for_selector("text=bus schedule")

    # ask, then open the citation
    page.goto(server + "/chat")
    page.fill("#ask", "When does bus 12 leave?")
    page.keyboard.press("Enter")
    page.wait_for_selector("button[aria-label='Copy answer']", timeout=15000)
    assert "fake-chat" in page.inner_text("main")
    page.click("button[aria-label^='Show source']")
    page.wait_for_selector("aside[aria-label='Source'] >> text=3:05")
    ctx.close()

    # admin pulls a model and makes it the chat model
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    page = ctx.new_page()
    _login(page, server, "admin@maplegrove.demo", "admin-pass-123")
    page.goto(server + "/admin")
    page.click("role=tab[name='Models']")
    page.locator("div.rounded-lg:has(span:text-is('qwen3:8b'))").locator("button:has-text('Pull')").click()
    page.locator("div.rounded-lg:has(span:text-is('qwen3:8b'))").locator("button:has-text('Use')").click(timeout=10000)
    page.wait_for_selector("text=qwen3:8b now answers questions")

    page.goto(server + "/chat")
    page.fill("#ask", "What is the cell phone policy?")
    page.keyboard.press("Enter")
    page.wait_for_selector("button[aria-label='Copy answer']", timeout=15000)
    assert "qwen3:8b" in page.inner_text("main")
    ctx.close()


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_accessibility(server, browser, scheme):
    if not AXE.exists():
        pytest.skip("axe-core not installed (npm install in web/)")
    ctx = browser.new_context(viewport={"width": 1280, "height": 860}, color_scheme=scheme)
    page = ctx.new_page()
    page.goto(server + "/chat")
    page.wait_for_selector("#email")
    problems = {"login": _axe(page)}
    _login(page, server, "admin@maplegrove.demo", "admin-pass-123")
    for path in ("/chat", "/library", "/roster", "/admin"):
        page.goto(server + path)
        page.wait_for_load_state("networkidle")
        problems[path] = _axe(page)
    ctx.close()
    failures = {k: [(v["id"], v["help"], len(v["nodes"])) for v in vs] for k, vs in problems.items() if vs}
    assert not failures, failures
