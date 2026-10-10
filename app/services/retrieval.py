"""Hybrid retrieval: BM25 (FTS5) + vector (sqlite-vec), fused with reciprocal rank fusion.

Keyword search catches exact names, codes and policy numbers; vectors catch paraphrase.
If vectors aren't available (runtime down, index still building) keyword search alone
still answers.

Every search is scoped to one user: school documents plus that user's own private
documents (chat attachments). A teacher's private file is never retrieved for anyone else.
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass

from ..db import vec_table

RRF_K = 60
CANDIDATES = 24
VEC_MAX_K = 4096  # sqlite-vec's KNN limit

# SQL predicate over `documents d`: what the user (one bound parameter) may see and cite.
VISIBLE = "(d.visibility = 'school' OR d.owner_id = ?)"

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


def visible_param(user_id: int | None) -> int:
    """Bind value for VISIBLE. None = no user: school documents only."""
    return -1 if user_id is None else int(user_id)


def keyword_search(
    db: sqlite3.Connection,
    question: str,
    *,
    user_id: int | None,
    doc_ids: list[int] | None = None,
    limit: int = CANDIDATES,
) -> list[int]:
    """BM25 over the chunks `user_id` may see; `doc_ids` narrows it to those documents."""
    q = fts_query(question)
    if not q:
        return []
    where, params = "", [q, visible_param(user_id)]
    if doc_ids is not None:
        if not doc_ids:
            return []
        where = f" AND c.document_id IN ({','.join('?' * len(doc_ids))})"
        params += [int(i) for i in doc_ids]
    rows = db.execute(
        "SELECT chunks_fts.rowid FROM chunks_fts "
        "JOIN chunks c ON c.id = chunks_fts.rowid JOIN documents d ON d.id = c.document_id "
        f"WHERE chunks_fts MATCH ? AND {VISIBLE}{where} "
        "ORDER BY bm25(chunks_fts, 1.0, 2.0) LIMIT ?",
        (*params, limit),
    ).fetchall()
    return [r[0] for r in rows]


def vector_search(
    db: sqlite3.Connection,
    space_id: int,
    query_vec: list[float],
    *,
    user_id: int | None,
    limit: int = CANDIDATES,
) -> list[int]:
    # vec0 can't filter by a join during KNN, so over-fetch by the number of chunks this
    # user can't see, then filter: the top `limit` visible chunks are always in the result.
    uid = visible_param(user_id)
    hidden = db.execute(
        "SELECT COUNT(*) FROM chunks c JOIN documents d ON d.id = c.document_id "
        "WHERE d.visibility = 'private' AND (d.owner_id IS NULL OR d.owner_id != ?)",
        (uid,),
    ).fetchone()[0]
    rows = db.execute(
        f"SELECT rowid FROM {vec_table(space_id)} WHERE embedding MATCH ? AND k = ? "
        "ORDER BY distance",
        (json.dumps(query_vec), min(limit + hidden, VEC_MAX_K)),
    ).fetchall()
    ids = [r[0] for r in rows]
    if not ids:
        return []
    allowed = {
        r[0]
        for r in db.execute(
            "SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id "
            f"WHERE c.id IN ({','.join('?' * len(ids))}) AND {VISIBLE}",
            (*ids, uid),
        )
    }
    return [i for i in ids if i in allowed][:limit]


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
    user_id: int | None,
    k: int = 6,
    space_id: int | None = None,
    query_vec: list[float] | None = None,
) -> list[Hit]:
    rankings = [("keyword", keyword_search(db, question, user_id=user_id))]
    if space_id is not None and query_vec:
        rankings.append(("vector", vector_search(db, space_id, query_vec, user_id=user_id)))
    return fetch_hits(db, rrf(*rankings)[:k], user_id=user_id)


def fetch_hits(
    db: sqlite3.Connection,
    ranked: list[tuple[int, float, tuple[str, ...]]],
    *,
    user_id: int | None,
) -> list[Hit]:
    """Chunk rows for ranked ids, in order. Re-checks visibility (belt and braces)."""
    ids = [cid for cid, _, _ in ranked]
    if not ids:
        return []
    rows = {
        r["id"]: r
        for r in db.execute(
            "SELECT c.id, c.document_id, c.page, c.heading, c.text, d.title FROM chunks c "
            f"JOIN documents d ON d.id = c.document_id WHERE c.id IN ({','.join('?' * len(ids))}) "
            f"AND {VISIBLE}",
            (*ids, visible_param(user_id)),
        )
    }
    return [
        Hit(cid, r["document_id"], r["title"], r["page"], r["heading"], r["text"], round(score, 5), by)
        for cid, score, by in ranked
        if (r := rows.get(cid))
    ]
