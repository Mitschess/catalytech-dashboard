"""LLM integration for the RCA assistant (optional: the rest of the app works without it).

Two providers, selected with CATALYTECH_LLM_PROVIDER:
  local  - an OpenAI-compatible server on this machine or the plant network (Ollama, LM Studio).
           Nothing leaves the network, and there is no API key or quota.
  claude - Anthropic's hosted API, needs ANTHROPIC_API_KEY.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import AsyncIterator

import httpx

from .config import LLM_BASE_URL, LLM_MAX_TOKENS, LLM_MODEL, LLM_PROVIDER, LLM_TIMEOUT

IS_LOCAL = LLM_PROVIDER == "local"

# Reachability of the local server, refreshed by probe(). None = not probed yet.
_reachable: bool | None = None
_detail = ""


def _claude_configured() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")
                or (Path.home() / ".config" / "anthropic").exists())


def status() -> dict:
    """Cheap, synchronous: called on every snapshot, so it never touches the network."""
    if not IS_LOCAL:
        return {"available": _claude_configured(), "model": LLM_MODEL, "provider": "claude", "detail": _detail}
    return {"available": _reachable is not False, "model": LLM_MODEL, "provider": "local",
            "endpoint": LLM_BASE_URL, "detail": _detail}


async def probe() -> None:
    """Ask the local server which models it has. Called at startup and before each analysis."""
    global _reachable, _detail
    if not IS_LOCAL:
        _detail = "" if _claude_configured() else "ANTHROPIC_API_KEY belum diisi di backend/.env."
        return
    try:
        async with httpx.AsyncClient(timeout=4.0) as c:
            r = await c.get(f"{LLM_BASE_URL}/models")
            r.raise_for_status()
            names = [m.get("id", "") for m in r.json().get("data", [])]
    except Exception:
        _reachable, _detail = False, (
            f"Server LLM lokal di {LLM_BASE_URL} tidak menjawab. Jalankan Ollama, lalu muat model dengan "
            f"'ollama pull {LLM_MODEL}'.")
        return
    if names and LLM_MODEL not in names:
        _reachable, _detail = False, (
            f"Server lokal aktif tetapi model '{LLM_MODEL}' belum ada. Jalankan 'ollama pull {LLM_MODEL}', "
            f"atau ganti CATALYTECH_LLM_MODEL ke salah satu dari: {', '.join(names[:6])}.")
        return
    _reachable, _detail = True, ""


class LLMError(RuntimeError):
    """Message is already written in Bahasa Indonesia and safe to show the engineer."""


async def stream_answer(system: str, messages: list[dict]) -> AsyncIterator[str]:
    if IS_LOCAL:
        async for chunk in _stream_local(system, messages):
            yield chunk
    else:
        async for chunk in _stream_claude(system, messages):
            yield chunk


# ------------------------------------------------------------------ local (Ollama / LM Studio)
async def _stream_local(system: str, messages: list[dict]) -> AsyncIterator[str]:
    """Stream from an OpenAI-compatible /chat/completions endpoint."""
    body = {"model": LLM_MODEL, "stream": True, "max_tokens": LLM_MAX_TOKENS, "temperature": 0.2,
            "messages": [{"role": "system", "content": system}, *messages]}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(LLM_TIMEOUT, connect=5.0)) as c:
            async with c.stream("POST", f"{LLM_BASE_URL}/chat/completions", json=body) as r:
                if r.status_code >= 400:
                    await r.aread()
                    raise LLMError(_local_http_error(r.status_code, r.text))
                async for line in r.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        delta = json.loads(payload)["choices"][0].get("delta", {})
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
                    if text := delta.get("content"):
                        yield text
    except httpx.ConnectError:
        raise LLMError(f"Tidak bisa terhubung ke server LLM lokal di {LLM_BASE_URL}. Pastikan Ollama sedang jalan.")
    except httpx.ReadTimeout:
        raise LLMError("Server LLM lokal terlalu lama menjawab. Coba model yang lebih kecil, atau naikkan "
                       "CATALYTECH_LLM_TIMEOUT di backend/.env.")


def _local_http_error(code: int, text: str) -> str:
    if code == 404:
        return f"Model '{LLM_MODEL}' tidak ditemukan di server lokal. Jalankan 'ollama pull {LLM_MODEL}'."
    return f"Server LLM lokal mengembalikan error {code}. {text[:200]}"


# ------------------------------------------------------------------ claude (hosted)
async def _stream_claude(system: str, messages: list[dict]) -> AsyncIterator[str]:
    import anthropic

    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    try:
        async with _client.beta.messages.stream(
            model=LLM_MODEL,
            max_tokens=LLM_MAX_TOKENS,
            system=system,
            messages=messages,
            output_config={"effort": "medium"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as stream:
            async for text in stream.text_stream:
                yield text
            final = await stream.get_final_message()
    except anthropic.AuthenticationError:
        raise LLMError("Kredensial Claude tidak valid. Periksa ANTHROPIC_API_KEY.")
    except anthropic.PermissionDeniedError:
        raise LLMError("Kredensial tidak punya akses ke model ini.")
    except anthropic.RateLimitError:
        raise LLMError("Terlalu banyak permintaan ke Claude. Coba lagi sebentar lagi.")
    except anthropic.APIConnectionError:
        raise LLMError("Tidak bisa terhubung ke Claude API. Periksa koneksi internet.")
    except anthropic.APIStatusError as e:
        raise LLMError(f"Claude API mengembalikan error {e.status_code}. Coba lagi.")
    if final.stop_reason == "refusal":
        yield "\n\n_Model menolak menjawab permintaan ini. Ubah pertanyaannya._"
    elif final.stop_reason == "max_tokens":
        yield "\n\n_Jawaban terpotong karena batas panjang._"


_client = None
