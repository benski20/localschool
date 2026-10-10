"""Roster import (CSV) and role-scoped access.

Scoping rule (same as the SIS): a teacher sees only students in sections they teach;
an admin sees everyone. Enforced here, in SQL — never left to the prompt.
"""

from __future__ import annotations

import csv
import io
import re
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import date, datetime

COLUMNS = {
    # canonical name -> accepted header aliases (case/space-insensitive)
    "student_name": ["student_name", "student", "name", "full_name"],
    "student_id": ["student_id", "id", "sis_id"],
    "grade": ["grade", "grade_level"],
    "section": ["section", "course", "class", "section_name"],
    "period": ["period", "block"],
    "teacher_email": ["teacher_email", "teacher"],
    "reading_level": ["reading_level", "lexile"],
    "el_level": ["el_level", "ell_level", "english_learner_level", "elp_level"],
    "home_language": ["home_language", "language"],
    "plan_type": ["plan_type", "plan", "iep_504"],
    "accommodations": ["accommodations", "accommodation"],
    "iep_review_date": ["iep_review_date", "plan_review_date", "review_date", "annual_review"],
    "case_manager": ["case_manager"],
}
REQUIRED = ("student_name", "section")
TEMPLATE_HEADER = list(COLUMNS)


@dataclass
class RosterRow:
    student_name: str
    section: str
    student_id: str = ""
    grade: str = ""
    period: str = ""
    teacher_email: str = ""
    reading_level: str = ""
    el_level: str = ""
    home_language: str = ""
    plan_type: str = ""
    accommodations: str = ""
    iep_review_date: str = ""
    case_manager: str = ""


@dataclass
class RosterParse:
    rows: list[RosterRow] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        sections = sorted({(r.section, r.period) for r in self.rows})
        return {
            "students": len(self.rows),
            "sections": [{"name": s, "period": p} for s, p in sections],
            "errors": self.errors,
            "warnings": self.warnings,
            "preview": [asdict(r) for r in self.rows[:8]],
        }


def _norm(h: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", h.strip().lower()).strip("_")


def parse_roster_csv(text: str) -> RosterParse:
    out = RosterParse()
    text = text.lstrip("﻿")
    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        out.errors.append("The file is empty.")
        return out
    index: dict[str, int] = {}
    for i, h in enumerate(header):
        n = _norm(h)
        for canon, aliases in COLUMNS.items():
            if n in aliases and canon not in index:
                index[canon] = i
    missing = [c for c in REQUIRED if c not in index]
    if missing:
        out.errors.append(f"Missing required column(s): {', '.join(missing)}.")
        return out

    for line_no, raw in enumerate(reader, start=2):
        if not any(c.strip() for c in raw):
            continue
        vals = {k: (raw[i].strip() if i < len(raw) else "") for k, i in index.items()}
        if not vals.get("student_name") or not vals.get("section"):
            out.errors.append(f"Row {line_no}: student name and section are required.")
            continue
        d = vals.get("iep_review_date", "")
        if d:
            try:
                vals["iep_review_date"] = _parse_date(d).isoformat()
            except ValueError:
                out.warnings.append(f"Row {line_no}: couldn't read date '{d}', left blank.")
                vals["iep_review_date"] = ""
        pt = vals.get("plan_type", "").upper().replace(" ", "")
        vals["plan_type"] = {"IEP": "IEP", "504": "504", "504PLAN": "504"}.get(pt, vals.get("plan_type", ""))
        vals["accommodations"] = "; ".join(
            a.strip() for a in re.split(r"[;|]", vals.get("accommodations", "")) if a.strip()
        )
        out.rows.append(RosterRow(**vals))
    if not out.rows and not out.errors:
        out.errors.append("No student rows found.")
    return out


def _parse_date(s: str) -> date:
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(s)


def import_roster(db: sqlite3.Connection, parsed: RosterParse) -> dict:
    """Replace the roster with `parsed`. Returns counts and unmatched teacher emails."""
    if parsed.errors:
        raise ValueError("; ".join(parsed.errors))
    teachers = {r["email"].lower(): r["id"] for r in db.execute("SELECT id, email FROM users")}
    db.execute("DELETE FROM students")
    db.execute("DELETE FROM sections")
    section_ids: dict[tuple[str, str], int] = {}
    unmatched: set[str] = set()
    for r in parsed.rows:
        key = (r.section, r.period)
        if key not in section_ids:
            tid = teachers.get(r.teacher_email.lower()) if r.teacher_email else None
            if r.teacher_email and tid is None:
                unmatched.add(r.teacher_email)
            section_ids[key] = int(db.execute(
                "INSERT INTO sections(name, period, teacher_email, teacher_id) VALUES (?, ?, ?, ?)",
                (r.section, r.period, r.teacher_email, tid),
            ).lastrowid)
        db.execute(
            "INSERT INTO students(external_id, name, grade, section_id, reading_level, el_level, "
            "home_language, accommodations, plan_type, iep_review_date, case_manager) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (r.student_id, r.student_name, r.grade, section_ids[key], r.reading_level, r.el_level,
             r.home_language, r.accommodations, r.plan_type, r.iep_review_date, r.case_manager),
        )
    return {"students": len(parsed.rows), "sections": len(section_ids), "unmatched_teachers": sorted(unmatched)}


def link_sections(db: sqlite3.Connection, email: str, user_id: int) -> int:
    """When a teacher account is created after the roster import, link their sections."""
    return db.execute(
        "UPDATE sections SET teacher_id = ? WHERE teacher_email = ? AND teacher_id IS NULL",
        (user_id, email),
    ).rowcount


def students_for(db: sqlite3.Connection, user: sqlite3.Row) -> list[sqlite3.Row]:
    sql = (
        "SELECT st.*, se.name AS section_name, se.period AS period, u.name AS teacher_name "
        "FROM students st JOIN sections se ON se.id = st.section_id "
        "LEFT JOIN users u ON u.id = se.teacher_id "
    )
    if user["role"] == "admin":
        return db.execute(sql + "ORDER BY se.period, se.name, st.name").fetchall()
    return db.execute(
        sql + "WHERE se.teacher_id = ? ORDER BY se.period, se.name, st.name", (user["id"],)
    ).fetchall()


def sections_for(db: sqlite3.Connection, user: sqlite3.Row) -> list[sqlite3.Row]:
    sql = (
        "SELECT se.*, u.name AS teacher_name, "
        "(SELECT COUNT(*) FROM students st WHERE st.section_id = se.id) AS student_count "
        "FROM sections se LEFT JOIN users u ON u.id = se.teacher_id "
    )
    if user["role"] == "admin":
        return db.execute(sql + "ORDER BY se.period, se.name").fetchall()
    return db.execute(sql + "WHERE se.teacher_id = ? ORDER BY se.period, se.name", (user["id"],)).fetchall()


def student_card(s: sqlite3.Row) -> str:
    """Compact, model-readable description of one student (one citable source)."""
    parts = [f"Section: {s['section_name']}" + (f", period {s['period']}" if s["period"] else "")]
    if s["grade"]:
        parts.append(f"Grade: {s['grade']}")
    if s["plan_type"]:
        parts.append(f"Plan: {s['plan_type']}")
    parts.append(f"Accommodations: {s['accommodations'] or 'none listed'}")
    if s["iep_review_date"]:
        parts.append(f"Plan review date: {s['iep_review_date']}")
    if s["reading_level"]:
        parts.append(f"Reading level: {s['reading_level']}")
    if s["el_level"]:
        parts.append(f"English learner level: {s['el_level']}")
    if s["home_language"]:
        parts.append(f"Home language: {s['home_language']}")
    if s["case_manager"]:
        parts.append(f"Case manager: {s['case_manager']}")
    return "\n".join(parts)
