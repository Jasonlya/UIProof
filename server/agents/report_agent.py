# server/agents/report_agent.py
"""报告生成 Agent — 汇总执行结果并写入数据库"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from server.core.settings import Settings
from server.core.image_utils import encode_image

logger = logging.getLogger(__name__)


async def report_node(state: dict) -> dict:
    """LangGraph 节点: 生成测试报告"""
    settings: Settings = state.get("settings")
    current_case = state.get("current_case")
    step_results = state.get("step_results", [])
    assertion_results = state.get("assertion_results", [])
    session_id = state.get("session_id", "unknown")

    all_steps_ok = all(r.success for r in step_results) if step_results else True
    all_assertions_ok = all(r.passed for r in assertion_results) if assertion_results else True
    uncertain = any(r.confidence < 0.7 for r in assertion_results)

    if not all_steps_ok:
        final_result = "error"
    elif not all_assertions_ok:
        final_result = "fail"
    elif uncertain:
        final_result = "uncertain"
    else:
        final_result = "pass"

    case_id = current_case.get("id", "unknown") if isinstance(current_case, dict) else getattr(current_case, "id", "unknown")
    case_name = current_case.get("name", "unknown") if isinstance(current_case, dict) else getattr(current_case, "name", "unknown")

    logger.info(f"用例 {case_id} 结果: {final_result}")

    report_path = ""
    if settings:
        allure_dir = settings.allure.get("results_dir", "reports/allure-results")
        report_path = _write_allure_result(
            allure_dir, case_id, case_name, step_results, assertion_results, final_result,
        )

    _write_langfuse_trace(state)

    # 推送最终结果到 SSE 队列
    progress_queue = state.get("progress_queue")
    if progress_queue:
        import asyncio
        try:
            progress_queue.put_nowait({
                "type": "execution_complete",
                "case_id": case_id,
                "case_name": case_name,
                "final_result": final_result,
                "total_steps": len(step_results),
                "passed_steps": sum(1 for r in step_results if r.success),
            })
        except Exception:
            pass

    return {
        "final_result": final_result,
        "report_path": report_path,
    }


def _write_allure_result(allure_dir, case_id, case_name, step_results, assertion_results, final_result):
    results_dir = Path(allure_dir)
    results_dir.mkdir(parents=True, exist_ok=True)

    status_map = {"pass": "passed", "fail": "failed", "error": "broken", "uncertain": "skipped"}

    allure_result = {
        "uuid": case_id,
        "name": case_name,
        "status": status_map.get(final_result, "unknown"),
        "stage": "finished",
        "steps": [
            {
                "name": f"步骤 {r.step_index}: {r.action}",
                "status": "passed" if r.success else "failed",
                "start": 0,
                "stop": r.duration_ms,
            }
            for r in step_results
        ],
    }

    for ar in assertion_results:
        allure_result["steps"].append({
            "name": f"断言: {ar.expected}",
            "status": "passed" if ar.passed else "failed",
            "start": 0, "stop": 0,
            "statusDetails": {
                "message": f"实际: {ar.actual}, 置信度: {ar.confidence}, 理由: {ar.reason}",
            } if not ar.passed else None,
        })

    filepath = results_dir / f"{case_id}-result.json"
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(allure_result, f, ensure_ascii=False, indent=2)

    logger.info(f"Allure 报告已写入: {filepath}")
    return str(filepath)


def _get_langfuse_key(settings: Settings, field_name: str) -> str | None:
    lf = settings.langfuse
    direct = lf.get(field_name)
    if direct:
        return direct
    env_name = lf.get(f"{field_name}_env", "")
    return os.environ.get(env_name) if env_name else None


def _write_langfuse_trace(state: dict) -> None:
    try:
        from langfuse import Langfuse

        settings: Settings = state.get("settings")
        if not settings:
            return

        public_key = _get_langfuse_key(settings, "public_key")
        secret_key = _get_langfuse_key(settings, "secret_key")
        if not public_key or not secret_key:
            logger.warning("Langfuse Key 未配置，跳过追踪")
            return

        langfuse = Langfuse(
            public_key=public_key, secret_key=secret_key,
            host=settings.langfuse.get("host", "https://cloud.langfuse.com"),
        )

        current_case = state.get("current_case")
        trace = langfuse.start_observation(
            name=f"test-{current_case.get('id', 'unknown') if isinstance(current_case, dict) else getattr(current_case, 'id', 'unknown')}",
            metadata={
                "case_id": current_case.get("id") if isinstance(current_case, dict) else getattr(current_case, "id", None),
                "case_name": current_case.get("name") if isinstance(current_case, dict) else getattr(current_case, "name", None),
                "session_id": state.get("session_id"),
                "final_result": state.get("final_result"),
                "step_count": len(state.get("step_results", [])),
            },
        )

        for sr in state.get("step_results", []):
            span = trace.start_observation(name=f"step-{sr.step_index}")
            output_data = {"success": sr.success, "action": sr.action, "duration_ms": sr.duration_ms, "error": sr.error}
            if sr.screenshot:
                output_data["screenshot"] = f"data:image/png;base64,{encode_image(sr.screenshot)}"
            span.update(output=output_data)
            span.end()

        screenshots = state.get("screenshots", [])
        for ar in state.get("assertion_results", []):
            span = trace.start_observation(name=f"assert-{ar.step_index}")
            output_data = {"passed": ar.passed, "expected": ar.expected, "actual": ar.actual, "confidence": ar.confidence, "reason": ar.reason}
            if ar.step_index < len(screenshots) and screenshots[ar.step_index]:
                output_data["screenshot"] = f"data:image/png;base64,{encode_image(screenshots[ar.step_index])}"
            span.update(output=output_data)
            span.end()

        trace_output = {"final_result": state.get("final_result", "unknown")}
        video_path = state.get("video_path")
        if video_path:
            trace_output["video_path"] = video_path
        trace.update(output=trace_output)
        trace.end()

        llm_usages = state.get("llm_usage", [])
        if llm_usages:
            for u in llm_usages:
                span = trace.start_observation(name=f"llm-{u.agent_name}")
                span.update(
                    model=u.model,
                    model_parameters={"provider": u.provider},
                    usage_details={"prompt_tokens": u.prompt_tokens, "completion_tokens": u.completion_tokens, "total_tokens": u.total_tokens},
                    output={"agent": u.agent_name},
                )
                span.end()

        langfuse.flush()
        logger.info("Langfuse 追踪已写入")
    except Exception as e:
        logger.warning(f"Langfuse 追踪写入失败(非致命): {e}")
