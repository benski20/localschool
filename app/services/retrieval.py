"""Hybrid retrieval: BM25 (FTS5) + vector (sqlite-vec), fused with reciprocal rank fusion.

Keyword search catches exact names, codes and policy numbers; vectors catch paraphrase.
If vectors aren't available (runtime down, index still building) keyword search alone
still answers.
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass

from ..db import vec_table

RRF_K = 60
CANDIDATES = 24

_STOP = set(
    "a an and are as at be by can do does for from has have how i if in is it its me my "
    "of on or our should so than that the their them then there these they this to us was "
    "we what when where which who whom why will with would you your".split()
)
_TERM = re.compile(r"[A-Za-z0-9][A-Za-z0-9\-]*")


@dataclass(frozen=True)
class Hit:
    chunk_id: int
    document_id: int
    title: str
    page: int | None
    heading: str
    text: str
    score: float
    matched_by: tuple[str, ...]


def fts_query(question: str) -> str | None:
    """Build a safe FTS5 query: OR of quoted, de-duplicated content words."""
    terms: list[str] = []
    for t in _TERM.findall(question):
        t = t.strip("-").lower()
        if len(t) < 2 or t in _STOP or t in terms:
            continue
        terms.append(t)
    if not terms:
        return None
    return " OR ".join(f'"{t}"' for t in terms[:24])


def keyword_search(db: sqlite3.Connection, question: str, limit: int = CANDIDATES) -> list[int]:
    q = fts_query(question)
    if not q:
        return []
    rows = db.execute(
        "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? "
        "ORDER BY bm25(chunks_fts, 1.0, 2.0) LIMIT ?",
        (q, limit),
    ).fetchall()
    return [r[0] for r in rows]


def vector_search(
    db: sqlite3.Connection, space_id: int, query_vec: list[float], limit: int = CANDIDATES
) -> list[int]:
    rows = db.execute(
        f"SELECT rowid FROM {vec_table(space_id)} WHERE embedding MATCH ? AND k = ? "
        "ORDER BY distance",
        (json.dumps(query_vec), limit),
    ).fetchall()
    return [r[0] for r in rows]


def rrf(*rankings: tuple[str, list[int]]) -> list[tuple[int, float, tuple[str, ...]]]:
    scores: dict[int, float] = {}
    by: dict[int, list[str]] = {}
    for name, ids in rankings:
        for rank, cid in enumerate(ids):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
            by.setdefault(cid, []).append(name)
    ordered = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    return [(cid, s, tuple(by[cid])) for cid, s in ordered]


def hybrid_search(
    db: sqlite3.Connection,
    question: str,
    *,
    k: int = 6,
    space_id: int | None = None,
    query_vec: list[float] | None = None,
) -> list[Hit]:
    rankings = [("keyword", keyword_search(db, question))]
    if space_id is not None and query_vec:
        rankings.append(("vector", vector_search(db, space_id, query_vec)))
    fused = rrf(*rankings)[:k]
    if not fused:
        return []
    ids = [cid for cid, _, _ in fused]
    rows = {
        r["id"]: r
        for r in db.execute(
            "SELECT c.id, c.document_id, c.page, c.heading, c.text, d.title FROM chunks c "
            f"JOIN documents d ON d.id = c.document_id WHERE c.id IN ({','.join('?' * len(ids))})",
            ids,
        )
    }
    return [
        Hit(cid, r["document_id"], r["title"], r["page"], r["heading"], r["text"], round(score, 5), by)
        for cid, score, by in fused
        if (r := rows.get(cid))
    ]
