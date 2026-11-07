# server/routes/recording.py
"""录制增强路由 — 截图上传、AI 描述、步骤优化"""
from __future__ import annotations

from flask import Blueprint, request, jsonify
from models.models import db, TestCase, StepSnapshot
import asyncio
import base64
import json
import logging
import re
import uuid
import os
from pathlib import Path

from services.step_schema import StepValidationError, normalize_steps

logger = logging.getLogger(__name__)

bp = Blueprint('recording', __name__, url_prefix='/api/recording')

MAX_SCREENSHOT_BASE64 = 12 * 1024 * 1024


@bp.route('/screenshot', methods=['POST'])
def upload_screenshot():
    """上传录制步骤截图"""
    data = request.get_json() or {}
    case_id = data.get("case_id")
    step_index = data.get("step_index", 0)
    image_data = data.get("image")  # base64 编码的图片
    phase = data.get("phase", "record")

    if not image_data:
        return jsonify({"error": "缺少图片数据"}), 400
    if not isinstance(image_data, str):
        return jsonify({"error": "图片数据必须是 base64 字符串"}), 400
    if len(image_data) > MAX_SCREENSHOT_BASE64:
        return jsonify({"error": "图片数据过大"}), 413

    # 保存截图文件
    safe_case_id = re.sub(r'[^A-Za-z0-9_-]', '_', str(case_id or 'temp'))[:64] or 'temp'
    screenshots_dir = Path("screenshots") / "recording" / safe_case_id
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    try:
        safe_step_index = int(step_index)
    except (TypeError, ValueError):
        safe_step_index = 0
    filename = f"step_{safe_step_index}_{uuid.uuid4().hex[:8]}.png"
    filepath = screenshots_dir / filename

    try:
        image_bytes = base64.b64decode(image_data)
        filepath.write_bytes(image_bytes)
    except Exception as e:
        return jsonify({"error": f"图片保存失败: {e}"}), 500

    # 创建数据库记录
    snapshot = StepSnapshot(
        case_id=case_id,
        step_index=safe_step_index,
        phase=phase,
        screenshot_path=str(filepath),
    )
    db.session.add(snapshot)
    db.session.commit()

    return jsonify({
        "snapshot_id": snapshot.snapshot_id,
        "screenshot_path": str(filepath),
        "step_index": safe_step_index,
    })


@bp.route('/describe', methods=['POST'])
def describe_element():
    """调用 Vision Agent 描述截图中的元素"""
    data = request.get_json() or {}
    image_data = data.get("image")  # base64
    snapshot_id = data.get("snapshot_id")

    if not image_data and not snapshot_id:
        return jsonify({"error": "提供 image (base64) 或 snapshot_id"}), 400

    try:
        loop = asyncio.new_event_loop()
        result = loop.run_until_complete(_describe_async(image_data, snapshot_id))
        loop.close()
        return jsonify(result)
    except Exception as e:
        logger.error(f"AI 描述失败: {e}")
        return jsonify({"error": str(e)}), 500


async def _describe_async(image_base64: str | None, snapshot_id: str | None) -> dict:
    from server.core.settings import Settings
    from server.agents.vision_agent import VisionAgent

    settings = Settings.load()
    vision = VisionAgent(settings)

    if snapshot_id and not image_base64:
        snapshot = StepSnapshot.query.filter_by(snapshot_id=snapshot_id).first()
        if not snapshot or not snapshot.screenshot_path:
            return {"error": "截图不存在"}
        with open(snapshot.screenshot_path, "rb") as f:
            image_bytes = f.read()
    else:
        image_bytes = base64.b64decode(image_base64)

    description = await vision.describe_element(image_bytes)

    # 更新 snapshot
    if snapshot_id:
        snapshot = StepSnapshot.query.filter_by(snapshot_id=snapshot_id).first()
        if snapshot:
            snapshot.ai_description = description
            db.session.commit()

    return {"description": description}


@bp.route('/optimize', methods=['POST'])
def optimize_steps():
    """LLM 智能优化录制步骤"""
    data = request.get_json() or {}
    steps = data.get("steps", [])
    context = data.get("context", "")

    if not steps:
        return jsonify({"error": "缺少步骤数据"}), 400

    try:
        loop = asyncio.new_event_loop()
        result = loop.run_until_complete(_optimize_async(steps, context))
        loop.close()
        return jsonify(result)
    except Exception as e:
        logger.error(f"步骤优化失败: {e}")
        return jsonify({"error": str(e)}), 500


async def _optimize_async(steps: list, context: str) -> dict:
    from server.core.settings import Settings
    from server.core.llm import call_llm

    settings = Settings.load()

    steps_text = "\n".join(
        f"  {i+1}. [{s.get('type','?')}] {s.get('description','')} "
        f"(selector: {s.get('selector','N/A')})"
        for i, s in enumerate(steps)
    )

    prompt = f"""你是一个测试自动化专家。请优化以下录制步骤，使其更稳定、更适合自动回放。

规则:
1. 合并冗余的连续同类操作（如多次点击同一元素）
2. 在页面跳转后添加适当的等待步骤
3. 保留所有关键操作，不要删除有意义的步骤
4. 为每个步骤补充更清晰的描述
5. 返回 JSON 数组格式

上下文: {context}

原始步骤:
{steps_text}

请返回优化后的步骤 JSON 数组，只返回 JSON。"""

    response = await call_llm(
        settings=settings, section="model",
        prompt=prompt, agent_name="step_optimizer",
    )

    from server.core.json_utils import safe_json_parse
    parsed = safe_json_parse(response.text)

    if parsed and isinstance(parsed, list):
        return {"optimized_steps": parsed, "original_count": len(steps), "optimized_count": len(parsed)}

    return {"optimized_steps": steps, "original_count": len(steps), "optimized_count": len(steps), "warning": "AI 优化失败，返回原始步骤"}


@bp.route('/save', methods=['POST'])
def save_recorded_case():
    """保存录制完成的用例到数据库"""
    data = request.get_json() or {}
    name = data.get("name", "未命名用例")
    description = data.get("description", "")
    try:
        steps = normalize_steps(data.get("steps", []))
        setup_steps = normalize_steps(data.get("setup_steps", []))
    except StepValidationError as exc:
        logger.warning(f"录制用例步骤校验失败: {exc}")
        return jsonify({"error": str(exc)}), 400

    folder_id = data.get("folder_id")
    expected = data.get("expected", "")

    case = TestCase(
        name=name,
        description=description,
        folder_id=folder_id,
        expected=expected,
        priority="P1",
        status="active",
    )
    case.set_steps(steps)
    if setup_steps:
        case.set_setup_steps(setup_steps)

    db.session.add(case)
    db.session.commit()

    return jsonify({
        "case_id": case.case_id,
        "name": case.name,
        "steps_count": len(steps),
    })
