"""Check that your AI keys work:  docker compose exec ai python -m app.check_llm"""
from . import llm
from .config import PRESETS, settings


def main() -> None:
    print(f"Main provider:   {settings.llm_provider or 'none (free extractive mode)'}  model={settings.answer_model or '-'}")
    print(f"Backup provider: {settings.llm_fallback_provider if settings.fallback_enabled else 'none'}")
    if not settings.llm_enabled:
        print("No AI provider configured. Set LLM_PROVIDER and LLM_API_KEY in .env, then restart.")
        return
    msgs = [{"role": "user", "content": "Reply with exactly: RegRadar OK"}]
    try:
        print("Main provider says:  ", llm._primary("You are a test.", msgs, settings.answer_model, 20))
    except Exception as e:
        print("Main provider FAILED:", e)
    if settings.fallback_enabled:
        try:
            print("Backup provider says:", llm._fallback("You are a test.", msgs, 20))
        except Exception as e:
            print("Backup provider FAILED:", e)


if __name__ == "__main__":
    main()
