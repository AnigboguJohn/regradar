"""Unit tests for the pure (no DB / no network) parts of the AI service."""
from datetime import date

from app.chunking import chunk_pages
from app.fusion import diversify, rrf
from app.prompts import (build_answer_messages, citation_payload, extractive_answer, format_sources, parse_findings,
                         retrieval_query, small_talk_reply, used_citations)
from app.sources.cbn import parse_listing

CIRCULAR = """CENTRAL BANK OF NIGERIA
Circular to All Deposit Money Banks

1. Introduction
The Central Bank of Nigeria hereby reviews the tiered Know Your Customer requirements.

2. Transaction Limits
Tier 1 accounts shall have a maximum single deposit of N50,000 and a maximum cumulative balance of N300,000.
Tier 2 accounts shall have a maximum single deposit of N100,000.

3. Effective Date
This circular takes effect from 1st January 2027. Banks shall comply by 31st March 2027.
"""


def test_chunking_keeps_headings_and_pages():
    chunks = chunk_pages([CIRCULAR, "4. Sanctions\nDefaulting institutions shall be sanctioned in line with extant regulations."])
    headings = [c.heading for c in chunks]
    assert "2. Transaction Limits" in headings
    limits = next(c for c in chunks if c.heading == "2. Transaction Limits")
    assert "N300,000" in limits.content and limits.page == 1
    sanctions = next(c for c in chunks if c.heading == "4. Sanctions")
    assert sanctions.page == 2
    assert [c.ordinal for c in chunks] == list(range(len(chunks)))


def test_chunking_splits_long_text_with_size_limit():
    long_para = " ".join(f"Sentence number {i} about customer due diligence obligations." for i in range(400))
    chunks = chunk_pages([long_para], max_chars=1000, overlap_chars=100)
    assert len(chunks) > 5
    assert all(len(c.content) <= 1000 + 120 for c in chunks)


def test_chunking_handles_text_without_punctuation():
    chunks = chunk_pages(["x" * 5000], max_chars=1000)
    assert sum(len(c.content) for c in chunks) >= 5000


def test_cbn_parse_listing():
    raw = [
        {"id": 11, "refNo": "FMD/DIR/PUB/CIR/001/031 ", "title": "Review of  Discount Window",
         "link": "/Out/2026/FMD/Review of Discount Window Circular.pdf", "documentDate": "12/08/2026",
         "description": "desc"},
        {"id": 10, "refNo": "", "title": "Older", "link": "/Out/2025/old.pdf", "documentDate": "03/07/2025"},
        {"id": 11, "title": "dup", "link": "/x.pdf"},
        {"id": 12, "title": "", "link": "/y.pdf"},
        "junk",
    ]
    items = parse_listing(raw)
    assert [i.external_id for i in items] == ["11", "10"]
    first = items[0]
    assert first.title == "Review of Discount Window"
    assert first.ref_no == "FMD/DIR/PUB/CIR/001/031"
    assert first.published_at == date(2026, 8, 12)
    assert first.url == "https://www.cbn.gov.ng/Out/2026/FMD/Review%20of%20Discount%20Window%20Circular.pdf"
    assert items[1].ref_no is None


def test_rrf_prefers_items_in_both_lists():
    fused = rrf([[1, 2, 3], [3, 4, 1]], limit=4)
    ids = [i for i, _ in fused]
    assert ids[:2] == [1, 3]
    assert set(ids) == {1, 2, 3, 4}


def test_diversify_caps_per_document():
    rows = [{"document_id": "a"}] * 5 + [{"document_id": "b"}]
    assert len(diversify(rows, per_document=2)) == 3


ROWS = [
    {"chunk_id": 7, "document_id": "d1", "title": "KYC Circular", "regulator": "CBN", "ref_no": "BSD/1",
     "published_at": date(2026, 9, 1), "page": 2, "heading": "2. Limits", "content": "Tier 1 max N300,000.",
     "url": "https://x/1.pdf", "kind": "regulation"},
    {"chunk_id": 9, "document_id": "d2", "title": "Our KYC Policy", "regulator": None, "ref_no": None,
     "published_at": None, "page": 1, "heading": None, "content": "We allow N500,000 for tier 1.",
     "url": None, "kind": "policy"},
]


def test_sources_and_citations():
    text = format_sources(ROWS)
    assert text.startswith("[1] KYC Circular (CBN | BSD/1 | 2026-09-01 | p.2)")
    assert "[2] Our KYC Policy (Internal policy | p.1)" in text
    answer = "Tier 1 is capped at N300,000 [1]. Your policy allows more [2][1]. Ignore [9]."
    nums = used_citations(answer, len(ROWS))
    assert nums == [1, 2]
    payload = citation_payload(ROWS, nums)
    assert payload[0]["chunk_id"] == 7 and payload[0]["published_at"] == "2026-09-01"


def test_extractive_answer_cites_sources():
    out = extractive_answer("tier 1 limit", ROWS)
    assert "[1]" in out and "[2]" in out and "not legal advice" in out
    assert "couldn't find" in extractive_answer("x", [])


def test_parse_findings_is_robust():
    text = """Here you go:
```json
{"findings": [
 {"policy_excerpt_id": 9, "severity": "HIGH", "summary": "Policy allows N500,000, above the N300,000 cap.",
  "recommendation": "Lower to N300,000.", "regulation_quote": "maximum cumulative balance of N300,000"},
 {"policy_excerpt_id": 999, "severity": "high", "summary": "hallucinated id"},
 {"policy_excerpt_id": 9, "severity": "critical", "summary": "bad severity"}
]}
```"""
    out = parse_findings(text, {9})
    assert len(out) == 1 and out[0]["severity"] == "high" and out[0]["policy_chunk_id"] == 9
    assert parse_findings("no json here", {9}) == []
    assert parse_findings("{broken", {9}) == []


def test_chunking_keeps_short_sections_and_no_residue_chunks():
    chunks = chunk_pages([CIRCULAR])
    effective = next(c for c in chunks if c.heading == "3. Effective Date")
    assert "31st March 2027" in effective.content
    long_para = " ".join(f"Clause {i} requires enhanced due diligence." for i in range(100))
    chunks = chunk_pages([long_para + "\n\n5. Next Section\nShort rule."], max_chars=500, overlap_chars=100)
    bodies = [c.content for c in chunks]
    assert len(bodies) == len(set(bodies))
    assert chunks[-1].heading == "5. Next Section" and chunks[-1].content == "Short rule."


def test_wrapped_body_lines_are_not_headings():
    page = ("2. Account Tiers\nTier 1 savings accounts may receive single deposits of up to N100,000 and hold a maximum\n"
            "cumulative balance of N500,000. A BVN is not required for Tier 1.\nSECTION 3 SANCTIONS\nPenalties apply.")
    chunks = chunk_pages([page])
    tiers = next(c for c in chunks if c.heading == "2. Account Tiers")
    assert tiers.content.startswith("Tier 1 savings accounts") and "N500,000" in tiers.content
    assert any(c.heading == "SECTION 3 SANCTIONS" for c in chunks)


def test_llm_provider_presets(monkeypatch):
    from app.config import Settings
    for k in ("ANTHROPIC_API_KEY", "LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL", "ANSWER_MODEL"):
        monkeypatch.delenv(k, raising=False)
    assert Settings().llm_enabled is False                       # nothing set: free extractive mode
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    assert Settings().llm_enabled is False                       # groq needs a key
    monkeypatch.setenv("LLM_API_KEY", "k")
    s = Settings()
    assert s.llm_enabled and s.llm_base_url == "https://api.groq.com/openai/v1"
    assert s.answer_model == "llama-3.3-70b-versatile" and s.compact_prompts
    monkeypatch.setenv("LLM_PROVIDER", "ollama"); monkeypatch.delenv("LLM_API_KEY")
    assert Settings().llm_enabled                                # local, no key
    monkeypatch.delenv("LLM_PROVIDER"); monkeypatch.setenv("ANTHROPIC_API_KEY", "a")
    s = Settings()
    assert s.llm_provider == "anthropic" and s.answer_model == "claude-sonnet-5-5" and not s.compact_prompts


def test_small_talk_gets_a_friendly_reply():
    assert "Remi" in small_talk_reply("hi, how are you doing?")
    assert small_talk_reply("Hello there!").startswith("Hello!")
    assert "Remi" in small_talk_reply("hi, what is your name??")
    assert small_talk_reply("hey Remi") is not None
    assert small_talk_reply("thanks so much") is not None
    # Real questions, even ones that start with a greeting, still go to search.
    assert small_talk_reply("hi, what is the Tier 1 transaction limit?") is None
    assert small_talk_reply("How are KYC tiers defined?") is None
    assert small_talk_reply("which deadlines apply this year") is None


def test_conversation_memory():
    history = [{"question": "What is the Tier 1 daily limit?", "answer": "It is N50,000 [1].\n\nThis is not legal advice."}]
    msgs = build_answer_messages("And for Tier 2?", ROWS, history)
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert "[1]" not in msgs[1]["content"]                      # stale citation numbers removed
    assert msgs[-1]["content"].endswith("Question: And for Tier 2?")
    # Short follow-ups are searched with the previous question; long ones stand alone.
    assert retrieval_query("And for Tier 2?", history) == "What is the Tier 1 daily limit? And for Tier 2?"
    long_q = "What are the full record keeping obligations for customer due diligence documents held by banks?"
    assert retrieval_query(long_q, history) == long_q
    assert len(retrieval_query("word " * 5000)) <= 2000           # very long questions are searched by their start
