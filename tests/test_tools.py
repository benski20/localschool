"""Teacher tools through the API (FakeProvider runtime): ownership, roster scoping, job
lifecycle, JSON repair, verbatim quotes, recordings deleted on approve, transcription."""

from __future__ import annotations

import io
import json
import time
import wave

import pytest
from fastapi.testclient import TestClient

from app.db import connect
from app.llm import TRANSCRIBE_UNSUPPORTED, TranscriptSegment
from app.main import create_app
from app.services.tools import audio as audio_mod
from app.services.tools.common import FORMAT_FAILED

from .conftest import PASSWORD, login, seed

JORDAN, SAM, ADMIN = "jordan.lee@maplegrove.demo", "sam.patel@maplegrove.demo", "admin@test.local"

WORK = ("My hero is my grandmother because she never gives up. When the factory closed, she went back to "
        "school at fifty and became a nurse. She studied every night at the kitchen table while we did our "
        "homework. I think her story shows that it is never too late to learn something new.")
RUBRIC = ("# Narrative writing rubric\n- Ideas: a clear central idea about the person\n"
          "- Evidence: specific details and examples support the idea\n"
          "- Organization: a logical order with a strong ending\n| Conventions | Spelling and grammar |")
READING = ("Volcanoes are openings in the Earth's crust through which molten rock, ash and gases escape. "
           "Beneath the surface, intense heat melts rock into magma, which is lighter than the surrounding "
           "rock and therefore rises. When pressure builds sufficiently, the magma erupts as lava. Some "
           "eruptions are explosive, sending ash kilometres into the atmosphere, while others release slow "
           "rivers of lava. Scientists monitor earthquakes and gas emissions to predict eruptions and keep "
           "nearby communities safe.")


def wav_bytes(seconds: float = 0.5) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * int(16000 * seconds))
    return buf.getvalue()


def relogin(c: TestClient, email: str, password: str = PASSWORD) -> None:
    c.post("/api/auth/logout")
    login(c, email, password)


def student_id(settings, name: str) -> int:
    with connect(settings.db_path) as db:
        return db.execute("SELECT id FROM students WHERE name = ?", (name,)).fetchone()[0]


def wait_draft(c: TestClient, draft_id: int, timeout: float = 10.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        d = c.get(f"/api/drafts/{draft_id}").json()["draft"]
        if d["status"] in ("ready", "error"):
            return d
        time.sleep(0.02)
    raise AssertionError(f"draft {draft_id} stuck: {d}")


def create(c: TestClient, tool: str, body: dict) -> dict:
    r = c.post(f"/api/tools/{tool}/drafts", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# -- parent email ---------------------------------------------------------------------

def test_email_draft_lifecycle_and_privacy(client, settings, fake):
    login(client, JORDAN)
    ava = student_id(settings, "Ava Thompson")
    res = create(client, "email", {"student_id": ava, "topic": "the science fair project due Friday",
                                   "tone": "warm"})
    assert res["batch"] is None and len(res["drafts"]) == 1
    draft = res["draft"]
    assert draft["status"] in ("queued", "running") and draft["student"] == {"id": ava, "name": "Ava Thompson"}
    done = wait_draft(client, draft["id"])
    assert done["status"] == "ready", done
    out = done["output"]
    assert "science fair" in out["subject"].lower() and "science fair" in out["body"].lower()
    assert out["language"] == "English" and done["input"]["suggested_language"] == "English"
    assert done["mailto"].startswith("mailto:?subject=") and "science%20fair" in done["mailto"]
    assert "teacher" not in done["input"]
    # the prompt asked for JSON with a schema, in the teacher's voice, never sending
    assert fake.schemas[-1]["title"] == "ParentEmail"
    system = fake.prompts[-1][0].content
    assert "Jordan Lee" in system and "Never give or mention a grade" in system

    listed = client.get("/api/tools/email/drafts").json()["drafts"]
    assert [d["id"] for d in listed] == [draft["id"]] and listed[0]["preview"]
    assert "output" not in listed[0]
    assert client.get("/api/tools/adapt/drafts").json()["drafts"] == []

    edited = client.put(f"/api/drafts/{draft['id']}", json={
        "output": {"subject": "Science fair", "body": "Hi! My own words."}, "title": "Science fair note"}).json()
    assert edited["draft"]["output"]["body"] == "Hi! My own words." and edited["draft"]["edited_at"]
    assert edited["draft"]["title"] == "Science fair note"
    assert client.put(f"/api/drafts/{draft['id']}", json={"output": {"subject": ""}}).status_code == 400

    # nobody else can see or touch it — not another teacher, not an admin
    for who, pw in ((SAM, PASSWORD), (ADMIN, "admin-pass-123")):
        relogin(client, who, pw)
        assert client.get("/api/tools/email/drafts").json()["drafts"] == []
        assert client.get(f"/api/drafts/{draft['id']}").status_code == 404
        assert client.put(f"/api/drafts/{draft['id']}", json={"title": "x"}).status_code == 404
        assert client.post(f"/api/drafts/{draft['id']}/approve").status_code == 404
        assert client.post(f"/api/drafts/{draft['id']}/retry").status_code == 404
        assert client.delete(f"/api/drafts/{draft['id']}").status_code == 404
    relogin(client, JORDAN)
    assert client.post(f"/api/drafts/{draft['id']}/approve").json()["draft"]["approved_at"]
    assert client.delete(f"/api/drafts/{draft['id']}").json() == {"ok": True}
    assert client.get(f"/api/drafts/{draft['id']}").status_code == 404


def test_email_in_the_familys_language(client, settings, fake):
    login(client, JORDAN)
    sofia = student_id(settings, "Sofia Ramirez")
    d = wait_draft(client, create(client, "email", {"student_id": sofia, "topic": "missing homework",
                                                    "tone": "firm", "language": "Spanish"})["draft"]["id"])
    assert d["input"]["suggested_language"] == "Spanish" and d["output"]["language"] == "Spanish"
    system = fake.prompts[-1][0].content
    assert "whole email in Spanish" in system and "Firm and respectful" in system


@pytest.mark.parametrize("tool,body", [
    ("email", {"topic": "late work", "student_id": None}),
    ("adapt", {"text": READING, "versions": [{"student_id": None}]}),
    ("feedback", {"work": WORK, "rubric_text": RUBRIC, "student_id": None}),
    ("meeting", {"meeting_type": "iep", "student_id": None, "transcript_text": "We met."}),
])
def test_cannot_target_another_teachers_student(client, settings, tool, body):
    login(client, JORDAN)
    daniel = student_id(settings, "Daniel Walker")  # Sam's student
    body = json.loads(json.dumps(body).replace("null", str(daniel)))
    r = client.post(f"/api/tools/{tool}/drafts", json=body)
    assert r.status_code == 404 and r.json()["error"] == "Student not found in your roster."
    missing = json.loads(json.dumps(body).replace(str(daniel), "999999"))
    assert client.post(f"/api/tools/{tool}/drafts", json=missing).status_code == 404
    with connect(settings.db_path) as db:
        assert db.execute("SELECT COUNT(*) FROM drafts").fetchone()[0] == 0


def test_bad_requests(client):
    login(client, JORDAN)
    assert client.post("/api/tools/nope/drafts", json={}).status_code == 404
    assert client.get("/api/tools/nope/drafts").status_code == 404
    assert client.post("/api/tools/email/drafts", json={"topic": "x"}).status_code == 422
    assert client.post("/api/tools/email/drafts", content=b"not json",
                       headers={"content-type": "application/json"}).status_code == 400
    assert client.post("/api/tools/adapt/drafts", json={"text": READING, "versions": [{}]}).status_code == 400
    assert client.post("/api/tools/adapt/drafts", json={"text": READING, "versions": [{"level": "grade_4"}] * 4}
                       ).status_code == 422
    assert client.post("/api/tools/adapt/drafts", json={"text": READING, "versions": [{"level": "grade_99"}]}
                       ).status_code == 422
    assert client.post("/api/tools/feedback/drafts", json={"work": WORK}).status_code == 400  # no rubric
    assert client.post("/api/tools/meeting/drafts", json={"meeting_type": "party"}).status_code == 422
    client.post("/api/auth/logout")
    assert client.post("/api/tools/email/drafts", json={}).status_code == 401
    assert client.get("/api/tools").status_code == 401


def test_tools_meta(client):
    login(client, JORDAN)
    meta = client.get("/api/tools").json()
    assert meta["tools"] == ["meeting", "feedback", "adapt", "email"]
    iep = next(t for t in meta["meeting_types"] if t["key"] == "iep")
    keys = [s["key"] for s in iep["sections"]]
    assert keys[0] == "summary" and keys[-1] == "action_items" and "services_discussed" in keys
    assert meta["audio"]["max_bytes"] == 200 * 1024 * 1024 and ".webm" in meta["audio"]["accept"]
    assert {"key": "same_chunked", "label": "Same level, chunked"} in meta["adapt_levels"]


# -- adapt a reading ------------------------------------------------------------------

def test_adapt_versions_side_by_side(client, settings, fake):
    login(client, JORDAN)
    sofia = student_id(settings, "Sofia Ramirez")  # Grade 5 reader, EL, bilingual glossary
    d = wait_draft(client, create(client, "adapt", {"text": READING, "title": "Volcanoes", "versions": [
        {"level": "grade_3"}, {"student_id": sofia}, {"level": "simpler", "language": "Spanish"}]})["draft"]["id"])
    assert d["status"] == "ready", d
    out = d["output"]
    assert out["original"]["words"] == len(READING.split()) and out["original"]["grade"] > 8
    labels = [v["label"] for v in out["versions"]]
    assert labels == ["Grade 3", "For Sofia R. · Grade 5", "Simpler · Spanish"]
    assert d["student"]["id"] == sofia  # one student among the versions
    for v in out["versions"]:
        assert v["text"] and v["glossary"] and v["readability"]["words"] < out["original"]["words"]
    assert out["versions"][2]["readability"]["grade"] is None  # not English: no estimate
    adapt_calls = [p for p in fake.prompts if p[0].content.startswith("Teacher's Desk — Adapt")]
    prompts = list(dict.fromkeys(p[0].content for p in adapt_calls))  # one per version (retries repeat it)
    # a version that reads far above its target gets one rewrite request
    assert any("reads at about grade" in p[-1].content and "target is grade 3" in p[-1].content
               for p in adapt_calls)
    assert "grade 3 reading level" in prompts[0] and "shorter than the original" in prompts[0]
    assert "for one student" in prompts[1] and "In Spanish" in prompts[1]  # bilingual glossary
    assert "English learner" in prompts[1] and "Sofia" not in prompts[1]
    assert "in Spanish, as a fluent native speaker" in prompts[2]

    # teacher edits are revalidated; readability follows the edit
    out["versions"][0]["text"] = "Volcanoes are holes in the ground."
    saved = client.put(f"/api/drafts/{d['id']}", json={"output": out}).json()["draft"]["output"]
    assert saved["versions"][0]["readability"]["words"] == 6


def test_adapt_retries_once_when_too_long(client, fake):
    login(client, JORDAN)
    long = json.dumps({"title": "t", "text": READING + " " + READING, "glossary": [], "changes": ""})
    short = json.dumps({"title": "t", "text": "Volcanoes let hot rock out of the Earth.", "glossary": [],
                        "changes": "Shortened."})
    fake.replies[:] = [long, short]
    d = wait_draft(client, create(client, "adapt", {"text": READING, "versions": [{"level": "grade_2"}]})["draft"]["id"])
    assert d["output"]["versions"][0]["text"].startswith("Volcanoes let")
    assert "must be shorter" in fake.prompts[-1][-1].content


def test_adapt_upload_file(client):
    login(client, JORDAN)
    r = client.post("/api/tools/adapt/drafts", data={"level": "simpler"},
                    files={"file": ("volcanoes.md", READING.encode(), "text/markdown")})
    assert r.status_code == 200, r.text
    d = wait_draft(client, r.json()["draft"]["id"])
    assert d["status"] == "ready" and d["title"] == "volcanoes"


# -- feedback -------------------------------------------------------------------------

def test_feedback_quotes_are_verbatim_and_cite_rubric_lines(client, settings, fake):
    login(client, JORDAN)
    ava = student_id(settings, "Ava Thompson")
    d = wait_draft(client, create(client, "feedback", {"work": WORK, "rubric_text": RUBRIC, "focus": "evidence",
                                                       "student_id": ava, "title": "My hero"})["draft"]["id"])
    assert d["status"] == "ready", d
    out, lines = d["output"], d["input"]["rubric"]["lines"]
    assert lines[0] == "Narrative writing rubric" and lines[-1] == "Conventions | Spelling and grammar"
    assert len(out["strengths"]) == 2 and len(out["next_steps"]) == 2 and out["dropped"] == 0
    for item in out["strengths"] + out["next_steps"]:
        s, e = item["span"]
        assert WORK[s:e] == item["quote"] and item["quote"] in WORK
        assert item["rubric"] == lines[item["rubric_line"] - 1]
    assert out["focus"] == "evidence"
    system = fake.prompts[-1][0].content
    assert "Never give a score, grade" in system and "focus on: evidence" in system
    assert "Address the student as Ava" in system and "Never mention a plan" in system
    assert "<student_work title=\"My hero\">" in fake.prompts[-1][1].content

    # the teacher is the author: edits are kept, highlights stay truthful
    out["strengths"][0]["comment"] = "I love how you open with your grandmother."
    out["strengths"][1]["quote"] = "a quote the teacher typed"
    saved = client.put(f"/api/drafts/{d['id']}", json={"output": out}).json()["draft"]["output"]
    assert saved["strengths"][0]["comment"].startswith("I love") and saved["strengths"][0]["span"]
    assert saved["strengths"][1]["span"] is None


def _fb(strengths, next_steps) -> str:
    return json.dumps({"strengths": [{"comment": c, "quote": q, "rubric_line": n} for c, q, n in strengths],
                       "next_steps": [{"comment": c, "quote": q, "rubric_line": n} for c, q, n in next_steps]})


def test_feedback_drops_items_whose_quote_isnt_in_the_work(client, fake):
    login(client, JORDAN)
    good1 = ("Clear idea.", "My hero is my grandmother because she never gives up", 2)
    good2 = ("Strong detail.", "she went back to school at fifty and became a nurse", 3)
    curly = ("Nice image.", "“She studied every night at the kitchen   table”.", 3)  # forgiven
    fake_quote = ("Vivid.", "she won the national nursing award in Paris", 3)
    bad_line = ("Ending.", "it is never too late to learn something new", 42)
    graded = ("Great work, 4/4!", "while we did our homework", 2)
    reply = _fb([good1, fake_quote], [curly, bad_line, graded])
    fake.replies[:] = [reply, reply]  # the retry repeats the mistakes
    d = wait_draft(client, create(client, "feedback", {"work": WORK, "rubric_text": RUBRIC})["draft"]["id"])
    assert d["status"] == "ready", d
    out = d["output"]
    assert [i["quote"] for i in out["strengths"]] == [good1[1]]
    assert out["next_steps"][0]["quote"] == "She studied every night at the kitchen table"  # exact text of the work
    assert len(out["next_steps"]) == 1 and out["dropped"] == 3
    repair = fake.prompts[-1][-1].content
    assert "not in the student's work word for word" in repair and "doesn't exist" in repair
    assert "score or rating" in repair
    assert fake.calls.count(("chat", "fake-chat")) == 2
    _ = good2


def test_feedback_with_no_verifiable_quote_is_an_error(client, fake):
    login(client, JORDAN)
    reply = _fb([("x", "words that are not there at all", 1)], [("y", "nor are these words here", 1)])
    fake.replies[:] = [reply, reply]
    d = wait_draft(client, create(client, "feedback", {"work": WORK, "rubric_text": RUBRIC})["draft"]["id"])
    assert d["status"] == "error" and "couldn't quote this work" in d["error"]


def test_json_repair_retry_then_success(client, fake):
    login(client, JORDAN)
    good = _fb([("a", "My hero is my grandmother", 1), ("b", "became a nurse", 2)],
               [("c", "studied every night at the kitchen table", 3), ("d", "never too late to learn", 2)])
    fake.replies[:] = ["Sure! Here is the feedback: strengths are great", f"```json\n{good}\n```"]
    d = wait_draft(client, create(client, "feedback", {"work": WORK, "rubric_text": RUBRIC})["draft"]["id"])
    assert d["status"] == "ready" and len(d["output"]["strengths"]) == 2
    last = fake.prompts[-1]
    assert last[-2].role == "assistant" and last[-2].content.startswith("Sure!")
    assert "isn't valid JSON" in last[-1].content


def test_json_repair_gives_up_after_one_retry(client, fake):
    login(client, JORDAN)
    fake.replies[:] = ["no json here", '{"subject": 5}']
    d = wait_draft(client, create(client, "email", {"student_id": 1, "topic": "field trip"})["draft"]["id"])
    assert d["status"] == "error" and d["error"] == FORMAT_FAILED and d["output"] is None
    # a retry runs the job again
    r = client.post(f"/api/drafts/{d['id']}/retry").json()["draft"]
    assert r["status"] in ("queued", "running", "ready")
    assert wait_draft(client, d["id"])["status"] == "ready"


def test_feedback_batch_runs_per_piece_with_progress(client, fake):
    import docx

    login(client, JORDAN)
    doc = docx.Document()
    doc.add_paragraph("Dogs make better pets than cats because they are loyal. My dog waits for me every day.")
    buf = io.BytesIO()
    doc.save(buf)
    rubric_id = client.post("/api/documents/text", json={
        "title": "Opinion rubric", "text": "# Opinion\n- States a clear opinion\n- Gives reasons with details",
        "visibility": "private"}).json()["id"]
    files = [("files", ("ava-essay.txt", WORK.encode(), "text/plain")),
             ("files", ("liam essay.md", b"Summer is the best season. We swim in the lake and eat peaches.",
                        "text/markdown")),
             ("files", ("noah.docx", buf.getvalue(), "application/octet-stream")),
             ("files", ("virus.exe", b"MZ", "application/octet-stream"))]
    r = client.post("/api/tools/feedback/drafts", data={"rubric_document_id": str(rubric_id), "focus": "reasons"},
                    files=files)
    assert r.status_code == 200, r.text
    res = r.json()
    assert len(res["drafts"]) == 3 and res["batch"] and res["errors"][0]["filename"] == "virus.exe"
    assert [d["title"] for d in res["drafts"]] == ["ava essay", "liam essay", "noah"]
    assert all(d["batch"] == res["batch"] for d in res["drafts"])
    for d in res["drafts"]:
        assert wait_draft(client, d["id"])["status"] == "ready"
    listed = client.get(f"/api/tools/feedback/drafts?batch={res['batch']}").json()
    assert listed["batch"] == {"id": res["batch"], "total": 3, "ready": 3, "error": 0, "active": 0,
                               "done": True, "progress": 1.0}
    assert [d["title"] for d in listed["drafts"]] == ["ava essay", "liam essay", "noah"]
    full = client.get(f"/api/drafts/{res['drafts'][0]['id']}").json()["draft"]
    assert full["input"]["rubric"]["title"] == "Opinion rubric"
    assert full["input"]["rubric"]["lines"] == ["Opinion", "States a clear opinion", "Gives reasons with details"]
    # one model call per piece
    assert sum(1 for s in fake.schemas if s and s["title"] == "FeedbackReply") == 3

    # another teacher can't use this teacher's private rubric (404, as if it didn't exist)
    relogin(client, SAM)
    r = client.post("/api/tools/feedback/drafts", json={"work": WORK, "rubric_document_id": rubric_id})
    assert r.status_code == 404 and r.json()["error"] == "Rubric document not found."
    handbook = next(d["id"] for d in client.get("/api/documents").json()["documents"] if d["title"] == "Handbook")
    assert client.post("/api/tools/feedback/drafts", json={"work": WORK, "rubric_document_id": handbook}
                       ).status_code == 200


def test_generation_slots_are_shared_and_respected(client, fake):
    login(client, JORDAN)
    fake.delay_s = 0.005
    works = [{"title": f"P{i}", "text": WORK} for i in range(6)]
    res = create(client, "feedback", {"works": works, "rubric_text": RUBRIC})
    assert [d["queue_position"] for d in res["drafts"]] == [1, 2, 3, 4, 5, 6]
    # chat still answers while the batch runs, through the same slots
    events = [json.loads(x[5:]) for x in client.post("/api/chat", json={"question": "late work policy"}
                                                       ).text.splitlines() if x.startswith("data:")]
    assert events[-1]["type"] == "done"
    for d in res["drafts"]:
        assert wait_draft(client, d["id"], timeout=20)["status"] == "ready"
    assert 1 <= fake.max_active <= 2  # max_concurrent_generations


# -- meeting notes --------------------------------------------------------------------

def test_meeting_recording_transcribed_notes_and_audio_deleted_on_approve(client, settings, fake):
    login(client, JORDAN)
    ava = student_id(settings, "Ava Thompson")
    d = create(client, "meeting", {"meeting_type": "iep", "student_id": ava, "consent": True})["draft"]
    assert d["status"] == "awaiting_audio" and d["has_audio"] is False and d["title"] == "IEP meeting · Ava Thompson"
    assert d["sections"][0] == {"key": "summary", "title": "Summary", "kind": "text"}
    # nothing to approve or retry yet
    assert client.post(f"/api/drafts/{d['id']}/approve").status_code == 409
    assert client.post(f"/api/drafts/{d['id']}/retry").status_code == 409

    up = client.post(f"/api/meetings/{d['id']}/audio", files={"file": ("rec.webm", wav_bytes(), "audio/webm")})
    assert up.status_code == 200, up.text
    assert up.json()["received"] == len(wav_bytes())
    path = settings.audio_dir / f"{d['id']}.wav"  # format from the bytes, not the name
    assert path.exists()
    done = wait_draft(client, d["id"])
    assert done["status"] == "ready", done
    assert ("transcribe", "whisper") in fake.calls
    assert [s["text"] for s in done["transcript"]] == [s.text for s in fake.transcript]
    assert done["transcript"][3] == {"i": 3, "start": 17.5, "end": 24.0,
                                     "text": "We agreed to add a daily check-in with Ms. Rivera starting Monday."}
    out = done["output"]
    assert out["meeting_type"] == "iep" and out["summary"]
    n = len(done["transcript"])
    for sec in done["sections"][1:]:
        for item in out[sec["key"]]:
            assert item["refs"] and all(0 <= i < n for i in item["refs"])
    assert out["action_items"][0]["refs"] == [3]
    system = fake.prompts[-1][0].content
    assert "Meeting notes (IEP meeting)" in system and "not the official IEP document" in system
    assert "Ava Thompson" in system and "case manager J. Rivera" in system
    assert done["has_audio"] and path.exists()
    assert client.post(f"/api/meetings/{d['id']}/audio", files={"file": ("r.wav", wav_bytes(), "audio/wav")}
                       ).status_code == 409  # already has its recording

    # teacher fixes a misheard word in the transcript, edits notes, approves
    fixed = [{"text": s["text"]} for s in done["transcript"]]
    fixed[0]["text"] = "Thanks for coming. This is Ava's annual IEP meeting."
    assert client.put(f"/api/drafts/{d['id']}", json={"transcript": fixed[:2]}).status_code == 400
    r = client.put(f"/api/drafts/{d['id']}", json={"transcript": fixed}).json()["draft"]
    assert r["transcript"][0]["text"].startswith("Thanks for coming. This is Ava's")
    out["action_items"].append({"owner": "Jordan Lee", "task": "Share notes with the family", "refs": [99]})
    r = client.put(f"/api/drafts/{d['id']}", json={"output": out}).json()["draft"]
    assert r["output"]["action_items"][-1] == {"owner": "Jordan Lee", "task": "Share notes with the family",
                                                "due": None, "refs": []}  # bad ref dropped

    approved = client.post(f"/api/drafts/{d['id']}/approve").json()["draft"]
    assert approved["approved_at"] and approved["has_audio"] is False and approved["audio_bytes"] == 0
    assert not path.exists()
    assert approved["transcript"] and approved["output"]["summary"]  # kept
    # notes can still be regenerated from the kept transcript
    client.post(f"/api/drafts/{d['id']}/retry")
    assert wait_draft(client, d["id"])["status"] == "ready"
    assert fake.calls.count(("transcribe", "whisper")) == 1


def test_meeting_chunked_upload_offsets_formats_and_limits(client, settings, monkeypatch):
    login(client, JORDAN)
    d = create(client, "meeting", {"meeting_type": "parent_conference"})["draft"]
    data = b"\x1a\x45\xdf\xa3" + b"\x42" * 5000  # WebM (EBML) from MediaRecorder
    url = f"/api/meetings/{d['id']}/audio"
    # consent is required for any recording
    r = client.post(url, files={"file": ("a.webm", data, "audio/webm")})
    assert r.status_code == 400 and "agreed to be recorded" in r.json()["error"]
    # raw-body chunks with offsets (consent can come with the upload)
    r = client.post(f"{url}?offset=0&final=false&consent=true", content=data[:2000],
                    headers={"content-type": "audio/webm"})
    assert r.status_code == 200 and r.json()["received"] == 2000
    assert r.json()["draft"]["status"] == "awaiting_audio"
    r = client.post(f"{url}?offset=1500&final=false", content=data[2000:4000], headers={"content-type": "audio/webm"})
    assert r.status_code == 409 and r.json()["received"] == 2000
    r = client.post(url, data={"offset": "2000", "final": "false"}, files={"file": ("c", data[2000:4000])})
    assert r.json()["received"] == 4000
    r = client.post(f"{url}?offset=4000&final=true", content=data[4000:], headers={"content-type": "audio/webm"})
    assert r.status_code == 200 and r.json()["received"] == len(data)
    assert (settings.audio_dir / f"{d['id']}.webm").read_bytes() == data
    assert wait_draft(client, d["id"])["status"] == "ready"

    d2 = create(client, "meeting", {"meeting_type": "other", "consent": True})["draft"]
    url2 = f"/api/meetings/{d2['id']}/audio"
    r = client.post(url2, files={"file": ("notes.mp3", b"MZ\x90\x00 this is not audio", "audio/mpeg")})
    assert r.status_code == 415 and "WebM, Ogg, M4A, MP3 or WAV" in r.json()["error"]
    assert client.post(url2, content=b"", headers={"content-type": "audio/wav"}).status_code == 400
    for head, ext in ((b"OggS" + b"\x00" * 20, ".ogg"), (b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 8, ".m4a"),
                      (b"ID3\x04" + b"\x00" * 20, ".mp3"), (b"\xff\xfb\x90\x00" + b"\x00" * 20, ".mp3")):
        assert audio_mod.sniff(head) == ext
    monkeypatch.setattr(audio_mod, "MAX_AUDIO_BYTES", 3000)
    r = client.post(url2, content=wav_bytes(1.0), headers={"content-type": "audio/wav"})
    assert r.status_code == 413
    assert not list(settings.audio_dir.glob(f"{d2['id']}.*"))
    assert client.get(f"/api/drafts/{d2['id']}").json()["draft"]["has_audio"] is False

    # another teacher can't upload into it
    relogin(client, SAM)
    assert client.post(url2, files={"file": ("a.wav", wav_bytes(), "audio/wav")}).status_code == 404


def test_meeting_create_with_audio_in_one_request_and_delete_removes_it(client, settings, fake):
    login(client, JORDAN)
    fake.transcribe_delay_s = 0.3
    r = client.post("/api/tools/meeting/drafts", data={"meeting_type": "sst", "consent": "true"},
                    files={"audio": ("rec.wav", wav_bytes(), "audio/wav")})
    assert r.status_code == 200, r.text
    d = r.json()["draft"]
    assert d["status"] in ("queued", "running") and d["has_audio"]
    path = settings.audio_dir / f"{d['id']}.wav"
    assert path.exists()
    assert client.delete(f"/api/drafts/{d['id']}").json() == {"ok": True}  # mid-transcription
    assert not path.exists()
    time.sleep(0.4)
    with connect(settings.db_path) as db:
        assert db.execute("SELECT COUNT(*) FROM drafts").fetchone()[0] == 0
    # without consent the recording is refused and no draft is left behind
    r = client.post("/api/tools/meeting/drafts", data={"meeting_type": "sst"},
                    files={"audio": ("rec.wav", wav_bytes(), "audio/wav")})
    assert r.status_code == 400
    assert not list(settings.audio_dir.iterdir())


VTT = """WEBVTT

1
00:00:01.000 --> 00:00:04.500
<v Ms. Rivera>Welcome to the PLC meeting.</v>

2
00:00:04.500 --> 00:00:09.000
We decided to give the common assessment on Thursday.

3
00:00:09.000 --> 00:00:12.000
Mr. Lee will bring student work samples.
"""


def test_meeting_pasted_transcript_needs_no_transcription(client, fake):
    login(client, JORDAN)
    d = create(client, "meeting", {"meeting_type": "plc", "transcript_text": VTT})["draft"]
    assert d["source"] == "paste" and d["status"] in ("queued", "running")
    done = wait_draft(client, d["id"])
    assert done["status"] == "ready"
    assert done["transcript"] == [
        {"i": 0, "start": 1.0, "end": 4.5, "text": "Welcome to the PLC meeting."},
        {"i": 1, "start": 4.5, "end": 9.0, "text": "We decided to give the common assessment on Thursday."},
        {"i": 2, "start": 9.0, "end": 12.0, "text": "Mr. Lee will bring student work samples."}]
    assert ("transcribe", "whisper") not in fake.calls
    assert done["output"]["action_items"][0]["refs"] == [2]
    assert {s["key"] for s in done["sections"]} >= {"topics", "data_reviewed", "decisions", "open_questions"}
    # a transcript file works too
    r = client.post("/api/tools/meeting/drafts", data={"meeting_type": "other"},
                    files={"transcript_file": ("meeting.vtt", VTT.encode(), "text/vtt")})
    assert wait_draft(client, r.json()["draft"]["id"])["status"] == "ready"


def test_long_meeting_is_written_in_parts_and_merged(client, fake):
    login(client, JORDAN)
    lines = [f"[{m:02}:{s:02}] Item {i}: the team will review attendance data for group {i % 7} next week."
             for i, (m, s) in enumerate((i // 6, (i % 6) * 10) for i in range(400))]
    d = wait_draft(client, create(client, "meeting", {"meeting_type": "sst", "transcript_text": "\n".join(lines)}
                                  )["draft"]["id"])
    assert d["status"] == "ready", d
    notes_calls = [s for s in fake.schemas if s and s["title"].startswith("MeetingNotes")]
    assert len(notes_calls) >= 3
    assert any(s and s["title"] == "MeetingSummary" for s in fake.schemas)
    assert "part 2 of" in fake.prompts[-2][0].content or "part 2 of" in " ".join(
        p[0].content for p in fake.prompts)
    n = len(d["transcript"])
    assert n == 400 and d["transcript"][7]["start"] == 70.0 and d["transcript"][7]["end"] == 80.0
    refs = [r for sec in d["sections"][1:] for item in d["output"][sec["key"]] for r in item["refs"]]
    assert refs and max(refs) > 100  # later parts keep their own line numbers


def test_runtime_without_speech_to_text_explains_and_can_retry(client, fake):
    login(client, JORDAN)
    fake.can_transcribe = False
    d = create(client, "meeting", {"meeting_type": "other", "consent": True})["draft"]
    client.post(f"/api/meetings/{d['id']}/audio", files={"file": ("r.wav", wav_bytes(), "audio/wav")})
    failed = wait_draft(client, d["id"])
    assert failed["status"] == "error" and failed["error"] == TRANSCRIBE_UNSUPPORTED
    assert failed["has_audio"]  # kept so it can be retried
    fake.can_transcribe = True
    fake.transcript = [TranscriptSegment(0.0, 3.0, "Short meeting about the field trip.")]
    client.post(f"/api/drafts/{d['id']}/retry")
    ok = wait_draft(client, d["id"])
    assert ok["status"] == "ready" and ok["transcript"][0]["text"] == "Short meeting about the field trip."


def test_edits_wait_for_the_job(client, fake):
    login(client, JORDAN)
    fake.delay_s = 0.05
    d = create(client, "email", {"student_id": 1, "topic": "conference sign-ups"})["draft"]
    r = client.put(f"/api/drafts/{d['id']}", json={"output": {"subject": "a", "body": "b"}})
    assert r.status_code == 409
    assert client.post(f"/api/drafts/{d['id']}/retry").status_code == 409
    assert client.put(f"/api/drafts/{d['id']}", json={"title": "Conferences"}).status_code == 200
    assert wait_draft(client, d["id"])["title"] == "Conferences"


def test_interrupted_jobs_resume_after_restart(settings, fake):
    from app.main import bootstrap

    bootstrap(settings)
    seed(settings)
    with connect(settings.db_path) as db:
        uid = db.execute("SELECT id FROM users WHERE email = ?", (JORDAN,)).fetchone()[0]
        draft_id = db.execute(
            "INSERT INTO drafts(user_id, tool, title, input_json, status, stage, model) "
            "VALUES (?, 'email', 't', ?, 'running', 'writing', 'fake-chat')",
            (uid, json.dumps({"topic": "picture day", "tone": "warm", "language": "English", "teacher": "Jordan Lee",
                              "suggested_language": "English",
                              "student": {"id": 1, "name": "Ava Thompson", "first_name": "Ava", "grade": "7",
                                          "section": "ELA 7"}})),
        ).lastrowid
    settings.audio_dir.mkdir(parents=True, exist_ok=True)
    orphan = settings.audio_dir / "999.webm"
    orphan.write_bytes(b"x")
    with TestClient(create_app(settings, factory=lambda cfg, s: fake)) as c:
        login(c, JORDAN)
        d = wait_draft(c, draft_id)
        assert d["status"] == "ready" and "picture day" in d["output"]["body"]
    assert not orphan.exists()  # recordings no draft refers to are swept


def test_migration_adds_drafts(settings):
    from app.main import bootstrap

    bootstrap(settings)
    with connect(settings.db_path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] >= 3
        cols = {r[1] for r in db.execute("PRAGMA table_info(drafts)")}
    assert {"user_id", "tool", "input_json", "output_json", "status", "progress", "student_id", "audio_path",
            "transcript_json", "approved_at"} <= cols
