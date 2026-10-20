"""Text extraction from uploaded or downloaded files."""
from __future__ import annotations

import io


def extract_pages(data: bytes, filename: str = "") -> list[str]:
    """Return one string per page. Supports PDF, plain text and Markdown."""
    name = filename.lower()
    if data[:5] == b"%PDF-" or name.endswith(".pdf"):
        import pdfplumber

        pages: list[str] = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages:
                pages.append(page.extract_text() or "")
        return pages
    if name.endswith((".txt", ".md")) or not name:
        text = data.decode("utf-8", errors="replace")
        # treat form-feeds as page breaks; otherwise one logical page
        return text.split("\f") if "\f" in text else [text]
    if name.endswith(".docx"):
        import zipfile
        import re

        with zipfile.ZipFile(io.BytesIO(data)) as z:
            xml = z.read("word/document.xml").decode("utf-8", errors="replace")
        xml = re.sub(r"</w:p>", "\n", xml)
        return [re.sub(r"<[^>]+>", "", xml)]
    raise ValueError(f"Unsupported file type: {filename or 'unknown'} (use PDF, DOCX, TXT or MD)")


def looks_scanned(pages: list[str]) -> bool:
    """A PDF with almost no extractable text is probably a scan that needs OCR."""
    text = "".join(pages)
    return len(pages) > 0 and len(text.strip()) < 50 * len(pages)
