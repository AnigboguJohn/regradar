"""Central Bank of Nigeria (CBN) circulars.

The CBN website lists circulars through a public JSON endpoint:
    https://www.cbn.gov.ng/api/GetAllCirculars
Each record has: id, refNo, title, description, author, keywords, link,
documentDate ("dd/mm/yyyy"), filesize. `link` is a site-relative PDF path that
may contain spaces.
"""
from __future__ import annotations

from datetime import date, datetime
from urllib.parse import quote

from .base import SourceItem

BASE = "https://www.cbn.gov.ng"
LIST_URL = f"{BASE}/api/GetAllCirculars"
SOURCE_ID = "cbn_circulars"


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    value = value.strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value[:19], fmt).date()
        except ValueError:
            continue
    return None


def _absolute(link: str | None) -> str | None:
    if not link:
        return None
    link = link.strip()
    if link.startswith("http"):
        return link
    if not link.startswith("/"):
        link = "/" + link
    return BASE + quote(link, safe="/:()&,'")


def parse_listing(records: list[dict]) -> list[SourceItem]:
    """Turn the raw JSON list into SourceItems. Pure function (unit tested)."""
    items: list[SourceItem] = []
    seen: set[str] = set()
    for r in records:
        if not isinstance(r, dict):
            continue
        title = " ".join(str(r.get("title") or "").split())
        url = _absolute(r.get("link"))
        if not title or not url:
            continue
        ext_id = str(r.get("id") or url)
        if ext_id in seen:
            continue
        seen.add(ext_id)
        items.append(SourceItem(
            source_id=SOURCE_ID,
            external_id=ext_id,
            regulator="CBN",
            ref_no=(str(r.get("refNo") or "").strip() or None),
            title=title,
            url=url,
            published_at=_parse_date(r.get("documentDate")),
            summary=(str(r.get("description") or "").strip() or None),
        ))
    items.sort(key=lambda i: i.published_at or date.min, reverse=True)
    return items


def fetch_listing(http) -> list[SourceItem]:
    """http: an httpx.Client. Network call kept separate from parsing."""
    resp = http.get(LIST_URL, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, dict):            # defensive: some APIs wrap lists
        data = data.get("data") or data.get("items") or []
    return parse_listing(data)
