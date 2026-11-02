# server/core/pipeline.py
"""LangGraph 测试流水线 — 编排规划、执行、断言和报告节点"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import TypedDict

from langgraph.graph import END, StateGraph

from server.agents.assert_agent import assert_node
from server.agents.browser_agent import BrowserAgent, execute_node
from server.agents.planner import plan_node, steps_from_json, steps_from_text
from server.agents.report_agent import report_node
from server.agents.vision_agent import VisionAgent
from server.core.settings import Settings
from server.mcp.playwright_client import create_browser
from server.mcp.tools import ToolAgent
from server.core.llm import LLMUsage

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


class TestState(TypedDict, total=False):
    # 输入
    case_file: str
    cases: list
    current_case: object
    current_step_index: int

    # 执行
    plan: list
    screenshots: list
    page_url: str

    # 结果
    step_results: list
    assertion_results: list
    final_result: str
    report_path: str

    # 追踪
    trace_id: str
    session_id: str

    # LLM 用量
    llm_usage: list

    # 内部引用
    settings: Settings
    browser_agent: BrowserAgent

    # SSE 进度推送
    progress_queue: asyncio.Queue


def should_continue(state: dict) -> str:
    plan = state.get("plan", [])
    step_index = state.get("current_step_index", 0)
    if not plan:
        return "report"
    if step_index < len(plan):
        return "execute"
    return "report"


def increment_step(state: dict) -> dict:
    return {"current_step_index": state.get("current_step_index", 0) + 1}


def build_graph() -> StateGraph:
    """构建 LangGraph 测试流水线"""
    graph = StateGraph(TestState)

    graph.add_node("parse", _parse_node)
    graph.add_node("plan", plan_node)
    graph.add_node("execute", execute_node)
    graph.add_node("assert", assert_node)
    graph.add_node("increment", increment_step)
    graph.add_node("report", report_node)

    graph.set_entry_point("parse")

    graph.add_edge("parse", "plan")
    graph.add_edge("plan", "execute")
    graph.add_edge("execute", "assert")
    graph.add_edge("assert", "increment")

    graph.add_conditional_edges(
        "increment",
        should_continue,
        {"execute": "execute", "report": "report"},
    )

    graph.add_edge("report", END)

    return graph


def _parse_node(state: dict) -> dict:
    """解析节点 — 集成后数据来自 DB，此处直接透传"""
    # 集成后，case 数据已经从数据库读取并解析好了
    # plan 已经准备好就直接用，否则在 plan_node 中生成
    return {}


# ──────────────────────────────────────────────
# 高级 API：从数据库用例运行测试
# ──────────────────────────────────────────────

async def run_case_from_db(
    case_data: dict,
    settings: Settings | None = None,
    progress_queue: asyncio.Queue | None = None,
) -> dict:
    """从数据库用例数据运行单条测试

    Args:
        case_data: 数据库中的用例数据，格式:
            {
                "id": "case-uuid",
                "name": "测试用例名",
                "steps": [{"type":"click","selector":"...","coordinates":{"x":1,"y":2}, ...}],
                "expected": "预期结果",
                "setup_steps": [{"type":"navigate","value":"https://..."}],
            }
        settings: AI 配置（可选，默认自动加载）
        progress_queue: SSE 进度推送队列（可选）

    Returns:
        执行结果字典
    """
    if settings is None:
        settings = Settings.load()

    mcp = await create_browser(settings.browser)
    all_results = []

    try:
        vision = VisionAgent(settings)
        tool = ToolAgent(screenshots_dir="screenshots", logs_dir="logs")
        browser_agent = BrowserAgent(mcp=mcp, vision=vision, tool=tool)

        graph = build_graph()
        app = graph.compile()

        session_id = uuid.uuid4().hex[:12]
        logger.info(f"开始执行用例: {case_data.get('name', 'unknown')}, session={session_id}")

        # 解析步骤：优先使用 JSON 格式，降级到文本格式
        steps_data = case_data.get("steps", [])
        plan = []

        if isinstance(steps_data, list) and steps_data:
            if isinstance(steps_data[0], dict):
                # DB JSON 格式
                plan = steps_from_json(steps_data)
            elif isinstance(steps_data[0], str):
                # 文本格式
                plan = steps_from_text(steps_data)

        # 执行前置条件
        setup_steps = case_data.get("setup_steps", [])
        if setup_steps:
            if isinstance(setup_steps[0], dict):
                setup_plan = steps_from_json(setup_steps)
            else:
                setup_plan = steps_from_text(setup_steps)

            for i, step in enumerate(setup_plan):
                logger.info(f"  前置步骤 {i + 1}/{len(setup_plan)}: {step.action}")
                result, usage = await browser_agent.execute_step(step, session_id, f"setup_{i}")
                if not result.success:
                    raise RuntimeError(f"前置条件执行失败: {result.error}")

        initial_state = {
            "settings": settings,
            "browser_agent": browser_agent,
            "session_id": session_id,
            "trace_id": uuid.uuid4().hex,
            "current_case": case_data,
            "current_step_index": 0,
            "step_results": [],
            "assertion_results": [],
            "screenshots": [],
            "llm_usage": [],
            "plan": plan,
            "progress_queue": progress_queue,
        }

        result = await app.ainvoke(initial_state)
        result["case"] = case_data
        all_results.append(result)

        logger.info(f"用例结果: {result.get('final_result', 'unknown')}")

        await mcp.close()
        if mcp.video_path:
            logger.info(f"录屏文件: {mcp.video_path}")

        return result

    except Exception:
        await mcp.close()
        raise


async def run_cases_batch(
    cases: list[dict],
    settings: Settings | None = None,
    progress_queue: asyncio.Queue | None = None,
) -> list[dict]:
    """批量执行多条用例（共享浏览器会话）"""
    if settings is None:
        settings = Settings.load()

    mcp = await create_browser(settings.browser)
    all_results = []

    try:
        vision = VisionAgent(settings)
        tool = ToolAgent(screenshots_dir="screenshots", logs_dir="logs")
        browser_agent = BrowserAgent(mcp=mcp, vision=vision, tool=tool)

        graph = build_graph()
        app = graph.compile()

        session_id = uuid.uuid4().hex[:12]

        # 共享前置条件
        if cases:
            setup_steps = cases[0].get("setup_steps", [])
            if setup_steps:
                if isinstance(setup_steps[0], dict):
                    setup_plan = steps_from_json(setup_steps)
                else:
                    setup_plan = steps_from_text(setup_steps)

                for i, step in enumerate(setup_plan):
                    logger.info(f"  前置步骤 {i + 1}/{len(setup_plan)}: {step.action}")
                    result, usage = await browser_agent.execute_step(step, session_id, f"setup_{i}")
                    if not result.success:
                        raise RuntimeError(f"前置条件执行失败: {result.error}")

        for idx, case_data in enumerate(cases):
            logger.info(f"\n{'='*60}")
            logger.info(f"用例 {idx + 1}/{len(cases)}: {case_data.get('name', 'unknown')}")
            logger.info(f"{'='*60}")

            steps_data = case_data.get("steps", [])
            plan = []
            if isinstance(steps_data, list) and steps_data:
                if isinstance(steps_data[0], dict):
                    plan = steps_from_json(steps_data)
                elif isinstance(steps_data[0], str):
                    plan = steps_from_text(steps_data)

            initial_state = {
                "settings": settings,
                "browser_agent": browser_agent,
                "session_id": session_id,
                "trace_id": uuid.uuid4().hex,
                "current_case": case_data,
                "current_step_index": 0,
                "step_results": [],
                "assertion_results": [],
                "screenshots": [],
                "llm_usage": [],
                "plan": plan,
                "progress_queue": progress_queue,
            }

            result = await app.ainvoke(initial_state)
            result["case"] = case_data
            all_results.append(result)

            logger.info(f"用例结果: {result.get('final_result', 'unknown')}")

            # 推送批量进度
            if progress_queue:
                try:
                    progress_queue.put_nowait({
                        "type": "case_complete",
                        "case_index": idx + 1,
                        "total_cases": len(cases),
                        "case_name": case_data.get("name", ""),
                        "final_result": result.get("final_result", "unknown"),
                    })
                except Exception:
                    pass

        await mcp.close()

        passed = sum(1 for r in all_results if r.get("final_result") == "pass")
        logger.info(f"\n{'='*60}")
        logger.info(f"测试完成: {passed}/{len(all_results)} 通过")
        logger.info(f"{'='*60}")

        return all_results

    except Exception:
        await mcp.close()
        raise
