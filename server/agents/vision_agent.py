# server/agents/vision_agent.py
"""视觉定位 Agent — 用多模态 LLM 识别页面元素坐标"""
from __future__ import annotations

import asyncio
import logging

from server.core.prompts import load_prompt
from server.core.settings import Settings
from server.core.image_utils import encode_image
from server.core.json_utils import safe_json_parse
from server.core.llm import LLMResponse, call_llm

logger = logging.getLogger(__name__)


class VisionAgent:
    """视觉定位 Agent — 用多模态 LLM 识别页面元素坐标"""

    def __init__(self, settings: Settings):
        self.settings = settings

    async def locate_element(self, screenshot: bytes, target: str, max_retries: int = 3) -> dict:
        """在截图中定位目标元素，返回坐标 + usage"""
        prompt = load_prompt("vision", target=target)

        for attempt in range(max_retries):
            try:
                base64_image = encode_image(screenshot)
                response: LLMResponse = await call_llm(
                    settings=self.settings,
                    section="vision",
                    prompt=prompt,
                    agent_name="vision",
                    image_base64=base64_image,
                    max_tokens=500,
                )

                result = safe_json_parse(response.text)
                if result and result.get("x", -1) >= 0:
                    logger.info(
                        f"定位成功: {target} -> ({result['x']}, {result['y']}) "
                        f"confidence={result.get('confidence', 0)}"
                    )
                    if response.usage:
                        result["_usage"] = response.usage
                    return result

                logger.warning(f"定位失败(尝试 {attempt + 1}/{max_retries}): {target}")
            except Exception as e:
                logger.error(f"Vision 调用异常(尝试 {attempt + 1}/{max_retries}): {e}")

            if attempt < max_retries - 1:
                await asyncio.sleep(1)

        return {"x": -1, "y": -1, "confidence": 0, "description": f"未找到: {target}"}

    async def describe_element(self, screenshot: bytes) -> str:
        """用 Vision Agent 描述截图中的元素（用于录制时增强描述）"""
        prompt = load_prompt("vision_record")
        base64_image = encode_image(screenshot)

        try:
            response = await call_llm(
                settings=self.settings,
                section="vision",
                prompt=prompt,
                agent_name="vision_describe",
                image_base64=base64_image,
                max_tokens=200,
            )
            return response.text.strip()
        except Exception as e:
            logger.error(f"元素描述失败: {e}")
            return ""
