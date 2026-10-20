"""Prompt construction and output parsing. Pure functions, unit tested."""
from __future__ import annotations

import json
import re

# The assistant's name, used in its greetings and in the answer prompt.
BOT_NAME = "Remi"

ANSWER_SYSTEM = f"""You are {BOT_NAME}, RegRadar's regulatory compliance assistant for financial institutions.

Rules:
- Answer ONLY from the numbered sources provided. Never use outside knowledge for regulatory facts.
- Cite every factual sentence with the source number in square brackets, e.g. [2] or [1][3].
- Quote exact figures, limits, deadlines and reference numbers as they appear in the sources.
- If sources conflict, prefer the most recent one and say that an earlier rule was superseded.
- If the sources do not answer the question, say so plainly and suggest what document to look for. Do not guess.
- Be concise: short paragraphs or bullet points. End with "This is not legal advice." on its own line.
"""

IMPACT_SYSTEM = """You are a compliance analyst. Compare a NEW REGULATION with excerpts from a company's INTERNAL POLICIES.
Identify concrete gaps or conflicts: a policy that now violates, falls short of, or must be updated because of the regulation.
Only report issues supported by the text. If nothing needs to change, return an empty list.

Respond with ONLY a JSON object, no prose, in this exact shape:
{"findings": [{"policy_excerpt_id": <int>, "severity": "high"|"medium"|"low",
  "summary": "<one sentence: what conflicts or is missing>",
  "recommendation": "<what to change in the policy>",
  "regulation_quote": "<short exact quote from the regulation>"}]}
Severity: high = current policy breaches the rule or a deadline is imminent; medium = policy must be updated;
low = wording/clarity or good practice.
"""


def format_sources(rows: list[dict]) -> str:
    parts = []
    for i, r in enumerate(rows, start=1):
        meta = [r.get("regulator") or ("Internal policy" if r.get("kind") == "policy" else None),
                r.get("ref_no"), str(r["published_at"]) if r.get("published_at") else None,
                f"p.{r['page']}" if r.get("page") else None]
        header = " | ".join(m for m in meta if m)
        heading = f"\nSection: {r['heading']}" if r.get("heading") else ""
        parts.append(f"[{i}] {r['title']} ({header}){heading}\n{r['content'].strip()}")
    return "\n\n---\n\n".join(parts)


CITE_RE = re.compile(r"\[(\d{1,2})\]")

# Earlier turns are trimmed so a long conversation never crowds out the sources.
_TURN_CHARS = 3000
_SEARCH_CHARS = 2000


def build_answer_messages(question: str, rows: list[dict], history: list[dict] | None = None) -> list[dict]:
    """Earlier turns of the conversation (oldest first), then the new question with its sources."""
    messages: list[dict] = []
    for turn in history or []:
        # Old [n] markers point at old sources; dropping them stops the model reusing stale numbers.
        messages.append({"role": "user", "content": turn["question"].strip()[:_TURN_CHARS]})
        messages.append({"role": "assistant", "content": CITE_RE.sub("", turn["answer"]).strip()[:_TURN_CHARS]})
    messages.append({
        "role": "user",
        "content": f"<sources>\n{format_sources(rows)}\n</sources>\n\nQuestion: {question.strip()}",
    })
    return messages


def retrieval_query(question: str, history: list[dict] | None = None) -> str:
    """What to search for. A short follow-up ("and for Tier 2?") is searched together with the
    previous question so it keeps its subject; long questions stand on their own."""
    q = " ".join(question.split())
    if history and len(q.split()) <= 12:
        q = f"{' '.join(history[-1]['question'].split())} {q}"
    return q[:_SEARCH_CHARS]


def used_citations(answer: str, n_sources: int) -> list[int]:
    """1-based source numbers actually cited in the answer, in first-seen order."""
    seen: list[int] = []
    for m in CITE_RE.finditer(answer):
        n = int(m.group(1))
        if 1 <= n <= n_sources and n not in seen:
            seen.append(n)
    return seen


def citation_payload(rows: list[dict], numbers: list[int]) -> list[dict]:
    out = []
    for n in numbers:
        r = rows[n - 1]
        out.append({
            "n": n,
            "chunk_id": r["chunk_id"],
            "document_id": str(r["document_id"]),
            "title": r["title"],
            "regulator": r.get("regulator"),
            "ref_no": r.get("ref_no"),
            "published_at": str(r["published_at"]) if r.get("published_at") else None,
            "page": r.get("page"),
            "url": r.get("url"),
            "kind": r.get("kind"),
            "excerpt": r["content"][:600],
        })
    return out


# Small talk is answered directly instead of searching regulations. A message only counts as small
# talk when it is made entirely of these phrases, so "hi, what is the Tier 1 limit?" still gets searched.
_INTRO = (f"I'm {BOT_NAME}, your RegRadar compliance assistant. Ask me about regulations, circulars, "
          "deadlines or whether your policies meet current requirements, and I'll answer with cited sources.")
_SMALL_TALK = [
    (re.compile(r"\b(who are you|what(?:'s| is) your name|what are you|what can you do|help)\b"), _INTRO),
    (re.compile(r"\b(how are you(?: doing)?|how(?:'s| is) it going|how do you do)\b"),
     f"I'm doing well, thanks for asking! {_INTRO}"),
    (re.compile(r"\b(thanks|thank you|thx|cheers)\b"), "You're welcome! Let me know if you have another question."),
    (re.compile(r"\b(bye|goodbye|see you)\b"), "Goodbye! Come back any time you have a compliance question."),
    (re.compile(r"\b(hi|hello|hey|hiya|good (?:morning|afternoon|evening)|greetings)\b"), f"Hello! {_INTRO}"),
]
_FILLER = re.compile(r"\b(very much|so much|a lot|there|regradar|remi|bot|please|and|so|ok|okay|today|again)\b")


def small_talk_reply(question: str) -> str | None:
    """A friendly reply if the message is only a greeting/thanks/'who are you', else None."""
    text = question.lower().replace("’", "'")
    reply = None
    for pattern, answer in _SMALL_TALK:
        if pattern.search(text):
            reply = reply or answer          # first match in the list wins (most specific first)
            text = pattern.sub(" ", text)
    leftover = re.sub(r"[^a-z']+", " ", _FILLER.sub(" ", text)).strip()
    return reply if reply and not leftover else None


def extractive_answer(question: str, rows: list[dict]) -> str:
    """Fallback when no LLM key is configured: show the best passages, cited."""
    if not rows:
        return ("I couldn't find anything in the indexed regulations about that. "
                "Try different keywords or check that the relevant circular has been ingested.\n\n"
                "This is not legal advice.")
    lines = ["Most relevant passages (AI summarisation is off: add an AI provider key in the .env file to enable it):", ""]
    for i, r in enumerate(rows[:4], start=1):
        snippet = " ".join(r["content"].split())
        snippet = snippet[:350] + ("…" if len(snippet) > 350 else "")
        lines.append(f"- {snippet} [{i}]")
    lines += ["", "This is not legal advice."]
    return "\n".join(lines)


def build_impact_messages(regulation: dict, reg_chunks: list[dict], policy_chunks: list[dict]) -> list[dict]:
    reg_text = "\n\n".join(c["content"].strip() for c in reg_chunks)
    def excerpt(c: dict) -> str:
        section = f' section="{c["heading"]}"' if c.get("heading") else ""
        return f'<excerpt id="{c["chunk_id"]}" policy="{c["title"]}"{section}>\n{c["content"].strip()}\n</excerpt>'

    pol_text = "\n\n".join(excerpt(c) for c in policy_chunks)
    header = f"{regulation['title']} ({regulation.get('regulator') or ''} {regulation.get('ref_no') or ''}, {regulation.get('published_at') or ''})"
    return [{
        "role": "user",
        "content": f"<new_regulation title=\"{header.strip()}\">\n{reg_text}\n</new_regulation>\n\n"
                   f"<internal_policies>\n{pol_text}\n</internal_policies>",
    }]


def parse_findings(text: str, valid_ids: set[int]) -> list[dict]:
    """Parse the model's JSON robustly (tolerates code fences / leading prose)."""
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    out = []
    for f in data.get("findings", []) if isinstance(data, dict) else []:
        try:
            pid = int(f.get("policy_excerpt_id"))
        except (TypeError, ValueError):
            continue
        sev = str(f.get("severity", "")).lower()
        if pid not in valid_ids or sev not in {"high", "medium", "low"} or not f.get("summary"):
            continue
        out.append({
            "policy_chunk_id": pid,
            "severity": sev,
            "summary": str(f["summary"])[:500],
            "recommendation": str(f.get("recommendation") or "")[:1000],
            "regulation_quote": str(f.get("regulation_quote") or "")[:500],
        })
    return out
