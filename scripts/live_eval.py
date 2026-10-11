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

With --tools, the teacher tools too (each draft must finish; scored separately against
--tools-min-score):
  parent email   mentions the topic it was asked about
  adapt          the Grade 3 version is shorter than the original
  feedback       has strengths and next steps, and every quote is verbatim from the work
                 and every rubric line exists (hard)
  meeting notes  from --audio (a short speech clip; CI makes one with espeak-ng) through the
                 runtime's speech-to-text, or from a pasted transcript without it: the notes
                 contain the clip's known facts (--audio-expect); approving deletes the
                 recording (hard)
  scoping (hard) targeting another teacher's student is a 404

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


# -- teacher tools -----------------------------------------------------------------------

TOOL_READING = (
    "Volcanoes are openings in the Earth's crust through which molten rock, ash and gases escape. Beneath "
    "the surface, intense heat melts rock into magma, which is lighter than the surrounding rock and therefore "
    "rises toward the surface. When pressure builds sufficiently, the magma erupts as lava. Some eruptions are "
    "explosive, propelling ash several kilometres into the atmosphere, whereas others release comparatively "
    "slow-moving rivers of lava. Volcanologists continuously monitor earthquakes, ground deformation and gas "
    "emissions in order to anticipate eruptions and protect nearby communities."
)
TOOL_WORK = (
    "My hero is my grandmother because she never gives up. When the factory in our town closed, she went back "
    "to school at fifty and became a nurse. She studied every night at the kitchen table while my brother and I "
    "did our homework. Now she works at the hospital and helps people every day. I think her story shows that it "
    "is never too late to learn something new."
)
TOOL_RUBRIC = (
    "Ideas: the writing has a clear central idea about the person\n"
    "Evidence: specific details and examples support the central idea\n"
    "Organization: events are in a logical order with a strong ending\n"
    "Conventions: spelling, punctuation and grammar are correct"
)
TOOL_TOPIC = "the science fair project is due next Friday"
MEETING_TEXT = ("This is an IEP meeting for Ava Thompson. We agreed to add a daily check-in with Ms. Rivera "
                "starting Monday.")


def wait_draft(c: httpx.Client, draft_id: int, timeout: float) -> dict:
    deadline = time.time() + timeout
    d: dict = {}
    while time.time() < deadline:
        d = c.get(f"/api/drafts/{draft_id}").json()["draft"]
        if d["status"] in ("ready", "error"):
            return d
        time.sleep(2)
    raise RuntimeError(f"draft {draft_id} never finished: {d.get('status')} / {d.get('stage')}")


def run_tools(teacher: httpx.Client, admin: httpx.Client, spec: dict, args) -> tuple[list, list[str], list[int]]:
    """(report rows, hard failures, draft ids created)."""
    rows: list[tuple[str, str, float, str]] = []
    hard: list[str] = []
    created: list[int] = []
    students = teacher.get("/api/roster").json()["students"]
    if not students:
        return rows, ["tools: the teacher has no students in the roster"], created
    student = next((s for s in students if s["name"] == spec.get("tools_student", "Ava Thompson")), students[0])
    forbidden = set(spec.get("other_teachers_students", []))
    other = next((s for s in admin.get("/api/roster").json()["students"] if s["name"] in forbidden), None)

    def run(label: str, tool: str, body: dict, check, *, audio: Path | None = None) -> None:
        t0 = time.perf_counter()
        try:
            r = teacher.post(f"/api/tools/{tool}/drafts", json=body)
            r.raise_for_status()
            draft = r.json()["draft"]
            created.append(draft["id"])
            if audio is not None:
                up = teacher.post(f"/api/meetings/{draft['id']}/audio", content=audio.read_bytes(),
                                  headers={"Content-Type": "audio/wav"})
                up.raise_for_status()
            d = wait_draft(teacher, draft["id"], args.tools_timeout)
        except (RuntimeError, httpx.HTTPError) as e:
            hard.append(f"{label}: {e}")
            rows.append((label, "ERROR", time.perf_counter() - t0, str(e)[:160]))
            return
        secs = time.perf_counter() - t0
        if d["status"] != "ready":
            hard.append(f"{label}: draft ended in error: {d['error']}")
            rows.append((label, "ERROR", secs, d["error"][:160]))
            return
        ok, note = check(d)
        rows.append((label, "✅" if ok else "❌", secs, note.replace("\n", " ")[:200]))
        print(f"{'PASS' if ok else 'MISS'} {secs:5.1f}s  {label}\n      → {note[:200]!r}", flush=True)

    def email_check(d: dict) -> tuple[bool, str]:
        text = f"{d['output']['subject']}\n{d['output']['body']}".lower()
        return "science fair" in text, f"{d['output']['subject']} — {d['output']['body']}"

    def adapt_check(d: dict) -> tuple[bool, str]:
        v = d["output"]["versions"][0]
        words, orig = v["readability"]["words"], d["output"]["original"]["words"]
        return words < orig, f"{words} words (original {orig}), grade ≈ {v['readability']['grade']}: {v['text']}"

    def feedback_check(d: dict) -> tuple[bool, str]:
        out, work, lines = d["output"], d["input"]["work"], d["input"]["rubric"]["lines"]
        items = out["strengths"] + out["next_steps"]
        for i in items:
            if i["quote"] not in work:
                hard.append(f"feedback quote not verbatim from the work: {i['quote']!r}")
            if not (1 <= i["rubric_line"] <= len(lines)) or i["rubric"] != lines[i["rubric_line"] - 1]:
                hard.append(f"feedback cites a rubric line that doesn't exist: {i['rubric_line']}")
        ok = bool(out["strengths"]) and bool(out["next_steps"])
        return ok, "; ".join(f"“{i['quote']}” (R{i['rubric_line']}) {i['comment']}" for i in items)

    def meeting_check(d: dict) -> tuple[bool, str]:
        transcript = " ".join(s["text"] for s in d["transcript"] or [])
        if not transcript.strip():
            hard.append("meeting transcript is empty")
        notes = json.dumps(d["output"]).lower()
        facts = [f for f in args.audio_expect.split(",") if f.strip()]
        hits = [f for f in facts if any(alt.strip().lower() in notes for alt in f.split("|"))]
        r = teacher.post(f"/api/drafts/{d['id']}/approve")
        if r.status_code != 200 or r.json()["draft"]["has_audio"]:
            hard.append(f"approving the meeting didn't delete the recording: {r.text[:200]}")
        return len(hits) >= min(2, len(facts)), f"heard: {transcript[:120]!r} · notes have {hits} · {d['output'].get('summary', '')}"

    sid = student["id"]
    run("Tool: parent email mentions the topic", "email",
        {"student_id": sid, "topic": TOOL_TOPIC, "tone": "warm"}, email_check)
    run("Tool: adapt to Grade 3 is shorter", "adapt",
        {"text": TOOL_READING, "title": "Volcanoes", "versions": [{"level": "grade_3"}]}, adapt_check)
    run("Tool: feedback quotes the work", "feedback",
        {"work": TOOL_WORK, "title": "My hero", "rubric_text": TOOL_RUBRIC}, feedback_check)
    if args.audio:
        run("Tool: meeting notes from a recording", "meeting",
            {"meeting_type": "iep", "student_id": sid, "consent": True}, meeting_check, audio=Path(args.audio))
    else:
        run("Tool: meeting notes from a pasted transcript", "meeting",
            {"meeting_type": "iep", "student_id": sid, "transcript_text": f"[00:00] {MEETING_TEXT}"}, meeting_check)
    if other is not None:
        r = teacher.post("/api/tools/email/drafts", json={"student_id": other["id"], "topic": TOOL_TOPIC})
        if r.status_code != 404:
            hard.append(f"tools: targeting another teacher's student returned {r.status_code}, not 404")
    return rows, hard, created


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
    ap.add_argument("--tools", action="store_true", help="also check the teacher tools")
    ap.add_argument("--audio", default="", help="speech clip (wav) for the meeting-notes check")
    ap.add_argument("--audio-expect", default="check-in|check in,monday,rivera",
                    help="facts the notes must contain (comma-separated; | separates spellings); 2 must match")
    ap.add_argument("--tools-min-score", type=float, default=0.75)
    ap.add_argument("--tools-timeout", type=float, default=900, help="seconds per tool draft")
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
    for d in admin.get("/api/documents").json()["documents"]:
        print(f"  · {d['title']} — {d['status']}, {d.get('chunk_count', '?')} passages", flush=True)

    teacher = login(args.base, spec["teacher"], args.teacher_password)
    # School-readiness basics: the public privacy facts and a Word download.
    trust = httpx.get(f"{args.base}/api/trust", timeout=60)
    if trust.status_code == 200:
        print(f"privacy page facts: {trust.json()}", flush=True)
        r = teacher.post("/api/export/docx", data={"title": "Live eval", "text": "# Check\n- Word export works"})
        if r.status_code != 200 or not r.content.startswith(b"PK"):
            raise SystemExit(f"Word export failed: {r.status_code} {r.text[:200]}")
        print(f"word export ok · {len(r.content)} bytes", flush=True)
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

    tool_rows: list = []
    tool_drafts: list[int] = []
    if args.tools:
        print("teacher tools…", flush=True)
        tool_rows, tool_hard, tool_drafts = run_tools(teacher, admin, spec, args)
        hard += tool_hard

    if args.cleanup:
        for draft_id in tool_drafts:
            teacher.delete(f"/api/drafts/{draft_id}")
        for cid in created:
            teacher.delete(f"/api/conversations/{cid}")
        for doc_id in uploaded:
            teacher.delete(f"/api/documents/{doc_id}")

    scored = [r for r in rows if r[1] != "⏭️"]
    passed = sum(r[1] == "✅" for r in scored)
    score = passed / len(scored) if scored else 0.0
    skipped = len(rows) - len(scored)
    tools_passed = sum(r[1] == "✅" for r in tool_rows)
    tools_score = tools_passed / len(tool_rows) if tool_rows else 1.0
    tools_report = [
        "",
        f"### Teacher tools — **{tools_score:.0%}** ({tools_passed}/{len(tool_rows)}) · min {args.tools_min_score:.0%}",
        "",
        "| | Check | Time | Output |",
        "|---|---|---|---|",
        *[f"| {ok} | {q} | {s:.1f}s | {a.replace('|', '/')} |" for q, ok, s, a in tool_rows],
    ] if args.tools else []
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
        *tools_report,
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
    return 1 if hard or score < args.min_score or (args.tools and tools_score < args.tools_min_score) else 0


if __name__ == "__main__":
    sys.exit(main())
