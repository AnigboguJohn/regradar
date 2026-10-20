"""LLM calls: Claude (Anthropic SDK) or any OpenAI-compatible API (Groq, Gemini, Ollama)."""
from __future__ import annotations

import logging
import time

import httpx

from .config import PRESETS, settings

log = logging.getLogger("regradar.llm")
_client = None


class LLMError(RuntimeError):
    """The model could not be reached or refused the request; callers fall back to extractive mode."""


def _anthropic(system: str, messages: list[dict], model: str, max_tokens: int) -> str:
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=3, timeout=120)
    resp = _client.messages.create(model=model, max_tokens=max_tokens, system=system, messages=messages)
    # Keep only text blocks (skip any thinking blocks).
    return "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text").strip()


def _openai_compatible(system: str, messages: list[dict], model: str, max_tokens: int,
                       provider: str, base_url: str, api_key: str, retries: int = 3) -> str:
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    body = {"model": model, "max_tokens": max_tokens, "temperature": 0.1,
            "messages": [{"role": "system", "content": system}, *messages]}
    url = f"{base_url}/chat/completions"
    for attempt in range(retries):
        r = httpx.post(url, json=body, headers=headers, timeout=180)
        if r.status_code == 429 and attempt < retries - 1:   # free-tier rate limit: wait and retry
            wait = min(float(r.headers.get("retry-after", "0") or 0) or 10 * (attempt + 1), 30)
            log.info("rate limited by %s, retrying in %.0fs", provider, wait)
            time.sleep(wait)
            continue
        if r.status_code >= 400:
            raise LLMError(f"{provider} returned {r.status_code}: {r.text[:300]}")
        choice = (r.json().get("choices") or [{}])[0]
        text = ((choice.get("message") or {}).get("content") or "").strip()
        if not text:
            raise LLMError(f"{provider} returned an empty answer")
        return text
    raise LLMError(f"{provider} rate limit: try again in a minute")


def _primary(system: str, messages: list[dict], model: str, max_tokens: int) -> str:
    if settings.llm_provider == "anthropic":
        return _anthropic(system, messages, model, max_tokens)
    # With a backup configured, don't wait long on the main provider's rate limit: switch instead.
    return _openai_compatible(system, messages, model, max_tokens, settings.llm_provider, settings.llm_base_url,
                              settings.llm_api_key, retries=1 if settings.fallback_enabled else 3)


def _fallback(system: str, messages: list[dict], max_tokens: int) -> str:
    p = settings.llm_fallback_provider
    preset = PRESETS[p]
    base_url = (settings.llm_fallback_base_url_env or preset["base_url"]).rstrip("/")
    return _openai_compatible(system, messages, preset["model"], max_tokens, p, base_url,
                              settings.llm_fallback_api_key)


def complete(system: str, messages: list[dict], model: str, max_tokens: int = 2000) -> str:
    try:
        return _primary(system, messages, model, max_tokens)
    except Exception as e:  # network errors, SDK errors, rate limits
        first = e if isinstance(e, LLMError) else LLMError(f"{settings.llm_provider or 'LLM'} unavailable: {e}")
    if settings.fallback_enabled:
        log.warning("%s failed (%s); trying backup provider %s", settings.llm_provider, first, settings.llm_fallback_provider)
        try:
            return _fallback(system, messages, max_tokens)
        except Exception as e:
            raise LLMError(f"both providers failed: {first}; {e}") from e
    raise first
