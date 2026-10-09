"""Pure-logic tests: chunking, think filter, FTS query safety, citations, URL locality."""

from __future__ import annotations

from app.llm.openai_compat import ThinkFilter
from app.llm.registry import is_local_url
from app.services.chat import Source, validate_citations
from app.services.ingest import Page, chunk_pages
from app.services.retrieval import fts_query, rrf
from app.services.roster import parse_roster_csv


def test_chunks_keep_headings_and_pages():
    pages = [Page(1, "# Attendance\n\nBe on time.\n\n## Tardies\n\nThree tardies = detention."),
             Page(2, "More about tardies on page two.")]
    chunks = chunk_pages(pages)
    assert [(c.page, c.heading) for c in chunks] == [(1, "Attendance"), (1, "Tardies"), (2, "Tardies")]
    assert chunks[1].text == "Three tardies = detention."


def test_long_sections_split_with_overlap_and_no_duplicates():
    paras = [f"Paragraph {i}. " + "word " * 60 for i in range(20)]
    chunks = chunk_pages([Page(None, "# Big\n\n" + "\n\n".join(paras))])
    assert len(chunks) > 3
    assert all(len(c.text) <= 1400 + 400 for c in chunks)
    joined = " ".join(c.text for c in chunks)
    for i in range(20):
        assert f"Paragraph {i}." in joined
    assert len({c.text for c in chunks}) == len(chunks)


def test_think_filter_handles_split_tags():
    f = ThinkFilter()
    out = "".join(f.feed(p) for p in ["Hel", "lo <thi", "nk>secret plan</th", "ink> world", "<"]) + f.flush()
    assert out == "Hello  world<"


def test_fts_query_is_safe_against_syntax():
    q = fts_query('What\'s the "late work" policy? AND OR (NEAR) -- *')
    assert q == '"late" OR "work" OR "policy" OR "near"'
    assert fts_query("the of and") is None


def test_rrf_rewards_agreement():
    fused = rrf(("keyword", [1, 2, 3]), ("vector", [3, 1, 9]))
    assert [cid for cid, _, _ in fused][:2] == [1, 3]
    assert dict((c, by) for c, _, by in fused)[9] == ("vector",)


def test_citations_drop_invalid_and_collect_used():
    sources = [Source(1, "document", "A", "", "x"), Source(2, "student", "B", "", "y")]
    text, used = validate_citations("Fact one [2]. Fact two [1, 7]. Fake [9].", sources)
    assert text == "Fact one [2]. Fact two [1]. Fake."
    assert [s.n for s in used] == [2, 1]


def test_is_local_url():
    for url in ("http://localhost:11434", "http://127.0.0.1:1", "http://10.0.0.5", "http://192.168.1.20:11434",
                "http://localschool.local", "http://ollama:11434"):
        assert is_local_url(url), url
    for url in ("https://me--ollama.modal.run", "https://abc.trycloudflare.com", "http://8.8.8.8"):
        assert not is_local_url(url), url


def test_roster_parse_aliases_dates_and_errors():
    p = parse_roster_csv(
        "Name,Course,Period,IEP/504,Accommodations,Review Date\n"
        "Ava,ELA 7,1,iep,Extended time | Read-aloud,11/04/2026\n"
        ",ELA 7,1,,,\n"
        "Bo,ELA 7,1,,,soon\n"
    )
    assert [r.student_name for r in p.rows] == ["Ava", "Bo"]
    ava = p.rows[0]
    assert (ava.plan_type, ava.accommodations, ava.iep_review_date) == ("IEP", "Extended time; Read-aloud", "2026-11-04")
    assert len(p.errors) == 1 and len(p.warnings) == 1
    assert parse_roster_csv("foo,bar\n1,2\n").errors
