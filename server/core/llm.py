# server/core/llm.py
"""统一 LLM 调用工具"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from server.core.settings import Settings

logger = logging.getLogger(__name__)


@dataclass
class LLMUsage:
    """单次 LLM 调用的 token 用量"""
    model: str
    provider: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    agent_name: str


@dataclass
class LLMResponse:
    """LLM 响应"""
    text: str
    usage: LLMUsage | None


async def call_llm(
    settings: Settings,
    section: str,
    prompt: str,
    agent_name: str = "",
    image_base64: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> LLMResponse:
    """统一 LLM 调用入口"""
    section_data = getattr(settings, section, {})
    provider = section_data.get("provider", "openai")
    model_name = section_data.get("name", "gpt-4o")
    temp = temperature if temperature is not None else section_data.get("temperature", 0.1)
    max_tok = max_tokens if max_tokens is not None else section_data.get("max_tokens", 4096)

    client = settings.create_llm_client(section)

    openai_compatible = {"openai", "qianwen", "zhipu"}

    if provider in openai_compatible:
        return await _call_openai_compatible(client, model_name, provider, prompt, image_base64, temp, max_tok, agent_name)
    elif provider == "anthropic":
        return await _call_anthropic(client, model_name, provider, prompt, image_base64, max_tok, agent_name)
    else:
        raise ValueError(f"不支持的 provider: {provider}")


async def _call_openai_compatible(client, model_name, provider, prompt, image_base64, temperature, max_tokens, agent_name) -> LLMResponse:
    def _sync():
        if image_base64:
            content = [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_base64}"}},
            ]
        else:
            content = prompt

        response = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": content}],
            temperature=temperature,
            max_tokens=max_tokens,
        )

        text = response.choices[0].message.content
        usage = None
        if response.usage:
            usage = LLMUsage(
                model=model_name, provider=provider,
                prompt_tokens=response.usage.prompt_tokens or 0,
                completion_tokens=response.usage.completion_tokens or 0,
                total_tokens=response.usage.total_tokens or 0,
                agent_name=agent_name,
            )
        return text, usage

    text, usage = await asyncio.to_thread(_sync)
    if usage:
        logger.info(f"[{agent_name}] {provider}/{model_name} tokens: {usage.prompt_tokens}+{usage.completion_tokens}={usage.total_tokens}")
    return LLMResponse(text=text, usage=usage)


async def _call_anthropic(client, model_name, provider, prompt, image_base64, max_tokens, agent_name) -> LLMResponse:
    def _sync():
        if image_base64:
            content = [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image_base64}},
                {"type": "text", "text": prompt},
            ]
        else:
            content = prompt

        message = client.messages.create(
            model=model_name, max_tokens=max_tokens,
            messages=[{"role": "user", "content": content}],
        )

        text = message.content[0].text
        usage = None
        if message.usage:
            prompt_tok = message.usage.input_tokens or 0
            completion_tok = message.usage.output_tokens or 0
            usage = LLMUsage(
                model=model_name, provider=provider,
                prompt_tokens=prompt_tok, completion_tokens=completion_tok,
                total_tokens=prompt_tok + completion_tok, agent_name=agent_name,
            )
        return text, usage

    text, usage = await asyncio.to_thread(_sync)
    if usage:
        logger.info(f"[{agent_name}] {provider}/{model_name} tokens: {usage.prompt_tokens}+{usage.completion_tokens}={usage.total_tokens}")
    return LLMResponse(text=text, usage=usage)
