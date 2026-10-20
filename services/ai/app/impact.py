"""Impact analysis: which of an organisation's policies does a new regulation affect?"""
from __future__ import annotations

import json
import logging

from . import db, llm
from .config import settings
from .prompts import IMPACT_SYSTEM, build_impact_messages, parse_findings
from .retrieval import search

log = logging.getLogger("regradar.impact")

MAX_REG_CHUNKS = 12
MAX_POLICY_CHUNKS = 10


def _regulation(doc_id: str) -> tuple[dict, list[dict]]:
    doc = db.fetchone("SELECT id, title, regulator, ref_no, published_at, url FROM documents WHERE id = %s", (doc_id,))
    if not doc:
        raise ValueError("regulation not found")
    chunks = db.fetchall(
        "SELECT id AS chunk_id, heading, content FROM chunks WHERE document_id = %s ORDER BY ordinal LIMIT %s",
        (doc_id, MAX_REG_CHUNKS))
    return doc, chunks


def _related_policy_chunks(org_id: str, reg: dict, reg_chunks: list[dict]) -> list[dict]:
    """Find the policy passages most related to the regulation (title + each section as queries)."""
    queries = [reg["title"]] + [((c.get("heading") or "") + " " + c["content"][:300]) for c in reg_chunks[:6]]
    found: dict[int, dict] = {}
    for q in queries:
        for r in search(q, org_id, scope="policies", k=4):
            found.setdefault(r["chunk_id"], r)
    return sorted(found.values(), key=lambda r: -r.get("score", 0))[:MAX_POLICY_CHUNKS]


def analyze(org_id: str, regulation_id: str) -> list[dict]:
    reg, reg_chunks = _regulation(regulation_id)
    policy_chunks = _related_policy_chunks(org_id, reg, reg_chunks)
    if not policy_chunks:
        return []
    if settings.compact_prompts:     # free tiers: smaller prompt
        reg_chunks, policy_chunks = reg_chunks[:6], policy_chunks[:6]

    findings = None
    if settings.llm_enabled:
        try:
            text = llm.complete(IMPACT_SYSTEM, build_impact_messages(reg, reg_chunks, policy_chunks),
                                model=settings.impact_model, max_tokens=1500 if settings.compact_prompts else 3000)
            findings = parse_findings(text, {c["chunk_id"] for c in policy_chunks})
        except llm.LLMError as e:
            log.warning("LLM failed, falling back to review-only findings: %s", e)
    if findings is None:
        # Without an LLM, flag the closest policy sections for human review and show the
        # regulation passage each one most closely matches, so the reviewer can compare side by side.
        findings = []
        for c in policy_chunks[:3]:
            match = search(c["content"][:400], org_id, scope="all", document_id=regulation_id, k=1)
            section = c.get("heading") or "This section"
            findings.append({
                "policy_chunk_id": c["chunk_id"], "severity": "info",
                "summary": f"{section} of '{c['title']}' covers the same topic as the new regulation. Review it against the rule.",
                "recommendation": "Compare the two passages and update the policy if it no longer matches.",
                "regulation_quote": match[0]["content"][:400] if match else ""})

    by_chunk = {c["chunk_id"]: c for c in policy_chunks}
    saved = []
    with db.conn() as c, c.cursor() as cur:
        cur.execute("DELETE FROM impact_findings WHERE org_id = %s AND regulation_id = %s AND status = 'open'",
                    (org_id, regulation_id))
        for f in findings:
            pc = by_chunk[f["policy_chunk_id"]]
            evidence = {"policy_excerpt": pc["content"][:800], "policy_section": pc.get("heading"),
                        "policy_page": pc.get("page"), "regulation_quote": f["regulation_quote"]}
            cur.execute(
                """INSERT INTO impact_findings (org_id, regulation_id, policy_id, severity, summary, recommendation, evidence)
                   VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                (org_id, regulation_id, pc["document_id"], f["severity"], f["summary"], f["recommendation"],
                 json.dumps(evidence)))
            saved.append({**f, "id": cur.fetchone()["id"], "policy_id": str(pc["document_id"])})
        c.commit()
    log.info("impact org=%s reg=%s findings=%d", org_id, regulation_id, len(saved))
    return saved
