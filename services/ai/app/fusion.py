"""Reciprocal Rank Fusion: merge keyword and vector result lists.

score(d) = sum over lists of 1 / (k + rank_in_list(d)),  rank starting at 1.
Robust, parameter-light, and doesn't need the two scores to be comparable.
"""
from __future__ import annotations


def rrf(result_lists: list[list[int]], k: int = 60, limit: int = 8) -> list[tuple[int, float]]:
    scores: dict[int, float] = {}
    for results in result_lists:
        for rank, chunk_id in enumerate(results, start=1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank)
    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    return ranked[:limit]


def diversify(rows: list[dict], per_document: int = 3) -> list[dict]:
    """Cap chunks per document so one long circular can't crowd out others."""
    counts: dict[str, int] = {}
    out = []
    for r in rows:
        d = str(r["document_id"])
        if counts.get(d, 0) < per_document:
            out.append(r)
            counts[d] = counts.get(d, 0) + 1
    return out
