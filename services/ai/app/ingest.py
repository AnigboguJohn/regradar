"""Ingestion: fetch new regulator documents, extract, chunk, embed, store."""
from __future__ import annotations

import hashlib
import logging

import httpx

from . import db
from .chunking import chunk_pages
from .config import settings
from .embeddings import embed, to_pgvector
from .extract import extract_pages, looks_scanned
from .sources import SOURCES
from .sources.base import SourceItem

log = logging.getLogger("regradar.ingest")


def _http() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": settings.user_agent}, follow_redirects=True)


def store_document(*, org_id: str | None, kind: str, source_id: str, external_id: str, title: str,
                   regulator: str | None, ref_no: str | None, url: str | None, published_at,
                   pages: list[str]) -> str:
    """Insert (or replace) a document and its chunks in one transaction. Returns document id."""
    chunks = chunk_pages(pages)
    if not chunks:
        raise ValueError("No text could be extracted from this document")
    vectors = embed([f"{c.heading or ''}\n{c.content}" for c in chunks], input_type="document")

    with db.conn() as c, c.cursor() as cur:
        cur.execute(
            """INSERT INTO documents (org_id, kind, source_id, external_id, regulator, ref_no, title, url,
                                      published_at, status, page_count)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'ready',%s)
               ON CONFLICT (source_id, external_id, org_id) DO UPDATE
                 SET title = EXCLUDED.title, ref_no = EXCLUDED.ref_no, url = EXCLUDED.url,
                     published_at = EXCLUDED.published_at, status = 'ready', error = NULL,
                     page_count = EXCLUDED.page_count, ingested_at = now()
               RETURNING id""",
            (org_id, kind, source_id, external_id, regulator, ref_no, title, url, published_at, len(pages)),
        )
        doc_id = cur.fetchone()["id"]
        cur.execute("DELETE FROM chunks WHERE document_id = %s", (doc_id,))
        for i, ch in enumerate(chunks):
            cur.execute(
                """INSERT INTO chunks (document_id, org_id, ordinal, page, heading, content, embedding)
                   VALUES (%s,%s,%s,%s,%s,%s,%s::vector)""",
                (doc_id, org_id, ch.ordinal, ch.page, ch.heading, ch.content,
                 to_pgvector(vectors[i]) if vectors else None),
            )
        c.commit()
    return str(doc_id)


def _mark_failed(item: SourceItem, error: str) -> None:
    with db.conn() as c, c.cursor() as cur:
        cur.execute(
            """INSERT INTO documents (org_id, kind, source_id, external_id, regulator, ref_no, title, url,
                                      published_at, status, error)
               VALUES (NULL,'regulation',%s,%s,%s,%s,%s,%s,%s,'failed',%s)
               ON CONFLICT (source_id, external_id, org_id) DO UPDATE SET status='failed', error=EXCLUDED.error""",
            (item.source_id, item.external_id, item.regulator, item.ref_no, item.title, item.url,
             item.published_at, error[:500]),
        )
        c.commit()


def known_ids(source_id: str) -> set[str]:
    rows = db.fetchall(
        "SELECT external_id FROM documents WHERE source_id = %s AND org_id IS NULL AND status = 'ready'",
        (source_id,))
    return {r["external_id"] for r in rows}


def run_source(source_id: str, limit: int | None = None) -> dict:
    """Fetch the listing, ingest documents not seen before (newest first).

    Each run is recorded in ingest_runs (shown on the dashboard). A failing PDF is marked
    "failed" and skipped so one bad file never stops the rest; it is retried on the next run.
    """
    module = SOURCES[source_id]
    limit = limit or settings.max_docs_per_run
    new_ids: list[str] = []
    failed: list[dict] = []
    with db.conn() as c, c.cursor() as cur:
        cur.execute("INSERT INTO ingest_runs (source_id) VALUES (%s) RETURNING id", (source_id,))
        run_id = cur.fetchone()["id"]
        c.commit()
    error = None
    try:
        with _http() as http:
            items = module.fetch_listing(http)
            seen = known_ids(source_id)
            todo = [i for i in items if i.external_id not in seen][:limit]
            log.info("%s: %d listed, %d new to ingest", source_id, len(items), len(todo))
            for item in todo:
                try:
                    resp = http.get(item.url, timeout=120)
                    resp.raise_for_status()
                    if len(resp.content) > settings.max_pdf_mb * 1024 * 1024:
                        raise ValueError("file too large")
                    pages = extract_pages(resp.content, item.url)
                    if looks_scanned(pages):
                        # Keep the listing metadata searchable even when the PDF is an image scan.
                        pages = [f"{item.title}\n\n{item.summary or ''}\n\n(Scanned document: full text not extracted.)"]
                    doc_id = store_document(
                        org_id=None, kind="regulation", source_id=item.source_id, external_id=item.external_id,
                        title=item.title, regulator=item.regulator, ref_no=item.ref_no, url=item.url,
                        published_at=item.published_at, pages=pages)
                    new_ids.append(doc_id)
                except Exception as e:  # one bad PDF must not stop the run
                    log.warning("failed %s: %s", item.url, e)
                    failed.append({"title": item.title, "error": str(e)[:200]})
                    _mark_failed(item, str(e))
    except Exception as e:
        error = str(e)[:500]
        log.exception("source %s failed", source_id)
    with db.conn() as c, c.cursor() as cur:
        cur.execute("UPDATE ingest_runs SET finished_at = now(), new_docs = %s, error = %s WHERE id = %s",
                    (len(new_ids), error, run_id))
        c.commit()
    return {"source_id": source_id, "new_document_ids": new_ids, "failed": failed, "error": error}


def ingest_upload(*, org_id: str | None, data: bytes, filename: str, title: str | None, kind: str = "policy",
                  regulator: str | None = None, ref_no: str | None = None, published_at=None) -> str:
    pages = extract_pages(data, filename)
    if looks_scanned(pages):
        raise ValueError("This PDF looks like a scanned image with no text layer. Please upload a text PDF.")
    digest = hashlib.sha256(data).hexdigest()[:32]
    # Regulations uploaded manually by an org stay private to that org; with org_id None (platform
    # admin console) the regulation is shared with every company.
    return store_document(
        org_id=org_id, kind=kind, source_id="upload", external_id=digest,
        title=title or filename.rsplit(".", 1)[0], regulator=regulator, ref_no=ref_no, url=None,
        published_at=published_at, pages=pages)


def attach_file(*, document_id: str, data: bytes, filename: str) -> str:
    """Index a file for an existing regulator circular whose automatic download failed.
    Keeps the circular's title, reference, date and link; only the text comes from the file."""
    doc = db.fetchone(
        """SELECT org_id, kind, source_id, external_id, title, regulator, ref_no, url, published_at
           FROM documents WHERE id = %s""", (document_id,))
    if not doc or doc["kind"] != "regulation":
        raise ValueError("Regulation not found")
    pages = extract_pages(data, filename)
    if looks_scanned(pages):
        raise ValueError("This PDF looks like a scanned image with no text layer. Please upload a text PDF.")
    return store_document(
        org_id=doc["org_id"], kind="regulation", source_id=doc["source_id"], external_id=doc["external_id"],
        title=doc["title"], regulator=doc["regulator"], ref_no=doc["ref_no"], url=doc["url"],
        published_at=doc["published_at"], pages=pages)
