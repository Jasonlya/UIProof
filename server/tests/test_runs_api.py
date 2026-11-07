from models.models import ExecutionLog, TestCase as CaseModel, db


def _create_case(app, case_id="case-runs-1"):
    with app.app_context():
        case = CaseModel(case_id=case_id, name="Checkout flow", steps="[]")
        db.session.add(case)
        db.session.commit()
    return case_id


def test_run_lifecycle_persists_segments_and_counts(app, client):
    case_id = _create_case(app)

    created = client.post("/api/runs", json={
        "case_id": case_id,
        "executor": "extension",
        "perf_mode": "step",
        "steps_total": 2,
        "client_version": "0.3.0",
    })
    assert created.status_code == 201
    run = created.get_json()
    run_id = run["run_id"]
    assert run["status"] == "running"

    segment = client.post(f"/api/runs/{run_id}/perf-segments", json={
        "scope": "step",
        "step_index": 0,
        "heading": "步骤 1: 打开结算页",
        "summary": {"collectionMode": "Tracing", "durationTotalWithDur": 120},
    })
    assert segment.status_code == 201
    assert segment.get_json()["segment_index"] == 0

    finished = client.post(f"/api/runs/{run_id}/finish", json={
        "status": "passed",
        "steps_result": [
            {"status": "passed", "step_index": 0},
            {"status": "passed", "step_index": 1},
        ],
        "perf_summary": {"collectionMode": "Tracing", "segments": 1},
    })
    assert finished.status_code == 200
    body = finished.get_json()
    assert body["status"] == "passed"
    assert body["steps_total"] == 2
    assert body["steps_passed"] == 2
    assert body["case"]["execution_count"] == 1
    assert body["idempotent"] is False

    repeated = client.post(f"/api/runs/{run_id}/finish", json={"status": "failed"})
    assert repeated.status_code == 200
    repeated_body = repeated.get_json()
    assert repeated_body["status"] == "passed"
    assert repeated_body["idempotent"] is True
    assert repeated_body["case"]["execution_count"] == 1

    detail = client.get(f"/api/runs/{run_id}")
    assert detail.status_code == 200
    assert detail.get_json()["segments"][0]["scope"] == "step"

    perf = client.get(f"/api/runs/{run_id}/perf")
    assert perf.status_code == 200
    assert perf.get_json()["segments"][0]["summary"]["durationTotalWithDur"] == 120

    runs = client.get(f"/api/cases/{case_id}/runs")
    assert runs.status_code == 200
    assert runs.get_json()["runs"][0]["run_id"] == run_id

    with app.app_context():
        log = ExecutionLog.query.filter_by(run_id=run_id).one()
        assert log.executor == "extension"
        assert log.perf_mode == "step"
        assert log.get_perf_summary()["segments"] == 1


def test_finish_rejects_unknown_status(app, client):
    case_id = _create_case(app, "case-runs-2")
    run_id = client.post("/api/runs", json={"case_id": case_id}).get_json()["run_id"]

    response = client.post(f"/api/runs/{run_id}/finish", json={"status": "maybe"})
    assert response.status_code == 400
    assert response.get_json()["error"] == "invalid_request"


def test_patch_run_updates_progress_while_running(app, client):
    case_id = _create_case(app, "case-runs-3")
    run_id = client.post("/api/runs", json={
        "case_id": case_id,
        "perf_mode": "step",
        "steps_total": 3,
    }).get_json()["run_id"]

    response = client.patch(f"/api/runs/{run_id}", json={
        "steps_passed": 1,
        "metadata": {"current_step": 2},
    })
    assert response.status_code == 200
    body = response.get_json()
    assert body["steps_passed"] == 1

    client.post(f"/api/runs/{run_id}/finish", json={"status": "failed"})
    rejected = client.patch(f"/api/runs/{run_id}", json={"steps_passed": 2})
    assert rejected.status_code == 409
    assert rejected.get_json()["error"] == "run_not_running"
