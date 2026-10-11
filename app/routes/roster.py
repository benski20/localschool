from __future__ import annotations

import csv
import io
import sqlite3

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse

from .. import deps
from ..services import activity, roster

router = APIRouter(prefix="/api/roster", tags=["roster"])
MAX_CSV = 5 * 1024 * 1024


@router.get("")
def get_roster(user: sqlite3.Row = Depends(deps.current_user), db: sqlite3.Connection = Depends(deps.db, scope="function")):
    sections = roster.sections_for(db, user)
    students = roster.students_for(db, user)
    if students and not activity.recently(db, user["id"], "students_viewed", 60):
        activity.log(db, user, "students_viewed", detail=f"{len(students)} students")
    return {
        "sections": [
            {k: s[k] for k in ("id", "name", "period", "teacher_email", "teacher_name", "student_count")}
            for s in sections
        ],
        "students": [
            {
                "id": s["id"], "name": s["name"], "grade": s["grade"], "section_id": s["section_id"],
                "section_name": s["section_name"], "period": s["period"], "reading_level": s["reading_level"],
                "el_level": s["el_level"], "home_language": s["home_language"],
                "plan_type": s["plan_type"], "iep_review_date": s["iep_review_date"],
                "case_manager": s["case_manager"],
                "accommodations": [a for a in s["accommodations"].split("; ") if a],
            }
            for s in students
        ],
    }


async def _parse(file: UploadFile) -> roster.RosterParse:
    data = await file.read()
    if len(data) > MAX_CSV:
        raise HTTPException(400, "Roster file is larger than 5 MB.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    return roster.parse_roster_csv(text)


@router.post("/preview")
async def preview(file: UploadFile = File(...), _: sqlite3.Row = Depends(deps.admin_user)):
    return (await _parse(file)).summary()


@router.post("/import")
async def import_(
    file: UploadFile = File(...),
    me: sqlite3.Row = Depends(deps.admin_user),
    db: sqlite3.Connection = Depends(deps.db, scope="function"),
):
    parsed = await _parse(file)
    if parsed.errors:
        raise HTTPException(400, " ".join(parsed.errors))
    result = roster.import_roster(db, parsed)
    activity.log(db, me, "roster_imported", detail=", ".join(f"{k}: {v}" for k, v in result.items()
                                                             if isinstance(v, int))[:300])
    return {**result, "warnings": parsed.warnings}


@router.get("/template.csv", response_class=PlainTextResponse)
def template():
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(roster.TEMPLATE_HEADER)
    w.writerow(["Ava Thompson", "S1001", "7", "ELA 7", "3", "teacher@school.org", "Grade 6", "",
                "English", "IEP", "Extended time (1.5x); Read-aloud for tests", "2026-11-04", "J. Rivera"])
    return PlainTextResponse(buf.getvalue(), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="roster-template.csv"'})
