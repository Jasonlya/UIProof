import sqlite3

from scripts.migrate_sqlite import migrate


def test_migration_backfills_run_fields_and_perf_table(tmp_path):
    db_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(db_path)
    connection.execute(
        """
        CREATE TABLE execution_log (
            id INTEGER PRIMARY KEY,
            case_id VARCHAR(36),
            status VARCHAR(20),
            task_id VARCHAR(64)
        )
        """
    )
    connection.execute(
        "INSERT INTO execution_log (id, case_id, status, task_id) VALUES (1, 'case-1', 'success', 'task-1')"
    )
    connection.commit()
    connection.close()

    migrate(db_path)

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    row = connection.execute("SELECT * FROM execution_log WHERE id = 1").fetchone()
    assert row["run_id"] == "task-1"
    assert row["status"] == "passed"
    assert row["executor"] == "legacy"
    tables = {
        item[0]
        for item in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    assert "run_perf_segment" in tables
    connection.close()
