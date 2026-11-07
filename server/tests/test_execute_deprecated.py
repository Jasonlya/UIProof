from models.models import TestCase as CaseModel, db


def test_legacy_execute_returns_gone(app, client):
    with app.app_context():
        db.session.add(CaseModel(case_id="case-old-execute", name="Legacy", steps="[]"))
        db.session.commit()

    response = client.post("/api/cases/case-old-execute/execute")
    assert response.status_code == 410
    payload = response.get_json()
    assert payload["error"] == "deprecated"
    assert "POST /api/runs" in payload["message"]
