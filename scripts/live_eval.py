"""Live evaluation of a running Local School server against a REAL model runtime.

    python -m scripts.live_eval --base http://127.0.0.1:8000 \\
        --admin admin@school.local:change-me --switch-model qwen3:0.6b

Drives the public HTTP API exactly like the web/Mac app: waits for the library to be
embedded by the real embedding model, asks the questions in tests/eval/questions.yaml as
a teacher, and checks:

  hard (any failure exits 1): every answer completes; every [n] in an answer maps to a
      returned source; no source ever belongs to another teacher's student; the index is
      fully embedded; switching the chat model through the admin API takes effect live;
      a question with `model:` is answered by that model (skipped if /api/models doesn't
      offer it); an `attach:` file is uploaded privately, is among that answer's sources and
      isn't in anyone else's document list (deleted again with --cleanup).
  soft (scored): the answer contains enough expected facts (`min_expect`) and none of the
      `forbid` names (a wrong student listed is a wrong answer). Fails below --min-score.

Writes a Markdown report (to $GITHUB_STEP_SUMMARY when set, else stdout).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import httpx
import yaml

ROOT = Path(__file__).resolve().parent.parent
CITE = re.compile(r"\[(\d+)\]")


def login(base: str, email: str, password: str) -> httpx.Client:
    c = httpx.Client(base_url=base, timeout=httpx.Timeout(900, connect=15))
    r = c.post("/api/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    # Send the session cookie explicitly: some Python cookie-jar policies refuse to
    # store cookies for bare-IP hosts like 127.0.0.1.
    token = r.cookies.get("ls_session")
    if not token:
        raise SystemExit(f"login for {email} returned no session cookie: {r.headers.get('set-cookie')!r}")
    c.cookies.clear()
    c.headers["Cookie"] = f"ls_session={token}"
    return c


def ask(c: httpx.Client, question: str, model: str | None = None,
        attachments: list[int] | None = None) -> tuple[list[dict], float]:
    t0 = time.perf_counter()
    events = []
    body: dict = {"question": question}
    if model:
        body["model"] = model
    if attachments:
        body["attachments"] = attachments
    with c.stream("POST", "/api/chat", json=body) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if line.startswith("data:"):
                events.append(json.loads(line[5:]))
    return events, time.perf_counter() - t0


def wait_index(c: httpx.Client, timeout: float) -> dict:
    deadline = time.time() + timeout
    idx = {}
    while time.time() < deadline:
        idx = c.get("/api/status").json()["index"]
        if idx["total_chunks"] and idx["embedded_chunks"] >= idx["total_chunks"]:
            return idx
        if idx.get("error"):
            print(f"  index: {idx['embedded_chunks']}/{idx['total_chunks']} ({idx['error']})", flush=True)
        time.sleep(3)
    raise SystemExit(f"index never finished embedding: {idx}")


def offered_models(c: httpx.Client) -> dict[str, str]:
    """Teacher-selectable models (model → label); empty on a server without /api/models."""
    r = c.get("/api/models")
    if r.status_code != 200:
        return {}
    return {o["model"]: o["label"] for o in r.json()["options"]}


def upload_private(c: httpx.Client, path: Path, timeout: float = 120) -> int:
    """Upload `path` as the teacher's private document and wait until it's ready."""
    r = c.post("/api/documents", data={"visibility": "private"},
               files=[("files", (path.name, path.read_bytes(), "text/markdown"))])
    r.raise_for_status()
    body = r.json()
    if not body["created"]:
        raise RuntimeError(f"upload of {path.name} failed: {body['errors']}")
    doc_id = body["created"][0]
    deadline = time.time() + timeout
    while time.time() < deadline:
        doc = next((d for d in c.get("/api/documents").json()["documents"] if d["id"] == doc_id), None)
        if doc is None:
            raise RuntimeError(f"uploaded {path.name} is missing from the teacher's own list")
        if doc["status"] == "error":
            raise RuntimeError(f"{path.name} failed to process: {doc['error']}")
        if doc["status"] == "ready" and doc.get("visibility", "private") == "private":
            return doc_id
        time.sleep(1)
    raise RuntimeError(f"{path.name} never became ready")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--admin", default="admin@school.local:change-me", help="email:password")
    ap.add_argument("--teacher-password", default="demo-pass-123")
    ap.add_argument("--questions", default=str(ROOT / "tests" / "eval" / "questions.yaml"))
    ap.add_argument("--switch-model", default="", help="installed chat model to switch to mid-run")
    ap.add_argument("--min-score", type=float, default=0.6)
    ap.add_argument("--index-timeout", type=float, default=900)
    ap.add_argument("--cleanup", action="store_true",
                    help="delete the conversations this run created (for evals against a shared server)")
    args = ap.parse_args()

    spec = yaml.safe_load(Path(args.questions).read_text())
    a_email, a_pass = args.admin.split(":", 1)
    admin = login(args.base, a_email, a_pass)
    models = admin.get("/api/admin/models").json()
    if models.get("error"):
        raise SystemExit(f"runtime unreachable: {models['error']}")
    active = models["active"]
    print(f"runtime ok · chat={active['chat']} embed={active['embed']} · installed={[m['name'] for m in models['installed']]}", flush=True)

    print("waiting for the real embedding model to index the library…", flush=True)
    idx = wait_index(admin, args.index_timeout)
    print(f"  indexed {idx['embedded_chunks']}/{idx['total_chunks']} passages with {idx['model']}", flush=True)

    teacher = login(args.base, spec["teacher"], args.teacher_password)
    forbidden = set(spec.get("other_teachers_students", []))
    offered = offered_models(teacher)
    print(f"teacher model picker: {offered or '(no /api/models on this server)'}", flush=True)
    hard: list[str] = []
    rows = []
    created: set[int] = set()
    uploaded: list[int] = []
    for item in spec["questions"]:
        label = item["q"]
        model = item.get("model")
        if model:
            if model not in offered:
                note = f"skipped: `{model}` isn't offered by /api/models on this server"
                rows.append((label, "⏭️", 0.0, note))
                print(f"SKIP         {label}  ({note})", flush=True)
                continue
            label = f"{label} _({offered[model]})_"
        attachments = None
        if item.get("attach"):
            try:
                doc_id = upload_private(teacher, Path(args.questions).parent / item["attach"])
            except (RuntimeError, httpx.HTTPError) as e:
                hard.append(f"attachment upload for {item['q']!r}: {e}")
                rows.append((label, "ERROR", 0.0, str(e)[:120]))
                continue
            uploaded.append(doc_id)
            attachments = [doc_id]
            label = f"{label} _(attached {item['attach']})_"
            if doc_id in {d["id"] for d in admin.get("/api/documents").json()["documents"]}:
                hard.append(f"teacher's private file {item['attach']} is visible to the admin's list")
        events, secs = ask(teacher, item["q"], model=model, attachments=attachments)
        created.update(e["id"] for e in events if e["type"] == "conversation")
        done = next((e for e in events if e["type"] == "done"), None)
        err = next((e for e in events if e["type"] == "error"), None)
        all_sources = next((e["sources"] for e in events if e["type"] == "sources"), [])
        if not done:
            hard.append(f"no answer for {item['q']!r}: {err}")
            rows.append((label, "ERROR", secs, str(err)[:120]))
            continue
        content = done["content"]
        cited = {s["n"] for s in done["sources"]}
        dangling = {int(n) for n in CITE.findall(content)} - cited
        if dangling:
            hard.append(f"dangling citations {dangling} in {item['q']!r}")
        leaked = {s["title"] for s in all_sources if s["kind"] == "student"} & forbidden
        if leaked:
            hard.append(f"other teacher's students in sources for {item['q']!r}: {leaked}")
        if model and done.get("model") != model:
            hard.append(f"asked with {model} but answered by {done.get('model')!r}: {item['q']!r}")
        if attachments and not any(s["kind"] == "attachment" and s["document_id"] in attachments
                                   for s in all_sources):
            hard.append(f"attached file not among the sources for {item['q']!r}")
        low = content.lower()
        hits = sum(x.lower() in low for x in item["expect"])
        wrong = [n for n in item.get("forbid", []) if n.lower() in low]
        ok = hits >= item.get("min_expect", 1) and not wrong
        note = f" ⚠️ wrongly named: {', '.join(wrong)}" if wrong else ""
        rows.append((label, "✅" if ok else "❌", secs, content.replace("\n", " ")[:160] + note))
        print(f"{'PASS' if ok else 'MISS'} {secs:5.1f}s  {label}\n      → {content[:200]!r}", flush=True)

    switched = ""
    if args.switch_model:
        r = admin.put("/api/admin/models/active", json={"role": "chat", "model": args.switch_model})
        if r.status_code != 200:
            hard.append(f"model switch failed: {r.text}")
        else:
            events, secs = ask(teacher, spec["questions"][0]["q"])
            created.update(e["id"] for e in events if e["type"] == "conversation")
            done = next((e for e in events if e["type"] == "done"), None)
            if not done or done["model"] != args.switch_model:
                hard.append(f"answer after switch not from {args.switch_model}: {events[-1]}")
            else:
                switched = f"Switched chat model live to `{args.switch_model}` → answered in {secs:.1f}s."
            admin.put("/api/admin/models/active", json={"role": "chat", "model": active["chat"]})

    if args.cleanup:
        for cid in created:
            teacher.delete(f"/api/conversations/{cid}")
        for doc_id in uploaded:
            teacher.delete(f"/api/documents/{doc_id}")

    scored = [r for r in rows if r[1] != "⏭️"]
    passed = sum(r[1] == "✅" for r in scored)
    score = passed / len(scored) if scored else 0.0
    skipped = len(rows) - len(scored)
    report = [
        f"## Live model eval — chat `{active['chat']}`, embed `{active['embed']}`",
        "",
        f"**Score: {score:.0%}** ({passed}/{len(scored)}) · min {args.min_score:.0%} · "
        f"index {idx['embedded_chunks']}/{idx['total_chunks']} passages"
        + (f" · {skipped} skipped" if skipped else ""),
        "",
        "| | Question | Time | Answer |",
        "|---|---|---|---|",
        *[f"| {ok} | {q} | {s:.1f}s | {a.replace('|', '/')} |" for q, ok, s, a in rows],
        "",
        switched,
        "",
        "**Hard checks:** " + ("all passed ✅" if not hard else "\n" + "\n".join(f"- ❌ {h}" for h in hard)),
    ]
    text = "\n".join(report)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(text + "\n")
    print(text)
    return 1 if hard or score < args.min_score else 0


if __name__ == "__main__":
    sys.exit(main())
