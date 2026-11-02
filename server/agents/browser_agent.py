# server/agents/browser_agent.py
"""浏览器操作 Agent — 通过 Playwright 执行页面动作"""
from __future__ import annotations

import logging
import time

from server.agents.vision_agent import VisionAgent
from server.mcp.playwright_client import PlaywrightMCP
from server.mcp.tools import ToolAgent
from server.agents.planner import ActionStep
from server.core.llm import LLMUsage

logger = logging.getLogger(__name__)


# 轻量级步骤结果模型
class StepResult:
    __slots__ = ("step_index", "action", "success", "screenshot", "error", "duration_ms")

    def __init__(self, step_index: int, action: str, success: bool,
                 screenshot: bytes, error: str | None = None, duration_ms: int = 0):
        self.step_index = step_index
        self.action = action
        self.success = success
        self.screenshot = screenshot
        self.error = error
        self.duration_ms = duration_ms

    def to_dict(self) -> dict:
        return {
            "step_index": self.step_index,
            "action": self.action,
            "success": self.success,
            "error": self.error,
            "duration_ms": self.duration_ms,
        }


class BrowserAgent:
    """Browser Agent — 执行浏览器操作"""

    def __init__(self, mcp: PlaywrightMCP, vision: VisionAgent, tool: ToolAgent):
        self.mcp = mcp
        self.vision = vision
        self.tool = tool

    async def execute_step(
        self, step: ActionStep, session_id: str, step_index: int,
    ) -> tuple[StepResult, LLMUsage | None]:
        start_time = time.time()
        error = None
        success = False
        usage = None

        try:
            if step.action == "click":
                success, usage = await self._do_click(step)
            elif step.action == "type":
                success = await self._do_type(step)
            elif step.action == "navigate":
                success = await self._do_navigate(step)
            elif step.action == "wait":
                success = await self._do_wait(step)
            elif step.action == "scroll":
                success = await self._do_scroll(step)
            elif step.action == "assert":
                success = True
            else:
                error = f"未知操作类型: {step.action}"
                logger.error(error)
        except Exception as e:
            error = str(e)
            logger.error(f"步骤 {step_index} 执行异常: {e}")

        screenshot = await self.mcp.screenshot()
        await self.tool.save_step_screenshot(screenshot, session_id, step_index)

        duration_ms = int((time.time() - start_time) * 1000)

        result = StepResult(
            step_index=step_index, action=step.action,
            success=success, screenshot=screenshot,
            error=error, duration_ms=duration_ms,
        )
        return result, usage

    async def _do_click(self, step: ActionStep) -> tuple[bool, LLMUsage | None]:
        # 优先级: 录制坐标 > CSS selector > Vision Agent
        if step.x is not None and step.y is not None:
            await self.mcp.click(step.x, step.y)
            logger.info(f"使用录制坐标点击: ({step.x}, {step.y})")
            return True, None

        if step.selector:
            await self.mcp.page.click(step.selector, timeout=step.timeout)
            return True, None

        # 降级到 Vision Agent
        await self.mcp.wait_for_timeout(500)
        screenshot = await self.mcp.screenshot()
        pos = await self.vision.locate_element(screenshot, step.target or "")

        usage = pos.pop("_usage", None) if isinstance(pos, dict) else None

        if pos.get("x", -1) < 0:
            raise RuntimeError(f"无法定位元素: {step.target}")

        await self.mcp.click(pos["x"], pos["y"])
        return True, usage

    async def _do_type(self, step: ActionStep) -> bool:
        if step.selector:
            await self.mcp.page.fill(step.selector, step.value or "", timeout=step.timeout)
        else:
            await self.mcp.type_text(step.value or "")
        return True

    async def _do_navigate(self, step: ActionStep) -> bool:
        url = step.value or step.target or ""
        if not url:
            raise ValueError("navigate 步骤缺少 URL")
        await self.mcp.navigate(url)
        return True

    async def _do_wait(self, step: ActionStep) -> bool:
        await self.mcp.wait_for_timeout(step.timeout)
        return True

    async def _do_scroll(self, step: ActionStep) -> bool:
        delta = int(step.value) if step.value and step.value.lstrip("-").isdigit() else 300
        await self.mcp.scroll(delta_y=delta)
        return True


async def execute_node(state: dict) -> dict:
    """LangGraph 节点: 执行当前步骤"""
    plan = state.get("plan", [])
    step_index = state.get("current_step_index", 0)

    if step_index >= len(plan):
        logger.warning(f"步骤索引 {step_index} 超出计划范围 {len(plan)}")
        return {}

    step = plan[step_index]
    browser_agent: BrowserAgent | None = state.get("browser_agent")
    session_id = state.get("session_id", "unknown")

    if not browser_agent:
        logger.error("BrowserAgent 未初始化")
        return {}

    logger.info(f"执行步骤 {step_index}/{len(plan)}: {step.action} {step.target or step.value or ''}")

    result, usage = await browser_agent.execute_step(step, session_id, step_index)

    step_results = list(state.get("step_results", []))
    step_results.append(result)

    screenshots = list(state.get("screenshots", []))
    screenshots.append(result.screenshot)

    llm_usages = list(state.get("llm_usage", []))
    if usage:
        llm_usages.append(usage)

    # 推送进度到 SSE 队列（如果有的话）
    progress_queue = state.get("progress_queue")
    if progress_queue:
        import asyncio
        try:
            progress_queue.put_nowait({
                "type": "step_complete",
                "step_index": step_index,
                "total_steps": len(plan),
                "action": step.action,
                "success": result.success,
                "error": result.error,
                "duration_ms": result.duration_ms,
            })
        except Exception:
            pass

    return {
        "step_results": step_results,
        "screenshots": screenshots,
        "llm_usage": llm_usages,
    }
