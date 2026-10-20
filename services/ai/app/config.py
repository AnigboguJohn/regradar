import os
from dataclasses import dataclass, field


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


# OpenAI-compatible providers with a free option.
PRESETS = {
    "groq": {"base_url": "https://api.groq.com/openai/v1", "model": "llama-3.3-70b-versatile"},
    "gemini": {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-2.5-flash"},
    # host.docker.internal reaches Ollama on your own computer from inside Docker
    "ollama": {"base_url": "http://host.docker.internal:11434/v1", "model": "llama3.1:8b"},
}


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL", "postgresql://regradar:regradar@localhost:5432/regradar"))
    internal_token: str = field(default_factory=lambda: _env("INTERNAL_TOKEN", "dev-internal-token"))

    # Generation. Choose ONE:
    #   anthropic  - Claude (paid, best quality): ANTHROPIC_API_KEY
    #   groq       - free tier, no card: LLM_API_KEY from https://console.groq.com
    #   gemini     - free tier, no card: LLM_API_KEY from https://aistudio.google.com
    #   ollama     - free, runs on your own computer: no key
    # With none configured the service falls back to extractive answers (cited passages, no AI summary).
    anthropic_api_key: str = field(default_factory=lambda: _env("ANTHROPIC_API_KEY"))
    llm_provider_env: str = field(default_factory=lambda: _env("LLM_PROVIDER").lower())
    llm_api_key: str = field(default_factory=lambda: _env("LLM_API_KEY"))
    llm_model: str = field(default_factory=lambda: _env("LLM_MODEL"))
    llm_base_url_env: str = field(default_factory=lambda: _env("LLM_BASE_URL"))
    # Optional backup provider, used automatically when the main one fails or hits its rate limit.
    llm_fallback_provider: str = field(default_factory=lambda: _env("LLM_FALLBACK_PROVIDER").lower())
    llm_fallback_api_key: str = field(default_factory=lambda: _env("LLM_FALLBACK_API_KEY"))
    llm_fallback_base_url_env: str = field(default_factory=lambda: _env("LLM_FALLBACK_BASE_URL"))
    answer_model_env: str = field(default_factory=lambda: _env("ANSWER_MODEL"))
    impact_model_env: str = field(default_factory=lambda: _env("IMPACT_MODEL"))

    # Optional embeddings for hybrid search: "voyage" | "openai" | "" (keyword search only)
    embedding_provider: str = field(default_factory=lambda: _env("EMBEDDING_PROVIDER").lower())
    voyage_api_key: str = field(default_factory=lambda: _env("VOYAGE_API_KEY"))
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_API_KEY"))
    embedding_dim: int = 1024

    max_pdf_mb: int = field(default_factory=lambda: int(_env("MAX_PDF_MB", "25")))
    max_docs_per_run: int = field(default_factory=lambda: int(_env("MAX_DOCS_PER_RUN", "25")))
    user_agent: str = "RegRadarBot/1.0 (+compliance monitoring)"

    @property
    def llm_provider(self) -> str:
        """The active provider: explicit LLM_PROVIDER wins, else Claude if its key is set, else none."""
        if self.llm_provider_env in PRESETS or self.llm_provider_env == "anthropic":
            return self.llm_provider_env
        return "anthropic" if self.anthropic_api_key else ""

    @property
    def llm_enabled(self) -> bool:
        p = self.llm_provider
        if p == "anthropic":
            return bool(self.anthropic_api_key)
        if p == "ollama":
            return True
        return bool(p) and bool(self.llm_api_key)

    @property
    def llm_base_url(self) -> str:
        return (self.llm_base_url_env or PRESETS.get(self.llm_provider, {}).get("base_url", "")).rstrip("/")

    def _model(self, specific: str) -> str:
        if self.llm_provider == "anthropic":
            return specific or self.llm_model or "claude-sonnet-5-5"
        return self.llm_model or PRESETS.get(self.llm_provider, {}).get("model", "")

    @property
    def answer_model(self) -> str:
        return self._model(self.answer_model_env)

    @property
    def impact_model(self) -> str:
        return self._model(self.impact_model_env)

    @property
    def fallback_enabled(self) -> bool:
        p = self.llm_fallback_provider
        return p in PRESETS and (p == "ollama" or bool(self.llm_fallback_api_key)) and p != self.llm_provider

    @property
    def compact_prompts(self) -> bool:
        """Free tiers have small per-minute token limits, so send less context."""
        return self.llm_provider in PRESETS

    @property
    def embeddings_enabled(self) -> bool:
        return (self.embedding_provider == "voyage" and bool(self.voyage_api_key)) or (
            self.embedding_provider == "openai" and bool(self.openai_api_key))


settings = Settings()
