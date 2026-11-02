# server/routes/execution.py
"""执行调度路由 — 触发 Playwright + AI Agent 执行，SSE 实时进度"""
from flask import Blueprint, request, jsonify, Response, stream_with_context
from models.models import db, TestCase, ExecutionLog
import asyncio
import json
import logging
import threading
import time
import uuid

logger = logging.getLogger(__name__)

bp = Blueprint('execution', __name__, url_prefix='/api/execution')

# 全局执行任务管理（内存中）
_execution_tasks = {}  # task_id -> {status, progress_queue, thread, result}


@bp.route('/run/<case_id>', methods=['POST'])
def run_case(case_id):
    """启动单条用例的 AI 执行"""
    case = TestCase.query.filter_by(case_id=case_id).first()
    if not case:
        return jsonify({"error": "用例不存在"}), 404

    task_id = uuid.uuid4().hex[:16]

    # 创建执行日志
    log = ExecutionLog(
        case_id=case_id,
        task_id=task_id,
        status="running",
        start_time=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    db.session.add(log)
    db.session.commit()

    # 准备进度队列
    progress_queue = asyncio.Queue()

    case_data = case.to_execution_dict()

    # 启动后台线程执行
    thread = threading.Thread(
        target=_run_in_thread,
        args=(task_id, case_data, progress_queue, log.id),
        daemon=True,
    )
    thread.start()

    _execution_tasks[task_id] = {
        "status": "running",
        "progress_queue": progress_queue,
        "thread": thread,
        "case_id": case_id,
        "case_name": case.name,
    }

    return jsonify({
        "task_id": task_id,
        "case_id": case_id,
        "case_name": case.name,
        "status": "running",
        "message": "执行已启动，通过 /api/execution/stream/{task_id} 获取实时进度",
    })


@bp.route('/batch', methods=['POST'])
def run_batch():
    """批量执行多条用例"""
    data = request.get_json() or {}
    case_ids = data.get("case_ids", [])

    if not case_ids:
        return jsonify({"error": "请提供 case_ids"}), 400

    cases = TestCase.query.filter(TestCase.case_id.in_(case_ids)).all()
    if not cases:
        return jsonify({"error": "未找到指定用例"}), 404

    task_id = uuid.uuid4().hex[:16]
    progress_queue = asyncio.Queue()

    cases_data = [c.to_execution_dict() for c in cases]

    # 为每个用例创建执行日志
    for case in cases:
        log = ExecutionLog(
            case_id=case.case_id,
            task_id=task_id,
            status="running",
            start_time=time.strftime("%Y-%m-%d %H:%M:%S"),
        )
        db.session.add(log)
    db.session.commit()

    thread = threading.Thread(
        target=_run_batch_in_thread,
        args=(task_id, cases_data, progress_queue),
        daemon=True,
    )
    thread.start()

    _execution_tasks[task_id] = {
        "status": "running",
        "progress_queue": progress_queue,
        "thread": thread,
        "case_ids": case_ids,
    }

    return jsonify({
        "task_id": task_id,
        "case_count": len(cases),
        "status": "running",
    })


@bp.route('/stream/<task_id>')
def execution_stream(task_id):
    """SSE 实时进度推送"""
    task = _execution_tasks.get(task_id)
    if not task:
        return jsonify({"error": "任务不存在"}), 404

    def generate():
        queue = task["progress_queue"]
        while True:
            try:
                # 从 asyncio queue 中获取数据
                loop = asyncio.new_event_loop()
                try:
                    progress = loop.run_until_complete(
                        asyncio.wait_for(queue.get(), timeout=5)
                    )
                except asyncio.TimeoutError:
                    # 发送心跳
                    yield f": heartbeat\n\n"
                    if task["status"] in ("completed", "failed"):
                        break
                    continue
                finally:
                    loop.close()

                yield f"data: {json.dumps(progress, ensure_ascii=False)}\n\n"

                if progress.get("type") in ("execution_complete", "execution_error"):
                    break
            except GeneratorExit:
                break
            except Exception as e:
                logger.error(f"SSE 错误: {e}")
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                break

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )


@bp.route('/status/<task_id>')
def execution_status(task_id):
    """查询执行状态"""
    task = _execution_tasks.get(task_id)
    if not task:
        return jsonify({"error": "任务不存在"}), 404

    return jsonify({
        "task_id": task_id,
        "status": task["status"],
        "case_id": task.get("case_id"),
        "case_name": task.get("case_name"),
    })


@bp.route('/stop/<task_id>', methods=['POST'])
def stop_execution(task_id):
    """停止执行"""
    task = _execution_tasks.get(task_id)
    if not task:
        return jsonify({"error": "任务不存在"}), 404

    task["status"] = "stopped"
    return jsonify({"task_id": task_id, "status": "stopped"})


# ──────────────────────────────────────────────
# 内部执行函数
# ──────────────────────────────────────────────

def _run_in_thread(task_id, case_data, progress_queue, log_id):
    """在后台线程中运行异步执行"""
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        result = loop.run_until_complete(
            _execute_case_async(case_data, progress_queue)
        )

        # 更新执行日志
        log = ExecutionLog.query.get(log_id)
        if log:
            log.status = "completed"
            log.end_time = time.strftime("%Y-%m-%d %H:%M:%S")
            log.final_result = result.get("final_result", "unknown")
            log.set_steps_result([
                r.to_dict() if hasattr(r, 'to_dict') else r
                for r in result.get("step_results", [])
            ])
            if result.get("llm_usage"):
                log.set_llm_usage(result["llm_usage"])
            if result.get("report", {}).get("video_path"):
                log.video_path = result["report"]["video_path"]
            db.session.commit()

            # 更新用例统计
            case = TestCase.query.filter_by(case_id=case_data["id"]).first()
            if case:
                case.execution_count = (case.execution_count or 0) + 1
                case.last_executed = time.strftime("%Y-%m-%d %H:%M:%S")
                total = case.execution_count
                passed = int(case.success_rate * (total - 1))
                if result.get("final_result") == "pass":
                    passed += 1
                case.success_rate = passed / total if total > 0 else 0.0
                db.session.commit()

        # 推送完成消息
        loop.run_until_complete(progress_queue.put({
            "type": "execution_complete",
            "task_id": task_id,
            "final_result": result.get("final_result", "unknown"),
        }))

        if task_id in _execution_tasks:
            _execution_tasks[task_id]["status"] = "completed"

        loop.close()

    except Exception as e:
        logger.error(f"执行异常: {e}", exc_info=True)

        log = ExecutionLog.query.get(log_id) if log_id else None
        if log:
            log.status = "failed"
            log.end_time = time.strftime("%Y-%m-%d %H:%M:%S")
            log.error_message = str(e)
            log.final_result = "error"
            db.session.commit()

        try:
            loop.run_until_complete(progress_queue.put({
                "type": "execution_error",
                "task_id": task_id,
                "error": str(e),
            }))
        except Exception:
            pass

        if task_id in _execution_tasks:
            _execution_tasks[task_id]["status"] = "failed"


def _run_batch_in_thread(task_id, cases_data, progress_queue):
    """批量执行"""
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        from server.core.pipeline import run_cases_batch
        results = loop.run_until_complete(
            run_cases_batch(cases_data, progress_queue=progress_queue)
        )

        # 更新所有执行日志
        for result in results:
            case_data = result.get("case", {})
            logs = ExecutionLog.query.filter_by(task_id=task_id, case_id=case_data.get("id")).all()
            for log in logs:
                log.status = "completed"
                log.end_time = time.strftime("%Y-%m-%d %H:%M:%S")
                log.final_result = result.get("final_result", "unknown")
                log.set_steps_result([
                    r.to_dict() if hasattr(r, 'to_dict') else r
                    for r in result.get("step_results", [])
                ])
            db.session.commit()

        loop.run_until_complete(progress_queue.put({
            "type": "batch_complete",
            "task_id": task_id,
            "total": len(results),
            "passed": sum(1 for r in results if r.get("final_result") == "pass"),
        }))

        if task_id in _execution_tasks:
            _execution_tasks[task_id]["status"] = "completed"

        loop.close()

    except Exception as e:
        logger.error(f"批量执行异常: {e}", exc_info=True)
        if task_id in _execution_tasks:
            _execution_tasks[task_id]["status"] = "failed"


async def _execute_case_async(case_data, progress_queue):
    """异步执行单条用例"""
    from server.core.pipeline import run_case_from_db
    return await run_case_from_db(case_data, progress_queue=progress_queue)
