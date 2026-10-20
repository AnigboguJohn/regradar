"""SourceItem: one document listed by a regulator's website, before it is downloaded.
Every regulator module (cbn.py, and future sec.py, ndpc.py...) returns a list of these.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass
class SourceItem:
    source_id: str
    external_id: str
    regulator: str
    title: str
    url: str
    ref_no: str | None = None
    published_at: date | None = None
    summary: str | None = None
