"""Meeting recordings on disk (DATA_DIR/audio). A recording lives only until the teacher
approves the notes (or deletes the draft); the transcript and notes are what's kept."""

from __future__ import annotations

import logging
import re
import sqlite3
from pathlib import Path

log = logging.getLogger(__name__)

MAX_AUDIO_BYTES = 200 * 1024 * 1024
ACCEPTED = "WebM, Ogg, M4A, MP3 or WAV"
EXTENSIONS = (".webm", ".ogg", ".m4a", ".mp3", ".wav")
SNIFF_BYTES = 12
_NAME = re.compile(r"^\d+\.(webm|ogg|m4a|mp3|wav)$")


def sniff(head: bytes) -> str | None:
    """The file extension for an accepted audio container, from its first bytes."""
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return ".wav"
    if head[:4] == b"OggS":
        return ".ogg"
    if head[:4] == b"\x1a\x45\xdf\xa3":  # EBML: WebM/Matroska (Chrome/Firefox MediaRecorder)
        return ".webm"
    if head[4:8] == b"ftyp":  # ISO-BMFF: m4a / mp4 audio (Safari MediaRecorder, Voice Memos)
        return ".m4a"
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return ".mp3"
    return None


def file_name(draft_id: int, ext: str) -> str:
    return f"{int(draft_id)}{ext}"


def path_of(audio_dir: Path, name: str | None) -> Path | None:
    if not name or not _NAME.match(name):
        return None
    return audio_dir / name


def remove(audio_dir: Path, name: str | None) -> None:
    path = path_of(audio_dir, name)
    if path is not None:
        path.unlink(missing_ok=True)


def sweep(db: sqlite3.Connection, audio_dir: Path) -> int:
    """Delete recordings no draft refers to (e.g. a user was removed with their drafts)."""
    if not audio_dir.is_dir():
        return 0
    keep = {r[0] for r in db.execute("SELECT audio_path FROM drafts WHERE audio_path IS NOT NULL")}
    removed = 0
    for f in audio_dir.iterdir():
        if f.is_file() and _NAME.match(f.name) and f.name not in keep:
            f.unlink(missing_ok=True)
            removed += 1
    if removed:
        log.info("removed %d orphaned recording(s)", removed)
    return removed
