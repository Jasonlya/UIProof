#!/usr/bin/env python3
"""Idempotently migrate the legacy SQLite schema to the Run model."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import sqlite3
import uuid


SERVER_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DB = SERVER_DIR / "instance" / "automation_cases.db"


NEW_EXECUTION_COLUMNS = {
    "run_id": "TEXT",
    "executor": "TEXT DEFAULT 'legacy'",
    "perf_mode": "TEXT",
    "perf_summary": "TEXT",
    "steps_total": "INTEGER DEFAULT 0",
    "steps_passed": "INTEGER DEFAULT 0",
    "steps_failed": "INTEGER DEFAULT 0",
    "client_version": "TEXT",
    "updated_at": "TIMESTAMP",
    "metadata_json": "TEXT",
}


def _columns(connection, table):
    return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}


def migrate(db_path):
    db_path = Path(db_path)
    if not db_path.exists():
        raise FileNotFoundError(f"SQLite database not found: {db_path}")

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        table_names = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        if "execution_log" not in table_names:
            raise RuntimeError("execution_log table not found")

        existing = _columns(connection, "execution_log")
        for name, definition in NEW_EXECUTION_COLUMNS.items():
            if name not in existing:
                connection.execute(
                    f"ALTER TABLE execution_log ADD COLUMN {name} {definition}"
                )

        rows = connection.execute(
            "SELECT id, task_id, run_id FROM execution_log ORDER BY id"
        ).fetchall()
        used = set()
        for row in rows:
            candidate = (row["run_id"] or "").strip() if row["run_id"] else ""
            if not candidate or candidate in used:
                candidate = (row["task_id"] or "").strip() if row["task_id"] else ""
            while not candidate or candidate in used:
                candidate = uuid.uuid4().hex
            used.add(candidate)
            connection.execute(
                "UPDATE execution_log SET run_id = ?, executor = COALESCE(executor, 'legacy') WHERE id = ?",
                (candidate, row["id"]),
            )

        connection.execute(
            "UPDATE execution_log SET status = 'passed' WHERE status IN ('success', 'completed')"
        )
        connection.execute(
            "UPDATE execution_log SET executor = 'legacy' WHERE executor IS NULL OR executor = ''"
        )
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_log_run_id ON execution_log(run_id)"
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS run_perf_segment (
                id INTEGER NOT NULL PRIMARY KEY,
                run_id VARCHAR(64) NOT NULL,
                segment_index INTEGER NOT NULL,
                scope VARCHAR(10) NOT NULL,
                step_index INTEGER,
                heading VARCHAR(200),
                summary_json TEXT NOT NULL,
                created_at TIMESTAMP,
                CONSTRAINT uq_run_perf_segment_run_index UNIQUE (run_id, segment_index)
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS ix_run_perf_segment_run_id ON run_perf_segment(run_id)"
        )
        connection.commit()
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--db",
        default=os.environ.get("SQLITE_DB_PATH", str(DEFAULT_DB)),
    )
    args = parser.parse_args()
    migrate(args.db)
    print(f"Migrated: {args.db}")


if __name__ == "__main__":
    main()
