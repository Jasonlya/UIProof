# server/agents/planner.py
"""执行计划生成 Agent — 将数据库中的用例转换为可执行计划"""
from __future__ import annotations

import logging
import re as _re

from server.core.prompts import load_prompt
from server.core.settings import Settings
from server.core.json_utils import safe_json_parse
from server.core.llm import LLMUsage, call_llm

logger = logging.getLogger(__name__)

# 轻量级 ActionStep 模型
class ActionStep:
    """执行步骤"""
    __slots__ = ("action", "target", "value", "selector", "timeout", "x", "y")

    def __init__(self, action: str, target: str | None = None, value: str | None = None,
                 selector: str | None = None, timeout: int = 5000,
                 x: float | None = None, y: float | None = None):
        self.action = action
        self.target = target
        self.value = value
        self.selector = selector
        self.timeout = timeout
        self.x = x
        self.y = y


def steps_from_json(steps_data: list[dict]) -> list[ActionStep]:
    """从数据库 JSON 格式的步骤数据转换为 ActionStep 列表

    这是集成后的核心转换函数：DB 中的步骤格式 -> LangGraph 执行格式
    """
    result = []
    for s in steps_data:
        step_type = s.get("type", "click")
        result.append(ActionStep(
            action=step_type,
            target=s.get("description") or s.get("selector", ""),
            value=s.get("value", ""),
            selector=s.get("selector"),
            timeout=s.get("timeout", 5000),
            x=s.get("coordinates", {}).get("x") if s.get("coordinates") else None,
            y=s.get("coordinates", {}).get("y") if s.get("coordinates") else None,
        ))
    return result


def steps_from_text(step_texts: list[str]) -> list[ActionStep]:
    """从文本步骤描述转换为 ActionStep 列表（兼容 Excel 导入的自然语言格式）"""
    plan = _try_parse_structured_steps(step_texts)
    if plan is not None:
        return plan
    return []


async def plan_node(state: dict) -> dict:
    """LangGraph 节点: 为当前用例生成执行计划"""
    settings: Settings = state.get("settings")
    current_case = state.get("current_case")

    if not current_case:
        logger.warning("无当前用例，跳过计划生成")
        return {"plan": [], "current_step_index": 0}

    # 如果 plan 已有数据（来自 DB 解析），直接使用
    existing_plan = state.get("plan", [])
    if existing_plan:
        return {"current_step_index": 0}

    # 否则从 steps 文本生成
    steps = current_case.get("steps", []) if isinstance(current_case, dict) else getattr(current_case, "steps", [])
    case_name = current_case.get("name", "") if isinstance(current_case, dict) else getattr(current_case, "name", "")

    logger.info(f"生成执行计划: {case_name}")

    plan = _try_parse_structured_steps(steps)
    llm_usages: list[LLMUsage] = []

    if plan is None:
        plan, usage = await _generate_plan_with_llm(settings, current_case)
        if usage:
            llm_usages.append(usage)

    if not plan:
        logger.error(f"无法为用例生成执行计划")
        return {"plan": [], "current_step_index": 0, "llm_usage": llm_usages}

    logger.info(f"执行计划: {len(plan)} 个步骤")
    return {"plan": plan, "current_step_index": 0, "llm_usage": llm_usages}


def _try_parse_structured_steps(steps: list[str]) -> list[ActionStep] | None:
    valid_actions = {"click", "type", "scroll", "wait", "navigate", "assert"}
    cn_actions = {
        "打开": "navigate", "访问": "navigate", "输入": "type",
        "等待": "wait", "点击": "click", "滚动": "scroll",
    }
    result = []

    for step_text in steps:
        step_text = step_text.strip() if isinstance(step_text, str) else str(step_text).strip()
        if not step_text:
            return None

        stripped = _re.sub(r'^\d+\.\s*', '', step_text)
        parts = stripped.split(None, 1)
        action = parts[0].lower()
        rest = parts[1] if len(parts) > 1 else ""

        if action in valid_actions:
            pass
        else:
            matched = False
            for cn, en in cn_actions.items():
                if stripped.startswith(cn):
                    action = en
                    rest = stripped[len(cn):].strip()
                    matched = True
                    break
            if not matched:
                return None

        x, y = None, None
        coord_match = _re.search(r'@(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$', rest)
        if coord_match:
            x, y = float(coord_match.group(1)), float(coord_match.group(2))
            rest = rest[:coord_match.start()].strip()

        if action == "click":
            result.append(ActionStep(action="click", target=rest, x=x, y=y))
        elif action == "type":
            type_parts = rest.split(None, 1)
            if len(type_parts) >= 2:
                result.append(ActionStep(action="type", target=type_parts[0], value=type_parts[1]))
            else:
                result.append(ActionStep(action="type", value=rest))
        elif action == "navigate":
            result.append(ActionStep(action="navigate", value=rest))
        elif action == "wait":
            wait_match = _re.search(r'(\d+)\s*秒?', rest)
            if wait_match:
                num = int(wait_match.group(1))
                timeout = num * 1000 if num < 100 else num
            elif rest.isdigit():
                num = int(rest)
                timeout = num * 1000 if num < 100 else num
            else:
                timeout = 2000
            result.append(ActionStep(action="wait", timeout=timeout))
        elif action == "scroll":
            delta = int(rest) if rest.lstrip("-").isdigit() else 300
            result.append(ActionStep(action="scroll", value=str(delta)))
        elif action == "assert":
            result.append(ActionStep(action="assert", target=rest))

    return result if result else None


async def _generate_plan_with_llm(settings: Settings, case) -> tuple[list[ActionStep], LLMUsage | None]:
    try:
        # 兼容 dict 和 object 两种 case 格式
        if isinstance(case, dict):
            case_id = case.get("id", "unknown")
            case_name = case.get("name", "unknown")
            steps = case.get("steps", [])
            expected = case.get("expected", "")
        else:
            case_id = getattr(case, "id", "unknown")
            case_name = getattr(case, "name", "unknown")
            steps = getattr(case, "steps", [])
            expected = getattr(case, "expected", "")

        prompt = load_prompt(
            "planner",
            case_id=case_id,
            case_name=case_name,
            steps_description="\n".join(f"  {i + 1}. {s}" for i, s in enumerate(steps)),
            expected=expected,
        )

        response = await call_llm(
            settings=settings, section="model",
            prompt=prompt, agent_name="planner",
        )

        parsed = safe_json_parse(response.text)
        if not parsed or not isinstance(parsed, list):
            logger.error(f"LLM 返回格式错误: {response.text[:200]}")
            return [], response.usage

        plan = [
            ActionStep(
                action=step.get("action", "click"),
                target=step.get("target"),
                value=step.get("value"),
                selector=None,
                timeout=step.get("timeout", 5000),
            )
            for step in parsed
        ]
        return plan, response.usage

    except Exception as e:
        logger.error(f"LLM 计划生成失败: {e}")
        return [], None
