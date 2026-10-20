"""Split extracted document pages into retrieval chunks.

Regulatory text is structured (numbered sections, headings), so we split on
paragraph boundaries, keep the most recent heading with each chunk and carry
a small overlap so a rule split across chunks is still retrievable.
Pure Python, no dependencies, which keeps it easy to unit test.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

HEADING_RE = re.compile(
    r"^\s*(?:"
    r"(?i:section|part|chapter|article|schedule|appendix)\s+[\w.\-]+.*"   # Section 4.2 ...
    r"|\d+(?:\.\d+){0,3}\.?\s+[A-Z][^.]{2,90}"                            # 4.2 Customer Due Diligence
    r"|[A-Z][A-Z0-9 ,&/()\-]{4,90}"                                       # ALL CAPS HEADING (case-sensitive)
    r")\s*$"
)


@dataclass
class Chunk:
    ordinal: int
    page: int | None
    heading: str | None
    content: str


def normalize(text: str) -> str:
    text = text.replace(" ", " ").replace("\r", "\n")
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)          # re-join hyphenated words
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _is_heading(line: str) -> bool:
    line = line.strip()
    if not line or len(line) > 100 or line.endswith((".", ",", ";")) and not re.match(r"^\d", line):
        return False
    return bool(HEADING_RE.match(line))


def _paragraphs(page_text: str) -> list[str]:
    """Split a page into paragraphs; headings become their own paragraph."""
    paras: list[str] = []
    buf: list[str] = []
    for line in page_text.split("\n"):
        if not line.strip():
            if buf:
                paras.append(" ".join(buf))
                buf = []
            continue
        if _is_heading(line):
            if buf:
                paras.append(" ".join(buf))
                buf = []
            paras.append(line.strip())
            continue
        buf.append(line.strip())
    if buf:
        paras.append(" ".join(buf))
    return paras


def _split_long(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    sentences = re.split(r"(?<=[.;:])\s+", text)
    out, cur = [], ""
    for s in sentences:
        while len(s) > max_chars:                 # pathological: no punctuation
            if cur:
                out.append(cur.strip())
                cur = ""
            out.append(s[:max_chars])
            s = s[max_chars:]
        if len(cur) + len(s) + 1 > max_chars and cur:
            out.append(cur.strip())
            cur = s
        else:
            cur = f"{cur} {s}" if cur else s
    if cur.strip():
        out.append(cur.strip())
    return out


def chunk_pages(pages: list[str], max_chars: int = 1800, overlap_chars: int = 200) -> list[Chunk]:
    """pages[i] is the text of page i+1. Returns ordered chunks.

    Walks every paragraph in order. A heading starts a new chunk (and becomes the label of the chunks
    that follow); otherwise paragraphs are packed into the current chunk until it would exceed
    max_chars, then the chunk is closed and the next one starts with the last ~overlap_chars of it.
    ~1,800 characters (about 400 tokens) is small enough to retrieve precisely and large enough
    to keep a whole rule together.
    """
    chunks: list[Chunk] = []
    heading: str | None = None
    cur: list[str] = []
    cur_len = 0
    cur_page: int | None = None
    cur_heading: str | None = None
    fresh = False          # does `cur` hold new text beyond the carried-over overlap?

    def flush():
        nonlocal cur, cur_len, cur_page, fresh
        if not cur or not fresh:
            return
        body = "\n".join(cur).strip()
        if body:
            chunks.append(Chunk(len(chunks), cur_page, cur_heading, body))
        tail = body[-overlap_chars:] if overlap_chars else ""
        # start the overlap on a word boundary
        tail = tail[tail.find(" ") + 1:] if " " in tail else tail
        cur = [tail] if tail else []
        cur_len = len(tail)
        fresh = False

    for page_no, raw in enumerate(pages, start=1):
        for para in _paragraphs(normalize(raw)):
            if _is_heading(para):
                flush()
                cur, cur_len, fresh = [], 0, False   # no overlap across a new section
                heading = para
                cur_heading = heading
                cur_page = page_no
                continue
            for piece in _split_long(para, max_chars):
                if cur_len + len(piece) > max_chars and cur_len > 0:
                    flush()
                    cur_heading = heading
                    cur_page = page_no
                if cur_page is None:
                    cur_page = page_no
                    cur_heading = heading
                cur.append(piece)
                cur_len += len(piece) + 1
                fresh = True
    flush()
    return chunks
