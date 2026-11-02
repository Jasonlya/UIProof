# server/routes/ai_service.py
"""AI 服务路由 — Vision 定位、AI 断言、自愈、用例生成"""
from flask import Blueprint, request, jsonify
from models.models import db, TestCase
import asyncio
import base64
import json
import logging

logger = logging.getLogger(__name__)

bp = Blueprint('ai_service', __name__, url_prefix='/api/ai')


@bp.route('/vision', methods=['POST'])
def vision_locate():
    """Vision Agent 元素定位 — 给截图和目标描述，返回坐标"""
    data = request.get_json() or {}
    image_data = data.get("image")  # base64
    target = data.get("target", "")

    if not image_data:
        return jsonify({"error": "缺少图片数据"}), 400
    if not target:
        return jsonify({"error": "缺少目标描述"}), 400

    try:
        loop = asyncio.new_event_loop()
        result = loop.run_until_complete(_locate_async(image_data, target))
        loop.close()
        return jsonify(result)
    except Exception as e:
        logger.error(f"Vision 定位失败: {e}")
        return jsonify({"error": str(e)}), 500


async def _locate_async(image_base64: str, target: str) -> dict:
    from server.core.settings import Settings
    from server.agents.vision_agent import VisionAgent

    settings = Settings.load()
    vision = VisionAgent(settings)
    image_bytes = base64.b64decode(image_base64)

    result = await vision.locate_element(image_bytes, target)
    # 移除内部的 _usage 字段
    result.pop("_usage", None)
    return result


@bp.route('/assert', methods=['POST'])
def ai_assert():
    """AI 断言 — 对比截图与预期结果"""
    data = request.get_json() or {}
    image_data = data.get("image")  # base64
    expected = data.get("expected", "")
    step_index = data.get("step_index", 0)

    if not image_data or not expected:
        return jsonify({"error": "缺少图片或预期结果"}), 400

    try:
        loop = asyncio.new_event_loop()
        result = loop.run_until_complete(_assert_async(image_data, expected, step_index))
        loop.close()
        return jsonify(result)
    except Exception as e:
        logger.error(f"AI 断言失败: {e}")
        return jsonify({"error": str(e)}), 500


async def _assert_async(image_base64: str, expected: str, step_index: int) -> dict:
    from server.core.settings import Settings
    from server.agents.assert_agent import _run_assertion

    settings = Settings.load()
    image_bytes = base64.b64decode(image_base64)

    result, usage = await _run_assertion(settings, image_bytes, expected, step_index)
    return result.to_dict()


@bp.route('/heal', methods=['POST'])
def ai_heal():
    """AI 自愈 — 当选择器失败时，分析 DOM 找到替代选择器（保留原接口）"""
    data = request.get_json() or {}
    failed_selector = data.get("failed_selector", "")
    html_context = data.get("html_context", "")
    element_description = data.get("element_description", "")

    if not html_context:
        return jsonify({"error": "缺少页面上下文"}), 400

    try:
        loop = asyncio.new_event_loop()
        result = loop.run_until_complete(_heal_async(failed_selector, html_context, element_description))
        loop.close()
        return jsonify(result)
    except Exception as e:
        logger.error(f"AI 自愈失败: {e}")
        return jsonify({"error": str(e)}), 500


async def _heal_async(failed_selector: str, html_context: str, description: str) -> dict:
    from server.core.settings import Settings
    from server.core.llm import call_llm

    settings = Settings.load()

    prompt = f"""你是一个 UI 自动化测试专家。一个 CSS 选择器在页面上失效了，请分析页面 HTML 结构，找到最合适的替代选择器。

失败的选择器: {failed_selector}
元素描述: {description}

页面 HTML 片段:
{html_context[:3000]}

请返回 JSON 格式:
{{
  "selector": "<新的 CSS 选择器>",
  "confidence": <0-1>,
  "reason": "<选择理由>"
}}
只返回 JSON。"""

    response = await call_llm(
        settings=settings, section="model",
        prompt=prompt, agent_name="heal",
    )

    from server.core.json_utils import safe_json_parse
    parsed = safe_json_parse(response.text)
    if parsed:
        return parsed
    return {"selector": None, "confidence": 0, "reason": "AI 分析失败"}


@bp.route('/generate-cases', methods=['POST'])
def generate_cases():
    """AI 自动生成测试用例（保留原接口，增强实现）"""
    data = request.get_json() or {}
    elements = data.get("elements", [])
    page_url = data.get("page_url", "")
    page_title = data.get("page_title", "")

    if not elements:
        return jsonify({"error": "缺少页面元素数据"}), 400

    try:
        loop = asyncio.new_event_loop()
        result = loop.run_until_complete(_generate_async(elements, page_url, page_title))
        loop.close()
        return jsonify(result)
    except Exception as e:
        logger.error(f"AI 生成用例失败: {e}")
        return jsonify({"error": str(e)}), 500


async def _generate_async(elements: list, page_url: str, page_title: str) -> dict:
    from server.core.settings import Settings
    from server.core.llm import call_llm

    settings = Settings.load()

    elements_text = "\n".join(
        f"  - {e.get('tag', '???')}: {e.get('text', '')} (selector: {e.get('selector', 'N/A')})"
        for e in elements[:30]  # 限制元素数量
    )

    prompt = f"""你是一个测试自动化专家。请根据以下页面交互元素，自动生成 3-8 条 UI 测试用例。

页面: {page_title} ({page_url})

可交互元素:
{elements_text}

请返回 JSON 数组格式:
[
  {{
    "name": "用例名称",
    "description": "用例描述",
    "steps": [
      {{"type": "click/input/...", "selector": "...", "value": "...", "description": "..."}}
    ],
    "expected": "预期结果"
  }}
]
只返回 JSON。"""

    response = await call_llm(
        settings=settings, section="model",
        prompt=prompt, agent_name="case_generator",
    )

    from server.core.json_utils import safe_json_parse
    parsed = safe_json_parse(response.text)

    if parsed and isinstance(parsed, list):
        # 将生成的用例保存到数据库
        saved = []
        for case_data in parsed:
            case = TestCase(
                name=case_data.get("name", "AI 生成用例"),
                description=case_data.get("description", ""),
                expected=case_data.get("expected", ""),
                priority="P2",
                status="draft",
            )
            case.set_steps(case_data.get("steps", []))
            db.session.add(case)
            saved.append({"case_id": case.case_id, "name": case.name})

        db.session.commit()
        return {"cases": saved, "count": len(saved)}

    return {"cases": [], "count": 0, "warning": "AI 生成失败"}
