"""Meetings with the teacher's own notepad, the Mac app's call audio ("You" / "Others"),
items verified as the teacher's ("mine"), and questions about a meeting."""

from __future__ import annotations

import json

from app.db import MIGRATIONS, _open, connect
from app.main import bootstrap
from app.services.tools import audio as audio_mod
from app.services.tools import meeting

from .conftest import login
from .test_tools import JORDAN, SAM, create, relogin, student_id, wait_draft, wav_bytes

NOTES = "Ava's reading fluency improved since spring\nCall the family about homework"


def _meeting(client, settings, **extra) -> dict:
    body = {"meeting_type": "iep", "student_id": student_id(settings, "Ava Thompson"), "consent": True, **extra}
    return create(client, "meeting", body)["draft"]


def _upload(client, draft_id: int, track: str | None = None, **params):
    q = {**({"track": track} if track else {}), **params}
    return client.post(f"/api/meetings/{draft_id}/audio", params=q, content=wav_bytes(),
                       headers={"content-type": "audio/wav"})


def test_notepad_saved_owner_only_and_never_reruns(client, settings, fake):
    login(client, JORDAN)
    d = _meeting(client, settings)
    url = f"/api/meetings/{d['id']}/notepad"
    assert client.put(url, json={"text": NOTES}).json() == {"ok": True}
    got = client.get(f"/api/drafts/{d['id']}").json()["draft"]
    assert got["input"]["my_notes"] == NOTES and got["status"] == "awaiting_audio"
    assert client.put(url, json={"text": "x" * 20_001}).status_code == 422
    assert client.put("/api/meetings/999999/notepad", json={"text": "hi"}).status_code == 404

    # consent arriving with the upload doesn't overwrite the notepad (json_set, not a rewrite)
    d2 = _meeting(client, settings, consent=False)
    client.put(f"/api/meetings/{d2['id']}/notepad", json={"text": "kept"})
    assert _upload(client, d2["id"], consent="true").status_code == 200
    done = wait_draft(client, d2["id"])
    assert done["input"]["my_notes"] == "kept" and done["input"]["consent"] is True

    # a finished draft: saving the notepad changes nothing else
    chats = len(fake.prompts)
    assert client.put(f"/api/meetings/{d2['id']}/notepad", json={"text": "changed later"}).status_code == 200
    again = client.get(f"/api/drafts/{d2['id']}").json()["draft"]
    assert again["status"] == "ready" and len(fake.prompts) == chats
    assert again["output"]["my_notes"] == "kept"  # notes keep the notepad they were written from

    relogin(client, SAM)
    assert client.put(url, json={"text": "mine now"}).status_code == 404
    assert client.post(f"/api/meetings/{d['id']}/ask", json={"question": "Anything?"}).status_code == 404


def test_call_track_waits_for_the_mic_then_both_are_transcribed(client, settings, fake):
    login(client, JORDAN)
    meta = client.get("/api/tools").json()
    assert meta["audio"]["tracks"] == ["mic", "call"]
    d = _meeting(client, settings)
    assert _upload(client, d["id"], track="speakers").status_code == 400

    r = _upload(client, d["id"], track="call")
    assert r.status_code == 200, r.text
    view = r.json()["draft"]
    assert view["status"] == "awaiting_audio" and view["has_call_audio"] and not view["has_audio"]
    call_file = settings.audio_dir / f"{d['id']}.call.wav"
    assert call_file.exists()
    assert ("transcribe", "whisper") not in fake.calls  # the call track never queues anything

    # the form field works too, and restarts the call track (offset 0)
    r = client.post(f"/api/meetings/{d['id']}/audio", data={"track": "call"},
                    files={"file": ("call.wav", wav_bytes(), "audio/wav")})
    assert r.status_code == 200 and r.json()["draft"]["status"] == "awaiting_audio"

    assert _upload(client, d["id"]).status_code == 200  # mic, final → queued
    done = wait_draft(client, d["id"])
    assert done["status"] == "ready", done
    assert fake.calls.count(("transcribe", "whisper")) == 2
    starts = [s["start"] for s in done["transcript"]]
    assert starts == sorted(starts)
    speakers = [s["speaker"] for s in done["transcript"]]
    assert speakers.count("Others") == len(fake.call_transcript)
    assert speakers.count("You") == len(fake.transcript)
    others = next(s for s in done["transcript"] if s["speaker"] == "Others")
    assert others["text"] == fake.call_transcript[0].text
    system, user = fake.prompts[-1][0].content, fake.prompts[-1][1].content
    assert '"You" is the teacher' in system
    assert f"[{others['i']}] (00:12) Others: {others['text']}" in user
    assert "(00:00) You: Thanks for coming" in user


def test_mic_only_meeting_has_no_speakers(client, settings, fake):
    login(client, JORDAN)
    d = _meeting(client, settings)
    _upload(client, d["id"])
    done = wait_draft(client, d["id"])
    assert done["has_call_audio"] is False
    assert all("speaker" not in s for s in done["transcript"])
    assert "no speaker labels" in fake.prompts[-1][0].content
    out = done["output"]
    assert out["my_notes"] == ""
    assert all(not i["mine"] for k in out if isinstance(out[k], list) for i in out[k])


def test_mine_is_verified_against_the_notepad(client, settings, fake):
    login(client, JORDAN)
    d = _meeting(client, settings)
    client.put(f"/api/meetings/{d['id']}/notepad", json={"text": NOTES})
    fake.replies.append(json.dumps({
        "summary": "IEP meeting for Ava.",
        "present_levels": [{"text": "Ava's reading fluency has improved since the spring.", "refs": [1], "mine": True}],
        "decisions": [{"text": "Add a daily check-in with Ms. Rivera starting Monday.", "refs": [3], "mine": True}],
        "family_input": [{"text": "Homework time has been stressful.", "refs": [2], "mine": False}],
        "action_items": [
            {"owner": "Teacher", "task": "Call the family about homework.", "due": None, "refs": [2], "mine": True},
            {"owner": "Ms. Rivera", "task": "Send a progress update.", "due": "Friday", "refs": [5], "mine": True},
        ],
    }))
    _upload(client, d["id"])
    done = wait_draft(client, d["id"])
    out = done["output"]
    assert out["my_notes"] == NOTES
    assert out["present_levels"][0]["mine"] is True    # most of its words are in the notepad
    assert out["decisions"][0]["mine"] is False        # claimed, but not in the notepad
    assert out["family_input"][0]["mine"] is False     # not claimed
    assert [a["mine"] for a in out["action_items"]] == [True, False]
    assert "<my_notes>\n" + NOTES in fake.prompts[-1][1].content
    assert "the teacher's own notes" in fake.prompts[-1][0].content

    # a teacher edit can't mark an item as theirs either
    out["decisions"][0]["mine"] = True
    edited = client.put(f"/api/drafts/{d['id']}", json={"output": out}).json()["draft"]["output"]
    assert edited["decisions"][0]["mine"] is False and edited["present_levels"][0]["mine"] is True

    # the offline fake leads with the notepad: its first item is the teacher's own line
    client.put(f"/api/meetings/{d['id']}/notepad", json={"text": "Bus pass renewal is due\nMore notes"})
    client.post(f"/api/drafts/{d['id']}/retry")
    redo = wait_draft(client, d["id"])["output"]
    first = redo["present_levels"][0]
    assert first["text"] == "Bus pass renewal is due" and first["mine"] is True and first["refs"]
    assert redo["decisions"][0]["mine"] is False and redo["my_notes"].startswith("Bus pass")


def test_shares_wording():
    words = meeting.content_words(NOTES)
    assert {"ava", "reading", "fluency", "spring", "family", "homework"} <= words
    assert "the" not in words and "about" not in words
    assert meeting.shares_wording("Reading fluency improved for Ava", words)
    assert not meeting.shares_wording("Ms. Rivera will check in daily", words)
    assert not meeting.shares_wording("the and of", words)  # no content words
    assert not meeting.shares_wording("Reading fluency improved", set())


def test_ask_about_a_meeting(client, settings, fake):
    login(client, JORDAN)
    d = _meeting(client, settings)
    url = f"/api/meetings/{d['id']}/ask"
    assert client.post(url, json={"question": "What did we decide?"}).status_code == 409  # no transcript yet
    _upload(client, d["id"], track="call")
    _upload(client, d["id"])
    done = wait_draft(client, d["id"])
    n = len(done["transcript"])

    r = client.post(url, json={"question": "How long does homework take?"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"answer", "refs"} and body["refs"] and all(0 <= i < n for i in body["refs"])
    assert "homework" in done["transcript"][body["refs"][0]]["text"].lower()
    assert "<question>\nHow long does homework take?\n</question>" in fake.prompts[-1][1].content
    assert fake.schemas[-1]["title"] == "MeetingAnswer"

    r = client.post(url, json={"question": "What about the bus schedule?"}).json()
    assert r == {"answer": meeting.NOT_HEARD, "refs": []}

    fake.replies.append(json.dumps({"answer": "Reading support stays.", "refs": [4, 999, -1, 4]}))
    assert client.post(url, json={"question": "Services?"}).json() == {"answer": "Reading support stays.",
                                                                       "refs": [4]}
    assert client.post(url, json={"question": "   "}).status_code == 422
    assert client.post(url, json={"question": "x" * 501}).status_code == 422

    with connect(settings.db_path) as db:
        rows = db.execute("SELECT subject, detail FROM activity WHERE action = 'meeting_asked'").fetchall()
        everything = " ".join(" ".join(r) for r in db.execute("SELECT who, subject, detail FROM activity"))
    assert len(rows) == 3 and rows[0]["subject"] == "Ava Thompson" and rows[0]["detail"] == "IEP meeting"
    assert "homework" not in everything.lower() and "bus" not in everything.lower()


def test_long_transcripts_ask_from_the_relevant_part():
    segs = [{"start": float(i), "end": float(i + 1), "text": f"Line {i}: we talked about lunch and the weather."}
            for i in range(600)]
    segs[420]["text"] = "Permission slips for the field trip are due Thursday."
    lines = meeting.relevant_lines(segs, "When are the field trip permission slips due?")
    assert sum(len(x) + 1 for x in lines) <= meeting.ASK_CHARS
    assert any(x.startswith("[420] ") for x in lines) and "…" in lines
    assert len(meeting.relevant_lines(segs[:5], "anything")) == 5  # short: everything


def test_approve_and_delete_remove_both_tracks(client, settings):
    login(client, JORDAN)
    d = _meeting(client, settings)
    _upload(client, d["id"], track="call")
    _upload(client, d["id"])
    mic, call = settings.audio_dir / f"{d['id']}.wav", settings.audio_dir / f"{d['id']}.call.wav"
    assert wait_draft(client, d["id"])["status"] == "ready" and mic.exists() and call.exists()
    approved = client.post(f"/api/drafts/{d['id']}/approve").json()["draft"]
    assert not mic.exists() and not call.exists()
    assert approved["has_audio"] is False and approved["has_call_audio"] is False
    with connect(settings.db_path) as db:
        row = db.execute("SELECT call_audio_path, call_audio_bytes FROM drafts WHERE id = ?", (d["id"],)).fetchone()
    assert row["call_audio_path"] is None and row["call_audio_bytes"] == 0

    d2 = _meeting(client, settings)
    _upload(client, d2["id"], track="call")
    call2 = settings.audio_dir / f"{d2['id']}.call.wav"
    assert call2.exists()
    assert client.delete(f"/api/drafts/{d2['id']}").json() == {"ok": True}
    assert not call2.exists()


def test_sweep_keeps_call_tracks_drafts_refer_to(client, settings):
    login(client, JORDAN)
    d = _meeting(client, settings)
    _upload(client, d["id"], track="call")
    kept = settings.audio_dir / f"{d['id']}.call.wav"
    orphans = [settings.audio_dir / "999.call.webm", settings.audio_dir / "999.webm"]
    for f in orphans:
        f.write_bytes(b"x")
    other = settings.audio_dir / "notes.txt"  # not a recording name: left alone
    other.write_bytes(b"x")
    with connect(settings.db_path) as db:
        assert audio_mod.sweep(db, settings.audio_dir) == 2
    assert kept.exists() and other.exists() and not any(f.exists() for f in orphans)
    assert audio_mod.file_name(7, ".m4a", "call") == "7.call.m4a" and audio_mod.file_name(7, ".m4a") == "7.m4a"
    assert audio_mod.path_of(settings.audio_dir, "7.call.m4a") is not None
    assert audio_mod.path_of(settings.audio_dir, "../7.call.m4a") is None


def test_migration_7_on_an_existing_v6_database(settings):
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = _open(settings.db_path)
    try:
        for i, script in enumerate(MIGRATIONS[:6], start=1):
            conn.executescript(f"BEGIN; {script}; PRAGMA user_version = {i}; COMMIT;")
        uid = conn.execute("INSERT INTO users(email, name, role, password_hash) "
                           "VALUES ('t@x.test', 'T', 'teacher', 'x')").lastrowid
        conn.execute("INSERT INTO drafts(user_id, tool, title, audio_path, audio_bytes) "
                     "VALUES (?, 'meeting', 'Old meeting', '1.webm', 10)", (uid,))
        conn.commit()
    finally:
        conn.close()
    bootstrap(settings)
    bootstrap(settings)  # idempotent
    with connect(settings.db_path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS) >= 7
        cols = {r[1] for r in db.execute("PRAGMA table_info(drafts)")}
        row = db.execute("SELECT * FROM drafts WHERE title = 'Old meeting'").fetchone()
    assert {"call_audio_path", "call_audio_bytes"} <= cols
    assert row["audio_path"] == "1.webm" and row["call_audio_path"] is None and row["call_audio_bytes"] == 0
