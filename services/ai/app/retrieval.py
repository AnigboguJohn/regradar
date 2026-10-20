"""Hybrid retrieval: Postgres full-text search + optional pgvector, fused with RRF.

Tenant isolation: a query sees public regulations (org_id IS NULL) and only its
own organisation's policies. This filter is applied in SQL on every query.
"""
from __future__ import annotations

from . import db
from .embeddings import embed, to_pgvector
from .fusion import diversify, rrf

SCOPE_SQL = {
    "all": "(c.org_id IS NULL OR c.org_id = %(org)s)",
    # public regulations + regulations this org uploaded privately
    "regulations": "d.kind = 'regulation' AND (c.org_id IS NULL OR c.org_id = %(org)s)",
    "policies": "d.kind = 'policy' AND c.org_id = %(org)s",
}

ROW_SQL = """
SELECT c.id AS chunk_id, c.document_id, c.page, c.heading, c.content,
       d.title, d.regulator, d.ref_no, d.url, d.published_at, d.kind
FROM chunks c JOIN documents d ON d.id = c.document_id
WHERE c.id = ANY(%(ids)s)
"""


def _filters(regulators: list[str] | None, document_id: str | None) -> str:
    sql = ""
    if regulators:
        sql += " AND (d.regulator = ANY(%(regs)s) OR d.kind = 'policy')"
    if document_id:
        sql += " AND c.document_id = %(doc)s"
    return sql


def keyword_ids(query: str, params: dict, where: str, limit: int) -> list[int]:
    """Full-text search. websearch_to_tsquery understands quotes and OR like a search engine;
    ts_rank_cd scores chunks where the words appear close together higher; ties go to newer documents."""
    sql = f"""
    SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE {where} AND d.status = 'ready'
      AND c.tsv @@ websearch_to_tsquery('english', %(q)s)
    ORDER BY ts_rank_cd(c.tsv, websearch_to_tsquery('english', %(q)s), 32) DESC,
             d.published_at DESC NULLS LAST
    LIMIT {int(limit)}"""
    ids = [r["id"] for r in db.fetchall(sql, {**params, "q": query})]
    if ids:
        return ids
    # Fallback: OR the terms together when the strict AND query finds nothing.
    terms = [t for t in "".join(ch if ch.isalnum() else " " for ch in query).split() if len(t) > 2]
    if not terms:
        return []
    sql_or = sql.replace("websearch_to_tsquery('english', %(q)s)", "to_tsquery('english', %(qor)s)")
    return [r["id"] for r in db.fetchall(sql_or, {**params, "qor": " | ".join(terms)})]


def vector_ids(query: str, params: dict, where: str, limit: int) -> list[int]:
    vecs = embed([query], input_type="query")
    if not vecs:
        return []
    sql = f"""
    SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE {where} AND d.status = 'ready' AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> %(v)s::vector
    LIMIT {int(limit)}"""
    return [r["id"] for r in db.fetchall(sql, {**params, "v": to_pgvector(vecs[0])})]


def search(query: str, org_id: str, scope: str = "all", regulators: list[str] | None = None,
           document_id: str | None = None, k: int = 8) -> list[dict]:
    params = {"org": org_id, "regs": regulators or [], "doc": document_id}
    where = SCOPE_SQL[scope] + _filters(regulators, document_id)
    # 1. Gather candidates from each search method (30 each).
    lists = [keyword_ids(query, params, where, 30)]
    v = vector_ids(query, params, where, 30)
    if v:
        lists.append(v)
    # 2. Merge the ranked lists (RRF), keeping extra candidates for the per-document cap below.
    fused = rrf(lists, limit=k * 2)
    if not fused:
        return []
    # 3. Load the full rows (text + document details) for the winners, in fused order.
    by_id = {r["chunk_id"]: r for r in db.fetchall(ROW_SQL, {"ids": [cid for cid, _ in fused]})}
    ordered = [dict(by_id[cid], score=round(score, 5)) for cid, score in fused if cid in by_id]
    # 4. At most 3 chunks per document, so answers can draw on several regulations.
    return diversify(ordered, per_document=3)[:k]
