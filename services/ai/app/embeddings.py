"""Optional dense embeddings for hybrid search (Voyage AI or OpenAI).

Without a provider, RegRadar uses Postgres full-text search only, which works
well for regulatory text full of exact terms (BVN, KYC tier, ref numbers).
"""
from __future__ import annotations

import httpx

from .config import settings

BATCH = 64


def _voyage(texts: list[str], input_type: str) -> list[list[float]]:
    r = httpx.post(
        "https://api.voyageai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {settings.voyage_api_key}"},
        json={"input": texts, "model": "voyage-3.5", "input_type": input_type,
              "output_dimension": settings.embedding_dim},
        timeout=60,
    )
    r.raise_for_status()
    return [d["embedding"] for d in sorted(r.json()["data"], key=lambda d: d["index"])]


def _openai(texts: list[str], input_type: str) -> list[list[float]]:
    r = httpx.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {settings.openai_api_key}"},
        json={"input": texts, "model": "text-embedding-3-small", "dimensions": settings.embedding_dim},
        timeout=60,
    )
    r.raise_for_status()
    return [d["embedding"] for d in sorted(r.json()["data"], key=lambda d: d["index"])]


def embed(texts: list[str], input_type: str = "document") -> list[list[float]] | None:
    if not settings.embeddings_enabled or not texts:
        return None
    fn = _voyage if settings.embedding_provider == "voyage" else _openai
    out: list[list[float]] = []
    for i in range(0, len(texts), BATCH):
        out.extend(fn([t[:8000] for t in texts[i:i + BATCH]], input_type))
    return out


def to_pgvector(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"
