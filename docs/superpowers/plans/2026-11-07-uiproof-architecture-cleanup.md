# UIProof 架构清理实施计划

> **Goal:** 把 UIProof 从“录制的步骤、伪成功记录、内存性能摘要”整理为“扩展可见执行 + Flask 统一运行记录 + 可查询性能分段”的可演示、可维护架构。
>
> **Architecture:** Chrome 扩展是默认执行面；Flask 是控制面与记录面。扩展通过 `RunCoordinator` 驱动可见执行与 CDP Tracing，通过 `RunClient` 写入 `/api/runs`；Flask 通过 `run_service` 在 SQLite 中维护 Run 与 `RunPerfSegment`；服务端 Playwright 执行器保留为可选路径。
>
> **Tech Stack:** Chrome Extension MV3、JavaScript ES Modules、Node 20 内置 test runner、Flask 2.3、Flask-SQLAlchemy 3、SQLite、pytest、GitHub Actions。
>
> **Spec:** `docs/superpowers/specs/2026-11-07-uiproof-architecture-cleanup-design.md`
>
> **Global Constraints:**
> - 不重写录制器与 Content Script 的 DOM 操作逻辑。
> - 不引入消息队列、微服务或独立性能服务。
> - `perf-controller/` 保持可选遗留方案，不进入默认启动链路。
> - 所有代码改动遵循现有中文注释与命名风格；新增代码注释只在解释非显然逻辑时使用。
> - 每个任务先写失败测试，再写最小实现；测试通过后才进入下一任务。
> - 不执行 `git commit`，除非用户明确要求。

---

## 任务 1：建立 Python / JavaScript 测试基线

**目标：** 让仓库第一次拥有可执行的自动化测试入口，并让 CI 能在 PR 上跑起来。

**Files:**
- Create: `server/pytest.ini`
- Create: `server/tests/conftest.py`
- Create: `server/tests/test_health.py`
- Create: `server/requirements-dev.txt`
- Create: `package.json`
- Create: `tests/js/contract-smoke.test.js`
- Create: `.github/workflows/ci.yml`

**Step 1：写测试脚手架**

`server/pytest.ini`：

```ini
[pytest]
testpaths = tests
pythonpath = .
addopts = -q
```

`server/tests/conftest.py`：

```python
import os
import sys
import tempfile
from pathlib import Path

TEST_DB = Path(tempfile.mkdtemp(prefix="uiproof-tests-")) / "test.db"
os.environ["SQLITE_DB_PATH"] = str(TEST_DB)

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))

import pytest

from app import create_app
from models.models import db


@pytest.fixture()
def app():
    app = create_app()
    app.config.update(TESTING=True)
    with app.app_context():
        db.drop_all()
        db.create_all()
    yield app


@pytest.fixture()
def client(app):
    return app.test_client()
```

`server/tests/test_health.py`：

```python
def test_health_returns_ok(client):
    response = client.get("/api/health")

    assert response.status_code == 200
```

`server/requirements-dev.txt`：

```text
-r requirements.txt
pytest>=7.4
```

`package.json`：

```json
{
  "name": "uiproof",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/js/*.test.js"
  }
}
```

`tests/js/contract-smoke.test.js`：

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';

test('javascript test runner is wired', () => {
  assert.equal(1 + 1, 2);
});
```

`.github/workflows/ci.yml`：

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -r server/requirements-dev.txt
      - run: pytest server/tests

  javascript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm install
      - run: npm test
```

**Step 2：运行测试，确认基线可执行**

```bash
cd /Users/xxuntilu/projects/UIProof
python3 -m pytest server/tests/test_health.py -q
npm install --package-lock-only
npm test
```

预期：Python 1 个测试通过；JavaScript 1 个测试通过。

**Step 3：提交范围**

本任务只提交测试脚手架、CI 与包管理入口，不修改业务路由。

---

## 任务 2：统一启动端口、包管理文件与本地开发文档

**目标：** 消除 5000/5001 漂移、虚假的 `server/package.json` 与无效的根锁文件，让新贡献者按 README 能启动。

**Files:**
- Modify: `server/app.py`
- Modify: `server/start.sh`
- Modify: `server/stop.sh`
- Modify: `server/logs.sh`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `DEBUG_GUIDE.md`
- Modify: `docs/runtime-sequence.md`
- Delete: `server/package.json`
- Regenerate: `package-lock.json`

**Step 1：写端口与脚本断言**

在 `server/tests/test_health.py` 增加：

```python
def test_app_uses_5001_by_default(client):
    config = client.application.config

    assert config["SERVER_PORT"] == 5001
```

当前 `server/app.py` 没有 `SERVER_PORT` 配置，测试会失败。这是本任务的红灯。

**Step 2：让端口与 debug 可配置**

`server/app.py`：

```python
def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    app.config.setdefault("SERVER_PORT", int(os.environ.get("PORT", "5001")))
    app.config.setdefault("DEBUG", os.environ.get("FLASK_DEBUG", "0") == "1")
    # 其余初始化保持不变
    return app
```

`server/app.py` 末尾：

```python
if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(
        debug=app.config["DEBUG"],
        host="0.0.0.0",
        port=app.config["SERVER_PORT"],
    )
```

`.env.example` 增加：

```dotenv
PORT=5001
FLASK_DEBUG=0
```

**Step 3：重写启动/停止脚本**

`server/start.sh` 使用 PID 文件，不再 `pkill` 所有 Python 进程：

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-5001}"
PID_DIR="$SCRIPT_DIR/.run"
PID_FILE="$PID_DIR/server.pid"
LOG_DIR="$SCRIPT_DIR/logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "服务端已在运行，PID=$(cat "$PID_FILE")"
  exit 0
fi

echo "启动服务端: http://localhost:${PORT}"
PORT="$PORT" nohup python3 app.py >> "$LOG_DIR/app.log" 2>&1 &
echo $! > "$PID_FILE"
echo "PID=$(cat "$PID_FILE")"
```

`server/stop.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/.run/server.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "没有找到运行中的服务端 PID 文件"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "已发送停止信号: PID=$PID"
else
  echo "进程不存在: PID=$PID"
fi

rm -f "$PID_FILE"
```

`server/logs.sh` 改为读取 `logs/app.log`，不再假设 5000 端口。

`.gitignore` 增加：

```gitignore
server/.run/
```

**Step 4：删除失真包文件**

```bash
rm server/package.json
rm -f package-lock.json
npm install --package-lock-only
```

**Step 5：修正文档端口**

将以下文件中的 `localhost:5000`、`port 5000`、`:5000` 改为 5001：

- `README.md`
- `DEBUG_GUIDE.md`
- `docs/runtime-sequence.md`

同时把 `DEBUG_GUIDE.md` 中“直接运行默认 5000”的段落改为：

```markdown
默认运行在 http://localhost:5001，可通过 `PORT` 环境变量覆盖。
```

**Step 6：验证**

```bash
bash -n server/start.sh
bash -n server/stop.sh
bash -n server/logs.sh
python3 -m py_compile server/app.py
python3 -m pytest server/tests/test_health.py -q
rg -n "localhost:5000|port 5000|:5000" README.md DEBUG_GUIDE.md docs server ui-automation-plugin || true
npm test
```

预期：脚本语法通过；健康测试通过；`rg` 无输出；JS 测试通过。

---

## 任务 3：合并 AI 自愈路由并兼容扩展载荷

**目标：** 删除空实现路由对真实 LLM 路由的遮蔽，让扩展的 `{selector, selectorFallbacks, pageUrl, domContext}` 能直接工作。

**Files:**
- Modify: `server/routes/__init__.py`
- Modify: `server/routes/ai_service.py`
- Delete: `server/routes/ai_heal.py`
- Create: `server/tests/test_ai_contract.py`

**Step 1：写失败测试**

`server/tests/test_ai_contract.py`：

```python
import asyncio

from routes.ai_service import _normalize_generate_payload, _normalize_heal_payload


def test_normalize_heal_payload_accepts_extension_fields():
    normalized = _normalize_heal_payload(
        {
            "selector": "button.old",
            "selectorFallbacks": ["[data-testid='submit']"],
            "stepType": "click",
            "pageUrl": "https://example.com",
            "domContext": "<button>提交</button>",
        }
    )

    assert normalized["failed_selector"] == "button.old"
    assert normalized["selector_fallbacks"] == ["[data-testid='submit']"]
    assert normalized["step_type"] == "click"
    assert normalized["page_url"] == "https://example.com"
    assert normalized["html_context"] == "<button>提交</button>"


def test_normalize_heal_payload_accepts_legacy_fields():
    normalized = _normalize_heal_payload(
        {
            "failed_selector": "button.old",
            "html_context": "<button>提交</button>",
            "element_description": "提交按钮",
        }
    )

    assert normalized["failed_selector"] == "button.old"
    assert normalized["html_context"] == "<button>提交</button>"
    assert normalized["element_description"] == "提交按钮"


def test_heal_route_uses_real_normalized_payload(client, monkeypatch):
    async def fake_heal(failed_selector, html_context, description):
        assert failed_selector == "button.old"
        assert html_context == "<button>提交</button>"
        return {"selector": "button[data-testid='submit']", "confidence": 0.9, "reason": "test"}

    monkeypatch.setattr("routes.ai_service._heal_async", fake_heal)

    response = client.post(
        "/api/ai/heal",
        json={
            "selector": "button.old",
            "selectorFallbacks": [],
            "stepType": "click",
            "pageUrl": "https://example.com",
            "domContext": "<button>提交</button>",
        },
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["selector"] == "button[data-testid='submit']"


def test_generate_cases_accepts_extension_fields(client, monkeypatch):
    async def fake_generate(elements, page_url, page_title):
        assert elements[0]["tag"] == "button"
        assert page_url == "https://example.com"
        assert page_title == "示例"
        return {"cases": [{"name": "示例用例"}], "count": 1}

    monkeypatch.setattr("routes.ai_service._generate_async", fake_generate)

    response = client.post(
        "/api/ai/generate-cases",
        json={
            "interactives": [{"tag": "button", "text": "提交"}],
            "pageUrl": "https://example.com",
            "pageTitle": "示例",
        },
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["ok"] is True
    assert body["count"] == 1
```

运行：

```bash
python3 -m pytest server/tests/test_ai_contract.py -q
```

预期：因 `_normalize_heal_payload` 不存在而失败。

**Step 2：加入归一化函数**

在 `server/routes/ai_service.py` 顶部加入：

```python
def _normalize_heal_payload(payload: dict) -> dict:
    return {
        "failed_selector": payload.get("failed_selector") or payload.get("selector") or "",
        "selector_fallbacks": payload.get("selector_fallbacks") or payload.get("selectorFallbacks") or [],
        "step_type": payload.get("step_type") or payload.get("stepType") or "",
        "page_url": payload.get("page_url") or payload.get("pageUrl") or "",
        "html_context": payload.get("html_context") or payload.get("domContext") or "",
        "element_description": payload.get("element_description") or "",
    }


def _normalize_generate_payload(payload: dict) -> dict:
    return {
        "elements": payload.get("elements") or payload.get("interactives") or [],
        "page_url": payload.get("page_url") or payload.get("pageUrl") or "",
        "page_title": payload.get("page_title") or payload.get("pageTitle") or "",
    }
```

**Step 3：改写 `/heal` 与 `/generate-cases`**

`/heal` 路由体改为：

```python
payload = _normalize_heal_payload(request.get_json(silent=True) or {})
failed_selector = payload["failed_selector"]
html_context = payload["html_context"]
element_description = payload["element_description"]

if not html_context:
    return jsonify({"ok": False, "error": "缺少页面上下文"}), 400

try:
    loop = asyncio.new_event_loop()
    result = loop.run_until_complete(
        _heal_async(failed_selector, html_context, element_description)
    )
    loop.close()
    result.setdefault("ok", bool(result.get("selector")))
    return jsonify(result)
except Exception as e:
    logger.error(f"AI 自愈失败: {e}")
    return jsonify({"ok": False, "error": str(e)}), 500
```

`/generate-cases` 路由体改为：

```python
payload = _normalize_generate_payload(request.get_json(silent=True) or {})
elements = payload["elements"]
page_url = payload["page_url"]
page_title = payload["page_title"]

if not elements:
    return jsonify({"ok": False, "error": "缺少页面元素数据"}), 400

try:
    loop = asyncio.new_event_loop()
    result = loop.run_until_complete(
        _generate_async(elements, page_url, page_title)
    )
    loop.close()
    return jsonify({"ok": True, **result})
except Exception as e:
    logger.error(f"AI 生成用例失败: {e}")
    return jsonify({"ok": False, "error": str(e), "cases": []}), 500
```

**Step 4：移除遮蔽路由**

`server/routes/__init__.py` 删除 `ai_heal` 的 import 与注册：

```python
def register_routes(app):
    from . import health, cases, folders
    from . import execution, recording, ai_service, excel_io

    app.register_blueprint(health.bp)
    app.register_blueprint(cases.bp)
    app.register_blueprint(folders.bp)
    app.register_blueprint(execution.bp)
    app.register_blueprint(recording.bp)
    app.register_blueprint(ai_service.bp)
    app.register_blueprint(excel_io.bp)
```

删除文件：

```bash
rm server/routes/ai_heal.py
```

**Step 5：验证**

```bash
python3 -m pytest server/tests/test_ai_contract.py -q
rg -n "ai_heal|call_ai" server/routes || true
python3 -m py_compile server/routes/ai_service.py server/routes/__init__.py
```

预期：测试通过；`rg` 无输出；编译通过。

---

## 任务 4：增加 Run 字段、性能分段表与幂等迁移

**目标：** 让 SQLite 能保存 Run 生命周期与性能分段，同时不破坏已有数据库。

**Files:**
- Modify: `server/models/models.py`
- Create: `server/scripts/migrate_sqlite.py`
- Create: `server/tests/test_migration.py`

**Step 1：写失败测试**

`server/tests/test_migration.py`：

```python
import sqlite3

from scripts.migrate_sqlite import migrate


def test_migrate_adds_run_columns_and_is_idempotent(tmp_path):
    db_path = tmp_path / "old.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE execution_log (
            id INTEGER PRIMARY KEY,
            case_id VARCHAR(36) NOT NULL,
            status VARCHAR(20) NOT NULL,
            task_id VARCHAR(64)
        )
        """
    )
    conn.execute(
        "INSERT INTO execution_log (case_id, status, task_id) VALUES (?, ?, ?)",
        ("case-1", "success", "task-1"),
    )
    conn.commit()
    conn.close()

    migrate(db_path)
    migrate(db_path)

    conn = sqlite3.connect(db_path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(execution_log)")}
    row = conn.execute(
        "SELECT run_id, status, executor FROM execution_log WHERE id = 1"
    ).fetchone()
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    conn.close()

    assert {"run_id", "executor", "perf_mode", "perf_summary", "steps_total"} <= columns
    assert row[0] == "task-1"
    assert row[1] == "passed"
    assert row[2] == "legacy"
    assert "run_perf_segment" in tables
```

运行：

```bash
python3 -m pytest server/tests/test_migration.py -q
```

预期：因 `scripts.migrate_sqlite` 不存在而失败。

**Step 2：扩展模型**

`server/models/models.py` 的 `ExecutionLog` 增加：

```python
run_id = db.Column(db.String(64), unique=True, nullable=False, default=lambda: uuid.uuid4().hex)
executor = db.Column(db.String(20), nullable=False, default="extension")
perf_mode = db.Column(db.String(20))
perf_summary = db.Column(db.Text)
steps_total = db.Column(db.Integer, default=0)
steps_passed = db.Column(db.Integer, default=0)
steps_failed = db.Column(db.Integer, default=0)
client_version = db.Column(db.String(40))
updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
metadata_json = db.Column(db.Text)
```

增加方法：

```python
def get_perf_summary(self) -> dict:
    if not self.perf_summary:
        return {}
    try:
        return json.loads(self.perf_summary)
    except (json.JSONDecodeError, TypeError):
        return {}

def set_perf_summary(self, summary: dict):
    self.perf_summary = json.dumps(summary or {}, ensure_ascii=False)
```

新增表：

```python
class RunPerfSegment(db.Model):
    __tablename__ = "run_perf_segment"

    id = db.Column(db.Integer, primary_key=True)
    run_id = db.Column(db.String(64), nullable=False, index=True)
    segment_index = db.Column(db.Integer, nullable=False)
    scope = db.Column(db.String(10), nullable=False)
    step_index = db.Column(db.Integer)
    heading = db.Column(db.String(200))
    summary_json = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("run_id", "segment_index", name="uq_run_perf_segment_run_index"),
    )
```

**Step 3：写迁移脚本**

`server/scripts/migrate_sqlite.py`：

```python
import sqlite3
import sys
import uuid
from pathlib import Path


def _table_exists(conn, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def _columns(conn, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def _add_column(conn, table: str, name: str, definition: str, columns: set[str]):
    if name not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        columns.add(name)


def migrate(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        if not _table_exists(conn, "execution_log"):
            return

        columns = _columns(conn, "execution_log")
        _add_column(conn, "execution_log", "run_id", "VARCHAR(64)", columns)
        _add_column(conn, "execution_log", "executor", "VARCHAR(20)", columns)
        _add_column(conn, "execution_log", "perf_mode", "VARCHAR(20)", columns)
        _add_column(conn, "execution_log", "perf_summary", "TEXT", columns)
        _add_column(conn, "execution_log", "steps_total", "INTEGER DEFAULT 0", columns)
        _add_column(conn, "execution_log", "steps_passed", "INTEGER DEFAULT 0", columns)
        _add_column(conn, "execution_log", "steps_failed", "INTEGER DEFAULT 0", columns)
        _add_column(conn, "execution_log", "client_version", "VARCHAR(40)", columns)
        _add_column(conn, "execution_log", "updated_at", "DATETIME", columns)
        _add_column(conn, "execution_log", "metadata_json", "TEXT", columns)

        rows = conn.execute(
            "SELECT id, task_id FROM execution_log WHERE run_id IS NULL OR run_id = ''"
        ).fetchall()
        for row_id, task_id in rows:
            conn.execute(
                "UPDATE execution_log SET run_id = ? WHERE id = ?",
                (task_id or uuid.uuid4().hex, row_id),
            )

        conn.execute(
            "UPDATE execution_log SET status = 'passed' "
            "WHERE status IN ('success', 'completed')"
        )
        conn.execute(
            "UPDATE execution_log SET executor = 'legacy' "
            "WHERE executor IS NULL OR executor = ''"
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_execution_log_run_id "
            "ON execution_log(run_id)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS run_perf_segment (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id VARCHAR(64) NOT NULL,
                segment_index INTEGER NOT NULL,
                scope VARCHAR(10) NOT NULL,
                step_index INTEGER,
                heading VARCHAR(200),
                summary_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_run_perf_segment_run_index UNIQUE (run_id, segment_index)
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    default_path = Path(__file__).resolve().parents[1] / "instance" / "automation_cases.db"
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else default_path
    migrate(target)
    print(f"migrated: {target}")
```

**Step 4：验证**

```bash
python3 -m pytest server/tests/test_migration.py -q
python3 -m py_compile server/models/models.py server/scripts/migrate_sqlite.py
```

预期：迁移测试通过；重复执行不报错。

---

## 任务 5：实现 Run 契约、服务与 HTTP 路由

**目标：** 提供 `/api/runs` 的创建、追加性能分段、结束、查询能力，并在事务内更新用例统计。

**Files:**
- Create: `server/contracts/__init__.py`
- Create: `server/contracts/runs.py`
- Create: `server/services/__init__.py`
- Create: `server/services/run_service.py`
- Create: `server/routes/runs.py`
- Modify: `server/routes/__init__.py`
- Create: `server/tests/test_runs_api.py`

**Step 1：写失败测试**

`server/tests/test_runs_api.py`：

```python
from models.models import TestCase, db


def _create_case(app):
    with app.app_context():
        case = TestCase(case_id="case-1", name="登录用例", steps="[]")
        db.session.add(case)
        db.session.commit()
        return case.case_id


def test_create_run_and_finish(client, app):
    case_id = _create_case(app)

    created = client.post(
        "/api/runs",
        json={
            "case_id": case_id,
            "executor": "extension",
            "perf_mode": "step",
            "steps_total": 2,
            "client_version": "1.0.0",
        },
    )
    assert created.status_code == 201
    run_id = created.get_json()["run_id"]

    segment = client.post(
        f"/api/runs/{run_id}/perf-segments",
        json={
            "scope": "step",
            "step_index": 0,
            "heading": "登录用例 步骤 1",
            "summary": {"collectionMode": "Tracing", "totalEvents": 10},
        },
    )
    assert segment.status_code == 201
    assert segment.get_json()["segment_index"] == 0

    finished = client.post(
        f"/api/runs/{run_id}/finish",
        json={
            "status": "passed",
            "final_result": "pass",
            "steps_result": [{"index": 0, "status": "passed"}],
            "perf_summary": {"collectionMode": "Tracing", "totalEvents": 10},
        },
    )
    assert finished.status_code == 200
    body = finished.get_json()
    assert body["status"] == "passed"
    assert body["case_stats"]["execution_count"] == 1

    detail = client.get(f"/api/runs/{run_id}")
    assert detail.status_code == 200
    detail_body = detail.get_json()
    assert detail_body["status"] == "passed"
    assert detail_body["segments"][0]["heading"] == "登录用例 步骤 1"


def test_finish_is_idempotent(client, app):
    case_id = _create_case(app)
    run_id = client.post(
        "/api/runs",
        json={"case_id": case_id, "executor": "extension", "perf_mode": "none"},
    ).get_json()["run_id"]

    first = client.post(f"/api/runs/{run_id}/finish", json={"status": "passed"})
    second = client.post(f"/api/runs/{run_id}/finish", json={"status": "passed"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.get_json()["case_stats"]["execution_count"] == 1
```

运行：

```bash
python3 -m pytest server/tests/test_runs_api.py -q
```

预期：404 或导入失败。

**Step 2：实现契约**

`server/contracts/runs.py`：

```python
from dataclasses import dataclass, field
from typing import Any

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
    client_version: str | None = None


@dataclass(frozen=True)
class PerfSegmentCreate:
    scope: str
    step_index: int | None
    heading: str
    summary: dict[str, Any]


@dataclass(frozen=True)
class RunFinish:
    status: str
    final_result: str | None = None
    steps_result: list[Any] = field(default_factory=list)
    error_message: str | None = None
    perf_summary: dict[str, Any] | None = None


def parse_run_create(payload: dict) -> RunCreate:
    case_id = str(payload.get("case_id") or "").strip()
    if not case_id:
        raise ContractError("缺少 case_id")
    executor = payload.get("executor") or "extension"
    if executor not in VALID_EXECUTORS:
        raise ContractError(f"不支持的 executor: {executor}")
    perf_mode = payload.get("perf_mode") or "none"
    if perf_mode not in VALID_PERF_MODES:
        raise ContractError(f"不支持的 perf_mode: {perf_mode}")
    steps_total = int(payload.get("steps_total") or 0)
    if steps_total < 0:
        raise ContractError("steps_total 不能为负数")
    return RunCreate(
        case_id=case_id,
        executor=executor,
        perf_mode=perf_mode,
        steps_total=steps_total,
        client_version=payload.get("client_version"),
    )


def parse_perf_segment(payload: dict) -> PerfSegmentCreate:
    scope = payload.get("scope") or "case"
    if scope not in VALID_SCOPES:
        raise ContractError(f"不支持的 scope: {scope}")
    step_index = payload.get("step_index")
    if scope == "step":
        if step_index is None:
            raise ContractError("step 分段必须提供 step_index")
        step_index = int(step_index)
        if step_index < 0:
            raise ContractError("step_index 不能为负数")
    else:
        step_index = None
    summary = payload.get("summary")
    if not isinstance(summary, dict):
        raise ContractError("summary 必须是对象")
    return PerfSegmentCreate(
        scope=scope,
        step_index=step_index,
        heading=str(payload.get("heading") or "性能采集"),
        summary=summary,
    )


def parse_run_finish(payload: dict) -> RunFinish:
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
```

**Step 3：实现服务**

`server/services/run_service.py` 至少包含：

```python
from datetime import datetime

from sqlalchemy import func

from models.models import ExecutionLog, RunPerfSegment, TestCase, db
from contracts.runs import (
    ContractError,
    parse_perf_segment,
    parse_run_create,
    parse_run_finish,
)


def _serialize_status(status: str) -> str:
    if status in ("success", "completed"):
        return "passed"
    return status


def create_run(payload: dict) -> ExecutionLog:
    data = parse_run_create(payload)
    case = TestCase.query.filter_by(case_id=data.case_id).first()
    if not case:
        raise LookupError("用例不存在")
    run = ExecutionLog(
        case_id=data.case_id,
        status="running",
        executor=data.executor,
        perf_mode=data.perf_mode,
        steps_total=data.steps_total,
        client_version=data.client_version,
    )
    db.session.add(run)
    db.session.commit()
    return run


def append_perf_segment(run_id: str, payload: dict) -> RunPerfSegment:
    run = ExecutionLog.query.filter_by(run_id=run_id).first()
    if not run:
        raise LookupError("运行不存在")
    if _serialize_status(run.status) != "running":
        raise ContractError("运行已结束，不能追加性能分段")

    data = parse_perf_segment(payload)
    next_index = (
        db.session.query(func.coalesce(func.max(RunPerfSegment.segment_index), -1) + 1)
        .filter(RunPerfSegment.run_id == run_id)
        .scalar()
    )
    segment = RunPerfSegment(
        run_id=run_id,
        segment_index=next_index,
        scope=data.scope,
        step_index=data.step_index,
        heading=data.heading,
    )
    segment.summary_json = __import__("json").dumps(data.summary, ensure_ascii=False)
    db.session.add(segment)
    db.session.commit()
    return segment


def finish_run(run_id: str, payload: dict) -> tuple[ExecutionLog, dict]:
    run = ExecutionLog.query.filter_by(run_id=run_id).first()
    if not run:
        raise LookupError("运行不存在")
    data = parse_run_finish(payload)

    if _serialize_status(run.status) != "running":
        return run, _case_stats(run.case_id)

    run.status = data.status
    run.end_time = datetime.utcnow()
    run.updated_at = datetime.utcnow()
    run.final_result = data.final_result
    run.error_message = data.error_message
    run.set_steps_result(data.steps_result)
    if data.perf_summary is not None:
        run.set_perf_summary(data.perf_summary)

    case = TestCase.query.filter_by(case_id=run.case_id).first()
    if case:
        case.execution_count = (case.execution_count or 0) + 1
        case.last_executed = datetime.utcnow()
        total = case.execution_count
        passed = int((case.success_rate or 0.0) * (total - 1))
        if data.status == "passed":
            passed += 1
        case.success_rate = passed / total if total else 0.0

    db.session.commit()
    return run, _case_stats(run.case_id)


def _case_stats(case_id: str) -> dict:
    case = TestCase.query.filter_by(case_id=case_id).first()
    if not case:
        return {"execution_count": 0, "success_rate": 0.0}
    return {
        "execution_count": case.execution_count or 0,
        "success_rate": case.success_rate or 0.0,
    }
```

`server/contracts/runs.py` 还需要 `serialize_run(run, segments)`：

```python
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
```

**Step 4：实现路由**

`server/routes/runs.py`：

```python
import json

from flask import Blueprint, jsonify, request

from contracts.runs import ContractError, serialize_run
from models.models import ExecutionLog, RunPerfSegment
from services.run_service import append_perf_segment, create_run, finish_run

bp = Blueprint("runs", __name__, url_prefix="/api")


@bp.route("/runs", methods=["POST"])
def create_run_route():
    try:
        run = create_run(request.get_json(silent=True) or {})
    except ContractError as error:
        return jsonify({"error": str(error)}), 400
    except LookupError as error:
        return jsonify({"error": str(error)}), 404
    return jsonify(serialize_run(run)), 201


@bp.route("/runs/<run_id>", methods=["GET"])
def get_run_route(run_id):
    run = ExecutionLog.query.filter_by(run_id=run_id).first()
    if not run:
        return jsonify({"error": "运行不存在"}), 404
    segments = (
        RunPerfSegment.query.filter_by(run_id=run_id)
        .order_by(RunPerfSegment.segment_index.asc())
        .all()
    )
    segment_payload = [
        {
            "segment_id": segment.id,
            "segment_index": segment.segment_index,
            "scope": segment.scope,
            "step_index": segment.step_index,
            "heading": segment.heading,
            "summary": json.loads(segment.summary_json),
        }
        for segment in segments
    ]
    return jsonify(serialize_run(run, segment_payload))


@bp.route("/runs/<run_id>/perf-segments", methods=["POST"])
def append_perf_segment_route(run_id):
    try:
        segment = append_perf_segment(run_id, request.get_json(silent=True) or {})
    except ContractError as error:
        return jsonify({"error": str(error)}), 400
    except LookupError as error:
        return jsonify({"error": str(error)}), 404
    return jsonify(
        {
            "segment_id": segment.id,
            "run_id": segment.run_id,
            "segment_index": segment.segment_index,
        }
    ), 201


@bp.route("/runs/<run_id>/finish", methods=["POST"])
def finish_run_route(run_id):
    try:
        run, case_stats = finish_run(run_id, request.get_json(silent=True) or {})
    except ContractError as error:
        return jsonify({"error": str(error)}), 400
    except LookupError as error:
        return jsonify({"error": str(error)}), 404
    return jsonify(
        {
            "run_id": run.run_id,
            "status": serialize_run(run)["status"],
            "finished_at": run.end_time.isoformat() if run.end_time else None,
            "case_stats": case_stats,
        }
    )


@bp.route("/runs/<run_id>/perf", methods=["GET"])
def get_run_perf_route(run_id):
    run = ExecutionLog.query.filter_by(run_id=run_id).first()
    if not run:
        return jsonify({"error": "运行不存在"}), 404
    segments = (
        RunPerfSegment.query.filter_by(run_id=run_id)
        .order_by(RunPerfSegment.segment_index.asc())
        .all()
    )
    return jsonify(
        {
            "run_id": run_id,
            "perf_mode": run.perf_mode,
            "perf_summary": run.get_perf_summary(),
            "segments": [
                {
                    "segment_index": segment.segment_index,
                    "scope": segment.scope,
                    "step_index": segment.step_index,
                    "heading": segment.heading,
                    "summary": json.loads(segment.summary_json),
                }
                for segment in segments
            ],
        }
    )


@bp.route("/cases/<case_id>/runs", methods=["GET"])
def list_case_runs_route(case_id):
    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 10, type=int), 100)
    query = ExecutionLog.query.filter_by(case_id=case_id).order_by(
        ExecutionLog.start_time.desc()
    )
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    return jsonify(
        {
            "runs": [serialize_run(run) for run in pagination.items],
            "total": pagination.total,
            "pages": pagination.pages,
            "current_page": page,
        }
    )
```

`server/routes/__init__.py` 注册：

```python
from . import runs
app.register_blueprint(runs.bp)
```

**Step 5：验证**

```bash
python3 -m pytest server/tests/test_runs_api.py -q
python3 -m pytest server/tests -q
```

预期：Run API 测试通过；既有健康与 AI 测试不回归。

---

## 任务 6：废弃伪造执行接口

**目标：** 让 `/api/cases/<case_id>/execute` 不再制造假成功记录。

**Files:**
- Modify: `server/routes/cases.py`
- Create: `server/tests/test_execute_deprecated.py`

**Step 1：写失败测试**

`server/tests/test_execute_deprecated.py`：

```python
from models.models import TestCase, db


def test_legacy_execute_is_gone(client, app):
    with app.app_context():
        db.session.add(TestCase(case_id="case-1", name="登录用例", steps="[]"))
        db.session.commit()

    response = client.post("/api/cases/case-1/execute")

    assert response.status_code == 410
    body = response.get_json()
    assert body["error"] == "deprecated"
    assert "POST /api/runs" in body["message"]
```

运行：

```bash
python3 -m pytest server/tests/test_execute_deprecated.py -q
```

预期：当前返回 200，测试失败。

**Step 2：替换路由实现**

将 `server/routes/cases.py:286` 的 `execute_case` 函数整体替换为：

```python
@bp.route('/cases/<case_id>/execute', methods=['POST'])
def execute_case(case_id):
    return jsonify({
        'error': 'deprecated',
        'message': (
            'Use POST /api/runs to create a run and '
            'POST /api/runs/<run_id>/finish to finish it.'
        ),
    }), 410
```

**Step 3：验证**

```bash
python3 -m pytest server/tests/test_execute_deprecated.py -q
python3 -m py_compile server/routes/cases.py
```

预期：测试通过；编译通过。

---

## 任务 7：新增扩展 RunClient 与 PerfSession

**目标：** 把扩展对 `/api/runs` 的调用与 CDP Tracing 会话封装成可测试的纯模块，不直接改 UI。

**Files:**
- Create: `ui-automation-plugin/modules/runs/run-client.js`
- Create: `ui-automation-plugin/modules/perf/perf-session.js`
- Create: `tests/js/run-client.test.js`
- Create: `tests/js/perf-session.test.js`

**Step 1：写失败测试**

`tests/js/run-client.test.js`：

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';

import { RunClient } from '../../ui-automation-plugin/modules/runs/run-client.js';

test('createRun posts the canonical payload', async () => {
  const calls = [];
  const client = new RunClient({
    serverUrl: 'http://localhost:5001',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ run_id: 'run-1', status: 'running' }) };
    },
  });

  const result = await client.createRun({
    caseId: 'case-1',
    perfMode: 'step',
    stepsTotal: 2,
    clientVersion: '1.0.0',
  });

  assert.equal(result.run_id, 'run-1');
  assert.equal(calls[0].url, 'http://localhost:5001/api/runs');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    case_id: 'case-1',
    executor: 'extension',
    perf_mode: 'step',
    steps_total: 2,
    client_version: '1.0.0',
  });
});

test('appendPerfSegment posts to the run segment endpoint', async () => {
  const calls = [];
  const client = new RunClient({
    serverUrl: 'http://localhost:5001',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ segment_index: 0 }) };
    },
  });

  await client.appendPerfSegment('run-1', {
    scope: 'step',
    stepIndex: 0,
    heading: '步骤 1',
    summary: { totalEvents: 10 },
  });

  assert.equal(calls[0].url, 'http://localhost:5001/api/runs/run-1/perf-segments');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    scope: 'step',
    step_index: 0,
    heading: '步骤 1',
    summary: { totalEvents: 10 },
  });
});
```

`tests/js/perf-session.test.js`：

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';

import { PerfSession, buildPerfSegment } from '../../ui-automation-plugin/modules/perf/perf-session.js';

test('PerfSession starts and stops tracing', async () => {
  const started = [];
  const stopped = [];
  const session = new PerfSession({
    tabId: 7,
    start: async (tabId) => {
      started.push(tabId);
      return { ok: true };
    },
    stop: async (tabId) => {
      stopped.push(tabId);
      return { ok: true, summary: { totalEvents: 42 } };
    },
  });

  await session.start();
  const summary = await session.stop();

  assert.deepEqual(started, [7]);
  assert.deepEqual(stopped, [7]);
  assert.equal(summary.totalEvents, 42);
});

test('buildPerfSegment normalizes scope and step index', () => {
  const segment = buildPerfSegment({
    heading: '步骤 1',
    scope: 'step',
    stepIndex: 0,
    summary: { totalEvents: 1 },
  });

  assert.deepEqual(segment, {
    heading: '步骤 1',
    scope: 'step',
    stepIndex: 0,
    summary: { totalEvents: 1 },
  });
});
```

运行：

```bash
npm test
```

预期：因模块不存在而失败。

**Step 2：实现 RunClient**

`ui-automation-plugin/modules/runs/run-client.js`：

```javascript
export class RunClient {
  constructor({ serverUrl, fetchImpl = fetch } = {}) {
    this.serverUrl = serverUrl || 'http://localhost:5001';
    this.fetchImpl = fetchImpl;
  }

  async _request(path, options = {}) {
    const response = await this.fetchImpl(`${this.serverUrl}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.error || `请求失败: ${response.status}`);
    }
    return body;
  }

  async createRun({ caseId, perfMode = 'none', stepsTotal = 0, clientVersion = '1.0.0' }) {
    return this._request('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        case_id: caseId,
        executor: 'extension',
        perf_mode: perfMode,
        steps_total: stepsTotal,
        client_version: clientVersion,
      }),
    });
  }

  async updateRun(runId, patch) {
    return this._request(`/api/runs/${runId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async appendPerfSegment(runId, { scope, stepIndex = null, heading, summary }) {
    return this._request(`/api/runs/${runId}/perf-segments`, {
      method: 'POST',
      body: JSON.stringify({
        scope,
        step_index: stepIndex,
        heading,
        summary,
      }),
    });
  }

  async finishRun(runId, {
    status,
    finalResult = null,
    stepsResult = [],
    errorMessage = null,
    perfSummary = null,
  }) {
    return this._request(`/api/runs/${runId}/finish`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        final_result: finalResult,
        steps_result: stepsResult,
        error_message: errorMessage,
        perf_summary: perfSummary,
      }),
    });
  }

  async getRun(runId) {
    return this._request(`/api/runs/${runId}`);
  }
}
```

**Step 3：实现 PerfSession**

`ui-automation-plugin/modules/perf/perf-session.js`：

```javascript
import {
  extensionPerfTracingStart,
  extensionPerfTracingStop,
} from './perf-client.js';

export class PerfSession {
  constructor({ tabId, start = extensionPerfTracingStart, stop = extensionPerfTracingStop }) {
    this.tabId = tabId;
    this.startTracing = start;
    this.stopTracing = stop;
    this.active = false;
  }

  async start() {
    const result = await this.startTracing(this.tabId);
    this.active = Boolean(result && result.ok);
    return result;
  }

  async stop() {
    if (!this.active) return null;
    this.active = false;
    const result = await this.stopTracing(this.tabId);
    if (!result || !result.ok) return null;
    return result.summary || {};
  }
}

export function buildPerfSegment({ heading, scope = 'case', stepIndex = null, summary }) {
  return {
    heading: heading || '性能采集',
    scope,
    stepIndex: scope === 'step' ? stepIndex : null,
    summary: summary || {},
  };
}
```

**Step 4：验证**

```bash
npm test
```

预期：新增 4 个 JS 测试通过。

---

## 任务 8：抽出 RunCoordinator 并接入 case-manager

**目标：** 把“执行、性能启停、Run 写入、结束”从 `case-manager.js` 移到独立协调器，`case-manager` 只保留 UI 与批量循环。

**Files:**
- Create: `ui-automation-plugin/modules/runs/run-coordinator.js`
- Modify: `ui-automation-plugin/modules/managers/case-manager.js`
- Create: `tests/js/run-coordinator.test.js`

**Step 1：写失败测试**

`tests/js/run-coordinator.test.js`：

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';

import { RunCoordinator } from '../../ui-automation-plugin/modules/runs/run-coordinator.js';

function createFakeClient() {
  const calls = [];
  return {
    calls,
    async createRun(payload) {
      calls.push(['createRun', payload]);
      return { run_id: 'run-1' };
    },
    async appendPerfSegment(runId, segment) {
      calls.push(['appendPerfSegment', runId, segment]);
    },
    async finishRun(runId, payload) {
      calls.push(['finishRun', runId, payload]);
      return { run_id: runId, status: payload.status };
    },
  };
}

test('step perf mode creates one segment per step', async () => {
  const client = createFakeClient();
  const driver = {
    async executeStep(step) {
      return { success: true, step };
    },
  };
  const coordinator = new RunCoordinator({
    runClient: client,
    driver,
    createPerfSession: () => ({
      async start() {},
      async stop() {
        return { totalEvents: 1 };
      },
    }),
  });

  await coordinator.runCase({
    caseItem: { name: '登录用例' },
    steps: [{ type: 'click' }, { type: 'input' }],
    perfMode: 'step',
  });

  const segments = client.calls.filter((call) => call[0] === 'appendPerfSegment');
  assert.equal(segments.length, 2);
  assert.equal(segments[0][2].scope, 'step');
  assert.equal(segments[1][2].stepIndex, 1);
  assert.equal(client.calls.at(-1)[0], 'finishRun');
  assert.equal(client.calls.at(-1)[2].status, 'passed');
});

test('execution error finishes the run as error', async () => {
  const client = createFakeClient();
  const driver = {
    async executeStep() {
      throw new Error('step failed');
    },
  };
  const coordinator = new RunCoordinator({ runClient: client, driver });

  await assert.rejects(() => coordinator.runCase({
    caseItem: { name: '失败用例' },
    steps: [{ type: 'click' }],
    perfMode: 'none',
  }));

  assert.equal(client.calls.at(-1)[0], 'finishRun');
  assert.equal(client.calls.at(-1)[2].status, 'error');
});
```

运行：

```bash
npm test
```

预期：因 `RunCoordinator` 不存在而失败。

**Step 2：实现 RunCoordinator**

`ui-automation-plugin/modules/runs/run-coordinator.js`：

```javascript
import { PerfSession, buildPerfSegment } from '../perf/perf-session.js';

export class RunCoordinator {
  constructor({ runClient, driver, createPerfSession, onPerfSummary } = {}) {
    this.runClient = runClient;
    this.driver = driver;
    this.createPerfSession = createPerfSession || ((tabId) => new PerfSession({ tabId }));
    this.onPerfSummary = onPerfSummary || (() => {});
  }

  async runCase({ caseItem, steps, perfMode = 'none' }) {
    const run = await this.runClient.createRun({
      caseId: caseItem.case_id || caseItem.id,
      perfMode,
      stepsTotal: steps.length,
    });
    const segments = [];
    const stepsResult = [];

    try {
      if (perfMode === 'case') {
        const summary = await this._runWholeCase(caseItem, steps, stepsResult);
        if (summary) {
          const segment = buildPerfSegment({
            heading: `用例「${caseItem.name}」整条用例`,
            scope: 'case',
            summary,
          });
          segments.push(segment);
        }
      } else if (perfMode === 'step') {
        for (let index = 0; index < steps.length; index += 1) {
          const summary = await this._runSingleStep(caseItem, steps[index], index, stepsResult);
          if (summary) {
            segments.push(buildPerfSegment({
              heading: `用例「${caseItem.name}」步骤 ${index + 1}`,
              scope: 'step',
              stepIndex: index,
              summary,
            }));
          }
        }
      } else {
        for (const step of steps) {
          stepsResult.push(await this.driver.executeStep(step));
        }
      }

      for (const segment of segments) {
        await this.runClient.appendPerfSegment(run.run_id, segment);
        this.onPerfSummary(segment.summary, segment.heading);
      }

      const finish = await this.runClient.finishRun(run.run_id, {
        status: 'passed',
        finalResult: 'pass',
        stepsResult,
        perfSummary: segments.length ? segments[segments.length - 1].summary : null,
      });
      return { run, segments, finish };
    } catch (error) {
      await this.runClient.finishRun(run.run_id, {
        status: 'error',
        finalResult: 'error',
        stepsResult,
        errorMessage: error.message || String(error),
      });
      throw error;
    }
  }

  async _runSingleStep(caseItem, step, index, stepsResult) {
    const session = this.createPerfSession(this.driver.tabId);
    await session.start();
    let summary = null;
    try {
      stepsResult.push(await this.driver.executeStep(step));
    } finally {
      summary = await session.stop();
    }
    return summary;
  }

  async _runWholeCase(caseItem, steps, stepsResult) {
    const session = this.createPerfSession(this.driver.tabId);
    await session.start();
    let summary = null;
    try {
      for (const step of steps) {
        stepsResult.push(await this.driver.executeStep(step));
      }
    } finally {
      summary = await session.stop();
    }
    return summary;
  }
}
```

**Step 3：在 case-manager 中提供 driver**

在 `ui-automation-plugin/modules/managers/case-manager.js` 增加 import：

```javascript
import { RunClient } from '../runs/run-client.js';
import { RunCoordinator } from '../runs/run-coordinator.js';
```

增加方法：

```javascript
_createRunCoordinator(tabId) {
  const driver = {
    tabId,
    executeStep: (step) => this._executeSingleStepViaBackground(tabId, step),
  };
  return new RunCoordinator({
    runClient: new RunClient({ serverUrl: this.SERVER_URL }),
    driver,
    onPerfSummary: (summary, heading) => this.appendPerfResultSummary(summary, heading),
  });
}

async _executeSingleStepViaBackground(tabId, step) {
  const response = await chrome.runtime.sendMessage({
    type: 'startExecution',
    steps: [step],
    intervalMs: 0,
    tabId,
  });
  if (!response || !response.ok) {
    throw new Error(response?.message || '启动步骤执行失败');
  }
  return this._waitForExecutionResult();
}
```

`_waitForExecutionResult()` 从现有 `_performBatchExecute()` 的轮询逻辑抽出：

```javascript
async _waitForExecutionResult() {
  const maxWaitTime = 30000;
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitTime) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const state = await chrome.storage.local.get('uiap_execution_state');
    if (!state.uiap_execution_state || !state.uiap_execution_state.isExecuting) {
      const resultData = await chrome.storage.local.get('uiap_execution_result');
      const result = resultData.uiap_execution_result || { success: true };
      await chrome.storage.local.remove('uiap_execution_state');
      await chrome.storage.local.remove('uiap_execution_result');
      if (result.success === false) {
        throw new Error(result.reason || '步骤执行失败');
      }
      return result;
    }
  }
  throw new Error('步骤执行超时');
}
```

把 `_executeCaseStepsWithPerfPerStep` 与 `_executeCaseWithPerfWholeCase` 改为薄包装：

```javascript
async _executeCaseStepsWithPerfPerStep(caseItem, steps) {
  const tabId = await this.getActivePageTabId();
  if (!tabId) throw new Error('无法获取当前标签页');
  const coordinator = this._createRunCoordinator(tabId);
  return coordinator.runCase({ caseItem, steps, perfMode: 'step' });
}

async _executeCaseWithPerfWholeCase(caseItem, steps) {
  const tabId = await this.getActivePageTabId();
  if (!tabId) throw new Error('无法获取当前标签页');
  const coordinator = this._createRunCoordinator(tabId);
  return coordinator.runCase({ caseItem, steps, perfMode: 'case' });
}
```

同时把 `_performBatchExecute()` 中两处 `fetch(`${this.SERVER_URL}/api/cases/${caseId}/execute`, ...)` 删除；Run 的结束由 `RunCoordinator` 负责。

**Step 4：验证**

```bash
npm test
node --check ui-automation-plugin/modules/runs/run-coordinator.js
node --check ui-automation-plugin/modules/managers/case-manager.js
```

预期：RunCoordinator 测试通过；语法检查通过。

---

## 任务 9：补齐停止语义与性能报告数据来源

**目标：** 用户停止执行时，Run 能落到 `stopped`；性能报告优先使用 RunCoordinator 返回的分段，而不是只依赖内存数组。

**Files:**
- Modify: `ui-automation-plugin/background.js`
- Modify: `ui-automation-plugin/modules/managers/case-manager.js`
- Modify: `server/routes/execution.py`
- Modify: `server/tests/test_runs_api.py`

**Step 1：扩展后台停止协议**

`ui-automation-plugin/background.js` 的 `stopExecution` 分支改为：

```javascript
if (msg && msg.type === 'stopExecution') {
  executionState.isExecuting = false;
  executionState.stopRequested = true;
  await chrome.storage.local.remove('uiap_execution_state');
  sendResponse({ ok: true, stoppedAt: Date.now() });
  return;
}
```

在 `executeSteps()` 的 while 循环开头增加：

```javascript
if (executionState.stopRequested) {
  break;
}
```

`startExecution` 分支重置：

```javascript
executionState.stopRequested = false;
```

**Step 2：RunCoordinator 支持停止**

`RunCoordinator` 增加：

```javascript
async stop(runId) {
  if (this.driver.stop) {
    await this.driver.stop();
  }
  return this.runClient.finishRun(runId, {
    status: 'stopped',
    finalResult: 'stopped',
  });
}
```

`case-manager` 的 driver 增加：

```javascript
stop: () => chrome.runtime.sendMessage({ type: 'stopExecution' }),
```

`_performBatchExecute()` 的失败分支中，如果 `error.message === '步骤执行超时'`，调用 `coordinator.stop(run_id)`，避免 Run 长时间停留在 `running`。

**Step 3：服务端 Playwright 停止标记**

`server/routes/execution.py` 的 `stop_execution` 增加：

```python
task["status"] = "stopped"
task["stop_requested"] = True
```

`_run_in_thread()` 成功结束后检查：

```python
task = _execution_tasks.get(task_id)
if task and task.get("stop_requested"):
    log.status = "stopped"
    log.final_result = "stopped"
else:
    log.status = "completed"
    log.final_result = result.get("final_result", "unknown")
```

这不是抢占式取消，但能保证停止请求被记录，文档中明确说明。

**Step 4：性能报告使用 Run 分段**

`case-manager.js` 的 `_performBatchExecute()` 收集：

```javascript
const runResults = [];
// 每次 coordinator.runCase(...) 后
runResults.push({ caseName: caseItem.name, segments: result.segments });
```

报告生成改为：

```javascript
const segments = runResults.flatMap((item) =>
  item.segments.map((segment) => ({
    heading: `${item.caseName} · ${segment.heading}`,
    summary: segment.summary,
  }))
);
const html = generatePerfReportHtml({
  title: reportTitle,
  perfMode: perfMode === 'case' ? '整条用例' : '单步',
  segments,
  generatedAt: new Date().toLocaleString(),
});
```

移除 `_perfReportSegments` 的写入与清空逻辑，保留 `lastPerfReportBlobUrl`。

**Step 5：验证**

```bash
npm test
python3 -m pytest server/tests/test_runs_api.py -q
node --check ui-automation-plugin/background.js
node --check ui-automation-plugin/modules/managers/case-manager.js
```

预期：测试通过；语法检查通过；手动停止时 Run 状态为 `stopped`。

---

## 任务 10：统一文档与最终验收

**目标：** 让 README、运行时序、调试指南与新架构一致，并完成端到端验收。

**Files:**
- Modify: `README.md`
- Modify: `DEBUG_GUIDE.md`
- Modify: `docs/runtime-sequence.md`
- Modify: `docs/specs/2026-06-01-ai-testing-architecture.md`
- Create: `docs/api/runs.md`

**Step 1：README 只保留一条主路径**

README 的结构改为：

```markdown
## 快速开始
1. 启动 Flask：cd server && ./start.sh（默认 5001）
2. 加载扩展：chrome://extensions → 加载 ui-automation-plugin/
3. 录制用例
4. 可见执行
5. 查看 Run 与性能分段
```

删除“AI 执行是唯一执行路径”的表述，改为：

```markdown
默认执行路径是扩展内可见执行；服务端 Playwright 执行器是可选能力。
```

**Step 2：新增 Run API 文档**

`docs/api/runs.md` 写明：

- `POST /api/runs`
- `POST /api/runs/<run_id>/perf-segments`
- `POST /api/runs/<run_id>/finish`
- `GET /api/runs/<run_id>`
- `GET /api/cases/<case_id>/runs`
- 状态机与幂等规则

**Step 3：标记历史设计文档**

在 `docs/specs/2026-06-01-ai-testing-architecture.md` 顶部加：

```markdown
> 历史设计文档：执行与性能接口以 `docs/superpowers/specs/2026-11-07-uiproof-architecture-cleanup-design.md` 为准。
```

**Step 4：更新运行时序**

`docs/runtime-sequence.md` 把性能段落改为：

```text
CaseManager -> RunCoordinator -> RunClient -> POST /api/runs
RunCoordinator -> PerfSession -> background perfTracingStart/Stop
RunCoordinator -> POST /api/runs/<run_id>/perf-segments
RunCoordinator -> POST /api/runs/<run_id>/finish
Flask -> SQLite execution_log + run_perf_segment
```

删除“执行成功后 POST /api/cases/:id/execute”的旧描述。

**Step 5：最终验收命令**

```bash
cd /Users/xxuntilu/projects/UIProof
python3 -m pytest server/tests -q
npm test
bash -n server/start.sh
bash -n server/stop.sh
python3 -m py_compile server/app.py server/models/models.py server/routes/runs.py server/services/run_service.py
rg -n "localhost:5000|port 5000|:5000|/api/cases/.*/execute" README.md DEBUG_GUIDE.md docs server ui-automation-plugin || true
```

预期：Python 与 JS 测试全绿；脚本与编译检查通过；`rg` 只允许在“废弃接口说明”与测试文件中出现旧路径。

**Step 6：手动验收**

1. 备份并迁移本地 SQLite：

```bash
cp server/instance/automation_cases.db server/instance/automation_cases.db.bak
python3 server/scripts/migrate_sqlite.py
```

2. 启动服务端：

```bash
cd server
./start.sh
curl http://localhost:5001/api/health
```

3. 加载扩展，录制 3 步用例，执行“单步性能”与“整条用例性能”。
4. 调用：

```bash
curl http://localhost:5001/api/cases/<case_id>/runs
curl http://localhost:5001/api/runs/<run_id>
```

5. 确认：
   - 单步模式有 3 个 `scope=step` 分段；
   - 整条模式有 1 个 `scope=case` 分段；
   - Run 状态为 `passed`；
   - 停止执行后状态为 `stopped`；
   - `/api/ai/heal` 返回真实选择器；
   - 旧 `/api/cases/<id>/execute` 返回 410。

---

## 自检

- [x] 每个任务有明确文件路径与接口。
- [x] 每个行为变更都有失败测试与验证命令。
- [x] 覆盖规范中的 Run 生命周期、性能分段、AI 路由、旧接口废弃、文档与 CI。
- [x] 没有 `TODO`、`TBD` 或占位实现。
- [x] 未引入新框架或服务。
- [x] 未修改录制器与 Content Script 的核心 DOM 操作。

## 执行方式

有两种执行方式：

1. **Subagent-driven：** 每个任务交给一个子代理，主线程负责审查与集成；适合并行推进独立任务。
2. **Inline：** 在当前会话按任务顺序逐个执行；适合需要频繁人工确认数据库与扩展行为的情况。

推荐先执行任务 1–6（服务端与测试基线），再执行任务 7–9（扩展），最后执行任务 10（文档与验收）。服务端与扩展可以在任务 5 完成后并行。
