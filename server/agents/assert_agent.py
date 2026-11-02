# server/agents/assert_agent.py
"""AI 断言 Agent — 校验页面状态与预期结果"""
from __future__ import annotations

import logging

from server.core.prompts import load_prompt
from server.core.settings import Settings
from server.core.image_utils import encode_image
from server.core.json_utils import safe_json_parse
from server.core.llm import LLMResponse, LLMUsage, call_llm

logger = logging.getLogger(__name__)


class AssertionResult:
    __slots__ = ("step_index", "expected", "actual", "passed", "confidence", "reason")

    def __init__(self, step_index: int, expected: str, actual: str,
                 passed: bool, confidence: float, reason: str):
        self.step_index = step_index
        self.expected = expected
        self.actual = actual
        self.passed = passed
        self.confidence = confidence
        self.reason = reason

    def to_dict(self) -> dict:
        return {
            "step_index": self.step_index,
            "expected": self.expected,
            "actual": self.actual,
            "passed": self.passed,
            "confidence": self.confidence,
            "reason": self.reason,
        }


async def assert_node(state: dict) -> dict:
    """LangGraph 节点: AI 断言"""
    settings: Settings = state.get("settings")
    current_case = state.get("current_case")
    screenshots = state.get("screenshots", [])
    step_index = state.get("current_step_index", 0)

    if not current_case:
        logger.warning("无当前用例，跳过断言")
        return {}

    expected = current_case.get("expected", "") if isinstance(current_case, dict) else getattr(current_case, "expected", "")
    if not expected:
        logger.info("无预期结果，跳过断言")
        return {}

    if not screenshots:
        logger.warning("无截图可用，跳过断言")
        return {}

    screenshot = screenshots[-1]
    logger.info(f"执行 AI 断言: 预期='{expected}'")

    result, usage = await _run_assertion(settings, screenshot, expected, step_index)

    assertion_results = list(state.get("assertion_results", []))
    assertion_results.append(result)

    llm_usages = list(state.get("llm_usage", []))
    if usage:
        llm_usages.append(usage)

    if result.passed:
        logger.info(f"断言通过 (confidence={result.confidence}): {result.reason}")
    elif result.confidence < 0.7:
        logger.warning(f"断言不确定 (confidence={result.confidence}): {result.reason}")
    else:
        logger.error(f"断言失败: {result.reason}")

    return {"assertion_results": assertion_results, "llm_usage": llm_usages}


async def _run_assertion(
    settings: Settings, screenshot: bytes, expected: str,
    step_index: int, max_retries: int = 2,
) -> tuple[AssertionResult, LLMUsage | None]:
    prompt = load_prompt("assert", expected=expected)
    base64_image = encode_image(screenshot)

    for attempt in range(max_retries):
        try:
            response: LLMResponse = await call_llm(
                settings=settings, section="model",
                prompt=prompt, agent_name="assertion",
                image_base64=base64_image, max_tokens=500,
            )

            parsed = safe_json_parse(response.text)
            if parsed and isinstance(parsed, dict):
                return AssertionResult(
                    step_index=step_index, expected=expected,
                    actual=parsed.get("actual", ""),
                    passed=parsed.get("passed", False),
                    confidence=parsed.get("confidence", 0.0),
                    reason=parsed.get("reason", ""),
                ), response.usage

        except Exception as e:
            logger.error(f"断言调用异常(尝试 {attempt + 1}/{max_retries}): {e}")

    return AssertionResult(
        step_index=step_index, expected=expected,
        actual="断言调用失败", passed=False,
        confidence=0.0, reason="LLM 调用失败",
    ), None
