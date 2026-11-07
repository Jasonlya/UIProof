"""Run lifecycle operations shared by HTTP routes and legacy runners."""
from __future__ import annotations

from datetime import datetime
import json
import uuid

from sqlalchemy import func

from models.models import ExecutionLog, RunPerfSegment, TestCase, db


class RunNotFound(LookupError):
    pass


class CaseNotFound(LookupError):
    pass


class RunNotRunning(RuntimeError):
    pass


_PASSED_STEP_STATUSES = {"passed", "success", "completed"}
_FAILED_STEP_STATUSES = {"failed", "error"}


def _normalized_status(status):
    if status in ("success", "completed"):
        return "passed"
    return status


def _serialize_segment(segment):
    return {
        "segment_index": segment.segment_index,
        "scope": segment.scope,
        "step_index": segment.step_index,
        "heading": segment.heading,
        "summary": segment.get_summary(),
    }


def get_segments(run_id):
    segments = (
        RunPerfSegment.query
        .filter_by(run_id=run_id)
        .order_by(RunPerfSegment.segment_index.asc())
        .all()
    )
    return [_serialize_segment(segment) for segment in segments]


def _step_counts(steps_result, fallback_total=0):
    if not isinstance(steps_result, list) or not steps_result:
        return fallback_total or 0, 0, 0
    passed = 0
    failed = 0
    for step in steps_result:
        status = step.get("status") if isinstance(step, dict) else None
        if status in _PASSED_STEP_STATUSES:
            passed += 1
        elif status in _FAILED_STEP_STATUSES:
            failed += 1
    return len(steps_result), passed, failed


def create_run(contract):
    case = TestCase.query.filter_by(case_id=contract.case_id).first()
    if case is None:
        raise CaseNotFound(contract.case_id)

    run_id = uuid.uuid4().hex
    run = ExecutionLog(
        case_id=contract.case_id,
        run_id=run_id,
        task_id=run_id,
        status="running",
        executor=contract.executor,
        perf_mode=contract.perf_mode,
        steps_total=contract.steps_total,
        steps_passed=0,
        steps_failed=0,
        client_version=contract.client_version,
        start_time=datetime.utcnow(),
    )
    db.session.add(run)
    db.session.commit()
    return run


def get_run(run_id):
    run = ExecutionLog.query.filter_by(run_id=run_id).first()
    if run is None:
        raise RunNotFound(run_id)
    return run


def update_run_progress(run_id, payload):
    run = get_run(run_id)
    if run.status != "running":
        raise RunNotRunning(run.status)

    for field_name in ("steps_total", "steps_passed", "steps_failed"):
        if field_name not in payload:
            continue
        try:
            value = int(payload[field_name])
        except (TypeError, ValueError) as error:
            raise ValueError(f"{field_name} 必须是整数") from error
        if value < 0:
            raise ValueError(f"{field_name} 不能为负数")
        setattr(run, field_name, value)

    if "client_version" in payload:
        run.client_version = str(payload.get("client_version") or "")
    if "metadata" in payload:
        metadata = payload.get("metadata")
        if metadata is not None and not isinstance(metadata, dict):
            raise ValueError("metadata 必须是对象")
        run.metadata_json = json.dumps(metadata or {}, ensure_ascii=False)
    run.updated_at = datetime.utcnow()
    db.session.commit()
    return run


def append_perf_segment(run_id, contract):
    run = get_run(run_id)
    if run.status != "running":
        raise RunNotRunning(run.status)

    next_index = (
        db.session.query(func.max(RunPerfSegment.segment_index))
        .filter(RunPerfSegment.run_id == run_id)
        .scalar()
    )
    segment = RunPerfSegment(
        run_id=run_id,
        segment_index=0 if next_index is None else next_index + 1,
        scope=contract.scope,
        step_index=contract.step_index,
        heading=contract.heading,
        summary_json=json.dumps(contract.summary, ensure_ascii=False),
    )
    db.session.add(segment)
    db.session.commit()
    return segment


def finish_run(run_id, contract):
    run = get_run(run_id)
    case = TestCase.query.filter_by(case_id=run.case_id).first()
    if case is None:
        raise CaseNotFound(run.case_id)

    if run.status != "running":
        return run, case, True

    finished_at = datetime.utcnow()
    total, passed, failed = _step_counts(contract.steps_result, run.steps_total)
    status = _normalized_status(contract.status)

    run.status = status
    run.end_time = finished_at
    run.updated_at = finished_at
    run.final_result = contract.final_result or status
    run.error_message = contract.error_message
    run.steps_result = json.dumps(contract.steps_result, ensure_ascii=False)
    run.steps_total = total
    run.steps_passed = passed
    run.steps_failed = failed
    if contract.perf_summary is not None:
        run.set_perf_summary(contract.perf_summary)

    previous_count = case.execution_count or 0
    previous_rate = case.success_rate or 0.0
    case.execution_count = previous_count + 1
    case.last_executed = finished_at
    passed_this_run = 1.0 if status == "passed" else 0.0
    case.success_rate = round(
        ((previous_rate * previous_count) + passed_this_run) / case.execution_count,
        4,
    )

    db.session.commit()
    return run, case, False


def list_case_runs(case_id):
    return (
        ExecutionLog.query
        .filter_by(case_id=case_id)
        .order_by(ExecutionLog.start_time.desc())
        .all()
    )


def snapshot_run(run):
    return {
        "run_id": run.run_id,
        "case_id": run.case_id,
        "status": _normalized_status(run.status),
        "executor": run.executor,
        "perf_mode": run.perf_mode,
        "steps_total": run.steps_total or 0,
        "steps_passed": run.steps_passed or 0,
        "steps_failed": run.steps_failed or 0,
        "started_at": run.start_time.isoformat() if run.start_time else None,
        "finished_at": run.end_time.isoformat() if run.end_time else None,
        "error_message": run.error_message,
        "final_result": run.final_result,
        "perf_summary": run.get_perf_summary(),
    }


def snapshot_case(case):
    return {
        "case_id": case.case_id,
        "execution_count": case.execution_count or 0,
        "success_rate": case.success_rate or 0.0,
        "last_executed": case.last_executed.isoformat() if case.last_executed else None,
    }
