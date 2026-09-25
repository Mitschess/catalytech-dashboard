"""Claude integration for the RCA assistant (optional: the rest of the app works without credentials)."""
from __future__ import annotations

import os
from pathlib import Path
from typing import AsyncIterator

import anthropic

from .config import LLM_MODEL

_client: anthropic.AsyncAnthropic | None = None


def status() -> dict:
    configured = bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")
                      or (Path.home() / ".config" / "anthropic").exists())
    return {"available": configured, "model": LLM_MODEL}


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    return _client


async def stream_answer(system: str, messages: list[dict]) -> AsyncIterator[str]:
    """Stream Claude's answer as text chunks.

    Server-side refusal fallbacks are enabled ("default" routing), so a request declined by the
    requested model is re-run on Anthropic's recommended fallback model inside the same call.
    """
    async with client().beta.messages.stream(
        model=LLM_MODEL,
        max_tokens=16000,
        system=system,
        messages=messages,
        output_config={"effort": "medium"},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    ) as stream:
        async for text in stream.text_stream:
            yield text
        final = await stream.get_final_message()
    if final.stop_reason == "refusal":
        yield "\n\n_Model menolak menjawab permintaan ini. Ubah pertanyaannya._"
    elif final.stop_reason == "max_tokens":
        yield "\n\n_Jawaban terpotong karena batas panjang._"
