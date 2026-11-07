from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


VALID_EXECUTORS = {"extension", "playwright", "legacy"}
VALID_PERF_MODES = {"step", "case", "none"}
VALID_FINISH_STATUSES = {"passed", "failed", "stopped", "error"}
VALID_SCOPES = {"step", "case"}


class ContractError(ValueError):
    pass


@dataclass(frozen=True)
class RunCreate:
    case_id: str
    executor: str = "extension"
    perf_mode: str = "none"
    steps_total: int = 0
    client_version: Optional[str] = None


@dataclass(frozen=True)
class PerfSegmentCreate:
    scope: str
    step_index: Optional[int]
    heading: str
    summary: dict[str, Any]


@dataclass(frozen=True)
class RunFinish:
    status: str
    final_result: Optional[str] = None
    steps_result: list[Any] = field(default_factory=list)
    error_message: Optional[str] = None
    perf_summary: Optional[dict[str, Any]] = None


def _to_non_negative_int(value: Any, field_name: str) -> int:
    try:
        parsed = int(value or 0)
    except (TypeError, ValueError) as error:
        raise ContractError(f"{field_name} 必须是整数") from error
    if parsed < 0:
        raise ContractError(f"{field_name} 不能为负数")
    return parsed


def parse_run_create(payload: dict) -> RunCreate:
    if not isinstance(payload, dict):
        raise ContractError("请求体必须是对象")
    case_id = str(payload.get("case_id") or "").strip()
    if not case_id:
        raise ContractError("缺少 case_id")
    executor = payload.get("executor") or "extension"
    if executor not in VALID_EXECUTORS:
        raise ContractError(f"不支持的 executor: {executor}")
    perf_mode = payload.get("perf_mode") or "none"
    if perf_mode not in VALID_PERF_MODES:
        raise ContractError(f"不支持的 perf_mode: {perf_mode}")
    return RunCreate(
        case_id=case_id,
        executor=executor,
        perf_mode=perf_mode,
        steps_total=_to_non_negative_int(payload.get("steps_total"), "steps_total"),
        client_version=payload.get("client_version"),
    )


def parse_perf_segment(payload: dict) -> PerfSegmentCreate:
    if not isinstance(payload, dict):
        raise ContractError("请求体必须是对象")
    scope = payload.get("scope") or "case"
    if scope not in VALID_SCOPES:
        raise ContractError(f"不支持的 scope: {scope}")
    step_index = payload.get("step_index")
    if scope == "step":
        if step_index is None:
            raise ContractError("step 分段必须提供 step_index")
        step_index = _to_non_negative_int(step_index, "step_index")
    else:
        step_index = None
    summary = payload.get("summary")
    if not isinstance(summary, dict):
        raise ContractError("summary 必须是对象")
    return PerfSegmentCreate(
        scope=scope,
        step_index=step_index,
        heading=str(payload.get("heading") or "性能采集")[:200],
        summary=summary,
    )


def parse_run_finish(payload: dict) -> RunFinish:
    if not isinstance(payload, dict):
        raise ContractError("请求体必须是对象")
    status = payload.get("status")
    if status not in VALID_FINISH_STATUSES:
        raise ContractError(f"不支持的 status: {status}")
    steps_result = payload.get("steps_result") or []
    if not isinstance(steps_result, list):
        raise ContractError("steps_result 必须是数组")
    perf_summary = payload.get("perf_summary")
    if perf_summary is not None and not isinstance(perf_summary, dict):
        raise ContractError("perf_summary 必须是对象")
    return RunFinish(
        status=status,
        final_result=payload.get("final_result"),
        steps_result=steps_result,
        error_message=payload.get("error_message"),
        perf_summary=perf_summary,
    )


def serialize_run(run, segments=None) -> dict:
    status = run.status
    if status in ("success", "completed"):
        status = "passed"
    return {
        "run_id": run.run_id,
        "case_id": run.case_id,
        "status": status,
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
        "segments": segments or [],
    }
