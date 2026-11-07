"""Run lifecycle HTTP API."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from contracts.runs import (
    ContractError,
    parse_perf_segment,
    parse_run_create,
    parse_run_finish,
    serialize_run,
)
from services import run_service


bp = Blueprint("runs", __name__, url_prefix="/api")


def _bad_request(error):
    return jsonify({"error": "invalid_request", "message": str(error)}), 400


def _not_found(error):
    return jsonify({"error": "not_found", "message": str(error)}), 404


@bp.post("/runs")
def create_run():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _bad_request("请求体必须是 JSON 对象")
    try:
        contract = parse_run_create(payload)
    except ContractError as error:
        return _bad_request(error)

    try:
        run = run_service.create_run(contract)
    except run_service.CaseNotFound as error:
        return _not_found(f"用例不存在: {error}")
    return jsonify(serialize_run(run)), 201


@bp.get("/runs/<run_id>")
def get_run(run_id):
    try:
        run = run_service.get_run(run_id)
    except run_service.RunNotFound as error:
        return _not_found(error)
    return jsonify(serialize_run(run, run_service.get_segments(run_id)))


@bp.patch("/runs/<run_id>")
def patch_run(run_id):
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _bad_request("请求体必须是 JSON 对象")
    try:
        run = run_service.update_run_progress(run_id, payload)
    except run_service.RunNotFound as error:
        return _not_found(error)
    except run_service.RunNotRunning as error:
        return jsonify({
            "error": "run_not_running",
            "message": f"Run 已结束，不能更新进度: {error}",
        }), 409
    except ValueError as error:
        return _bad_request(error)
    return jsonify(serialize_run(run, run_service.get_segments(run_id)))


@bp.post("/runs/<run_id>/perf-segments")
def create_perf_segment(run_id):
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _bad_request("请求体必须是 JSON 对象")
    try:
        contract = parse_perf_segment(payload)
    except ContractError as error:
        return _bad_request(error)

    try:
        segment = run_service.append_perf_segment(run_id, contract)
    except run_service.RunNotFound as error:
        return _not_found(error)
    except run_service.RunNotRunning as error:
        return jsonify({
            "error": "run_not_running",
            "message": f"Run 已结束，不能追加性能分段: {error}",
        }), 409
    return jsonify({
        "run_id": run_id,
        "segment_index": segment.segment_index,
        "scope": segment.scope,
        "step_index": segment.step_index,
        "heading": segment.heading,
    }), 201


@bp.post("/runs/<run_id>/finish")
def finish_run(run_id):
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _bad_request("请求体必须是 JSON 对象")
    try:
        contract = parse_run_finish(payload)
    except ContractError as error:
        return _bad_request(error)

    try:
        run, case, idempotent = run_service.finish_run(run_id, contract)
    except run_service.RunNotFound as error:
        return _not_found(error)
    except run_service.CaseNotFound as error:
        return _not_found(error)

    body = serialize_run(run, run_service.get_segments(run_id))
    body["case"] = run_service.snapshot_case(case)
    body["idempotent"] = idempotent
    return jsonify(body)


@bp.get("/runs/<run_id>/perf")
def get_run_perf(run_id):
    try:
        run = run_service.get_run(run_id)
    except run_service.RunNotFound as error:
        return _not_found(error)
    return jsonify({
        "run_id": run.run_id,
        "case_id": run.case_id,
        "perf_mode": run.perf_mode,
        "perf_summary": run.get_perf_summary(),
        "segments": run_service.get_segments(run_id),
    })


@bp.get("/cases/<case_id>/runs")
def list_case_runs(case_id):
    runs = run_service.list_case_runs(case_id)
    return jsonify({
        "case_id": case_id,
        "runs": [run_service.snapshot_run(run) for run in runs],
    })
