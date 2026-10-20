"""RegRadar AI service: internal API used by the Node.js gateway (never exposed publicly)."""
from __future__ import annotations

import logging
from datetime import date

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import db, impact, ingest, llm, retrieval
from .config import settings
from .prompts import (ANSWER_SYSTEM, build_answer_messages, citation_payload, extractive_answer,
                      retrieval_query, small_talk_reply, used_citations)
from .sources import SOURCES

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = FastAPI(title="RegRadar AI", version="1.0.0")


@app.on_event("startup")
def _startup():
    db.pool.open(wait=True, timeout=30)


@app.on_event("shutdown")
def _shutdown():
    db.pool.close()


def internal_only(x_internal_token: str = Header(default="")):
    if x_internal_token != settings.internal_token:
        raise HTTPException(status_code=401, detail="invalid internal token")


@app.get("/health")
def health():
    db.fetchone("SELECT 1 AS ok")
    return {"ok": True, "llm": settings.llm_enabled, "llm_provider": settings.llm_provider or None,
            "embeddings": settings.embeddings_enabled,
            "sources": list(SOURCES)}


# ---------- Q&A ----------
class Turn(BaseModel):
    question: str
    answer: str


class AskIn(BaseModel):
    org_id: str
    question: str = Field(min_length=3, max_length=20_000)
    scope: str = Field(default="all", pattern="^(all|regulations|policies)$")
    regulators: list[str] | None = None
    history: list[Turn] = Field(default_factory=list, max_length=20)   # earlier turns, oldest first


@app.post("/answer", dependencies=[Depends(internal_only)])
def answer(body: AskIn):
    # RAG in three steps: (1) retrieve the most relevant passages for this organisation,
    # (2) ask the LLM to answer ONLY from them with [n] citations, (3) return the citations it used.
    # Greetings and "who are you" get a friendly reply without searching.
    if (reply := small_talk_reply(body.question)) is not None:
        return {"answer": reply, "citations": [], "mode": "chat", "retrieved": 0}
    history = [t.model_dump() for t in body.history]
    rows = retrieval.search(retrieval_query(body.question, history), body.org_id, scope=body.scope,
                            regulators=body.regulators, k=8)
    if settings.compact_prompts:
        rows = rows[:5]          # stay inside free-tier per-minute token limits
    text, mode = "", "extractive"
    if settings.llm_enabled and rows:
        try:
            text = llm.complete(ANSWER_SYSTEM, build_answer_messages(body.question, rows, history),
                                model=settings.answer_model, max_tokens=1000 if settings.compact_prompts else 1500)
            mode = "llm"
        except llm.LLMError as e:
            logging.getLogger("regradar").warning("LLM failed, falling back to extractive answer: %s", e)
    if mode == "extractive" or not text:
        text, mode = extractive_answer(body.question, rows), "extractive"
    # Only sources the answer actually cites are returned, in the order they first appear.
    nums = used_citations(text, len(rows))
    return {"answer": text, "citations": citation_payload(rows, nums), "mode": mode,
            "retrieved": len(rows)}


class SearchIn(BaseModel):
    org_id: str
    query: str = Field(min_length=2, max_length=500)
    scope: str = Field(default="all", pattern="^(all|regulations|policies)$")
    k: int = Field(default=10, ge=1, le=50)


@app.post("/search", dependencies=[Depends(internal_only)])
def search(body: SearchIn):
    rows = retrieval.search(body.query, body.org_id, scope=body.scope, k=body.k)
    return {"results": [{**r, "document_id": str(r["document_id"]),
                         "published_at": str(r["published_at"]) if r["published_at"] else None} for r in rows]}


# ---------- Ingestion ----------
class RunIn(BaseModel):
    sources: list[str] | None = None
    limit: int | None = Field(default=None, ge=1, le=200)


@app.post("/ingest/run", dependencies=[Depends(internal_only)])
def ingest_run(body: RunIn):
    targets = body.sources or list(SOURCES)
    unknown = [s for s in targets if s not in SOURCES]
    if unknown:
        raise HTTPException(400, f"unknown sources: {unknown}")
    return {"runs": [ingest.run_source(s, body.limit) for s in targets]}


@app.post("/ingest/upload", dependencies=[Depends(internal_only)])
async def ingest_upload(org_id: str = Form(""), file: UploadFile = File(...), title: str | None = Form(None),
                        kind: str = Form("policy"), regulator: str | None = Form(None),
                        ref_no: str | None = Form(None), published_at: date | None = Form(None)):
    if kind not in ("policy", "regulation"):
        raise HTTPException(400, "kind must be policy or regulation")
    if not org_id and kind != "regulation":
        raise HTTPException(400, "policies always belong to a company")
    data = await file.read()
    if len(data) > settings.max_pdf_mb * 1024 * 1024:
        raise HTTPException(413, f"file larger than {settings.max_pdf_mb} MB")
    try:
        doc_id = ingest.ingest_upload(org_id=org_id or None, data=data, filename=file.filename or "", title=title,
                                      kind=kind, regulator=regulator, ref_no=ref_no, published_at=published_at)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"document_id": doc_id}


# ---------- Impact ----------
class ImpactIn(BaseModel):
    org_id: str
    regulation_id: str


@app.post("/ingest/attach", dependencies=[Depends(internal_only)])
async def ingest_attach(document_id: str = Form(...), file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > settings.max_pdf_mb * 1024 * 1024:
        raise HTTPException(413, f"file larger than {settings.max_pdf_mb} MB")
    try:
        doc_id = ingest.attach_file(document_id=document_id, data=data, filename=file.filename or "")
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"document_id": doc_id}


@app.post("/impact", dependencies=[Depends(internal_only)])
def run_impact(body: ImpactIn):
    try:
        return {"findings": impact.analyze(body.org_id, body.regulation_id)}
    except ValueError as e:
        raise HTTPException(404, str(e))
