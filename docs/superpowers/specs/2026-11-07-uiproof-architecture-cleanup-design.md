# UIProof 架构清理设计：可见执行与性能运行记录

- 日期：2026-11-07
- 状态：待评审（Draft for review）
- 范围：架构与契约设计，不包含运行时实现
- 关联计划：`docs/superpowers/plans/2026-11-07-uiproof-architecture-cleanup.md`

## 1. 结论

UIProof 采用“扩展执行、服务端记账”的分层方式，不做平台级重写：

1. Chrome 扩展是默认执行面，负责用户可见的步骤回放、失败自愈和性能采集。
2. Flask 是控制面与记录面，负责用例、运行记录、AI 增强、报告与持久化。
3. 服务端 Playwright 执行器保留为可选能力，不再作为扩展可见执行的唯一解释。
4. 所有执行必须落入同一条 Run 生命周期，禁止“没有真正执行却直接写成 success”。
5. 性能采集必须与 Run、用例、步骤绑定并持久化，而不是只生成一次性 Blob 报告。

这次清理的目标不是把所有模块推倒重来，而是把已经存在的执行、性能、AI 能力收束到稳定边界，使项目可以作为求职作品集演示，也能继续长期维护。

## 2. 背景与问题

### 2.1 产品定位

UIProof 的核心价值是：

> 便携式、可见的 UI 自动化，以及跟随自动化过程产生的端到端性能记录。

“便携式”意味着用户不需要单独部署浏览器集群或 Node 性能服务；“可见”意味着步骤在用户当前标签页中执行，用户能看见页面变化、失败位置和性能摘要；“端到端性能记录”意味着性能数据必须能追溯到具体用例、具体步骤和具体运行。

### 2.2 现状审计

| 问题 | 证据 | 影响 |
| --- | --- | --- |
| AI 自愈路由被空实现遮蔽 | `server/routes/__init__.py` 先注册 `ai_heal.bp`，而 `server/routes/ai_heal.py` 的 `call_ai()` 固定返回空字符串；真正实现位于 `server/routes/ai_service.py` | 扩展调用 `/api/ai/heal` 时可能拿到空选择器，演示链路不可信 |
| 扩展与服务端自愈载荷不一致 | `ui-automation-plugin/content/content.js:521` 发送 `selector`、`selectorFallbacks`、`pageUrl`、`domContext`；`server/routes/ai_service.py:83` 读取 `failed_selector`、`html_context`、`element_description` | 即使路由正确，字段也可能对不上 |
| 执行成功是伪造的 | `server/routes/cases.py:286` 的 `/api/cases/<case_id>/execute` 创建 `ExecutionLog` 后立即写入 `status='success'`，没有执行任何步骤 | 运行历史、成功率、用例统计全部失真 |
| 性能数据不落库 | `ui-automation-plugin/modules/managers/case-manager.js:590`、`:703` 采集 summary；`:985` 只把 summary 放进内存数组；`:509` 生成 Blob 报告 | 刷新页面或关闭侧边栏后性能结果丢失，无法按 Run 查询 |
| 执行状态只在内存 | `server/routes/execution.py:17` 使用 `_execution_tasks` 字典；`:182` 的 stop 只改状态 | 服务重启后任务丢失，停止不能真正取消执行 |
| 启动脚本与真实端口不一致 | `server/start.sh`、`server/stop.sh`、`DEBUG_GUIDE.md` 使用 5000；`server/app.py:52` 使用 5001 | 新用户按文档启动会连错端口 |
| 包管理文件失真 | `server/package.json` 是遗留 Express 清单并指向不存在的 `server.js`；根目录 `package-lock.json` 没有对应 `package.json` | 安装、CI、贡献者体验混乱 |
| 缺少测试与 CI | 仓库没有 `server/tests`、JS 测试或 `.github/workflows` | 架构调整无法安全回归 |

### 2.3 关键设计判断

- `server/routes/ai_service.py` 是 AI 能力的唯一真实实现，`server/routes/ai_heal.py` 的占位实现应退出注册。
- `ExecutionLog` 继续作为物理表，但在领域层统一称为 Run，避免同时维护两套运行记录。
- 性能采集继续使用扩展内 `chrome.debugger` + CDP Tracing；`perf-controller/` 保持可选遗留方案，不进入默认启动链路。
- 运行结束后由扩展调用服务端 `finish`，服务端一次性更新 Run 与用例统计；服务端不能替扩展判断“成功”。

## 3. 目标与非目标

### 3.1 目标

1. 建立统一的 Run 生命周期与 API，使扩展可见执行、服务端 Playwright 执行共享同一套记录。
2. 将性能 summary 与分段持久化，支持按 Run、用例、步骤查询。
3. 修复 AI 自愈路由遮蔽与载荷不一致，恢复真实 LLM 自愈链路。
4. 把执行编排从 `case-manager.js` 中抽出，降低 UI 管理器体积与职责耦合。
5. 补齐最小测试、CI、启动脚本和文档，使项目可演示、可贡献。

### 3.2 非目标

1. 不重写录制器、Content Script 的全部 DOM 操作逻辑。
2. 不引入微服务、消息队列、独立性能服务或浏览器集群。
3. 不强制所有执行迁移到 Playwright，也不删除服务端 AI 执行器。
4. 不在本次清理中重做侧边栏视觉设计。
5. 不引入 Alembic 等重型迁移框架；SQLite 使用显式、幂等的小型迁移脚本。

## 4. 架构原则

### 4.1 扩展是执行面

默认执行路径必须保持“用户当前标签页、用户可见、扩展驱动”。扩展负责：

- 解析用例步骤；
- 通过 `background.js` 调度 `startExecution` / `stopExecution`；
- 在 `chrome.debugger` 上启停 CDP Tracing；
- 在每一步或整条用例结束后生成性能 summary；
- 把 Run 状态与性能分段回写 Flask。

### 4.2 Flask 是控制面与记录面

Flask 负责：

- 用例、文件夹、运行记录、性能分段、截图的持久化；
- AI 自愈、AI 断言、AI 生成用例；
- 可选的服务端 Playwright 执行；
- 运行查询与后续报告聚合。

Flask 不假设扩展一定成功；它只接受扩展或 Playwright 执行器提交的状态。

### 4.3 契约优先

扩展与服务端之间只通过显式契约通信：

- 创建 Run；
- 追加性能分段；
- 结束 Run；
- 查询 Run。

契约字段必须有唯一命名，服务端对旧字段做兼容归一化，但不再新增同义字段。

### 4.4 运行记录不可伪造

任何 Run 都必须来自真实执行入口。旧的 `/api/cases/<case_id>/execute` 不再写成功状态，而是明确废弃并引导调用方使用 `/api/runs`。

## 5. 目标架构

### 5.1 分层视图

```text
┌─────────────────────────────────────────────────────────────┐
│ Chrome Extension（执行面）                                   │
│  popup / case-manager                                       │
│    └─ RunCoordinator ── RunClient ── Flask /api/runs        │
│    └─ PerfSession ── background-perf-tracing.js             │
│  content.js（DOM 操作、选择器自愈）                           │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / SSE
┌──────────────────────────▼──────────────────────────────────┐
│ Flask（控制面 + 记录面）                                      │
│  routes/runs.py ── services/run_service.py                  │
│  routes/ai_service.py（唯一 AI 能力入口）                      │
│  routes/execution.py（可选 Playwright 执行）                  │
│  models/models.py（ExecutionLog = Run, RunPerfSegment）       │
│  SQLite                                                     │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 可见执行时序

```text
用户点击执行
  -> CaseManager 解析步骤
  -> RunCoordinator.start(case, options)
  -> RunClient.createRun({case_id, executor:'extension', perf_mode})
  -> Flask POST /api/runs 返回 run_id
  -> 对每个步骤/整条用例：
       PerfSession.start()  -> background perfTracingStart
       background startExecution / playSingleStep
       PerfSession.stop()   -> background perfTracingStop
       RunClient.appendPerfSegment({run_id, scope, step_index, heading, summary})
  -> RunCoordinator.finish({status, final_result, steps_result, perf_summary})
  -> Flask POST /api/runs/<run_id>/finish
  -> Flask 在一个事务内更新 Run 与 TestCase 统计
  -> 扩展渲染结果与性能面板
```

### 5.3 AI 自愈时序

```text
content.js 检测选择器失败
  -> POST /api/ai/heal
     {selector, selectorFallbacks, stepType, pageUrl, domContext}
  -> ai_service.py 归一化为
     {failed_selector, selector_fallbacks, step_type, page_url, html_context}
  -> _heal_async() 调用真实 LLM
  -> 返回 {ok:true, selector, confidence, reason}
  -> content.js 重试；成功后 background PATCH /api/cases/<id>/heal-step
```

### 5.4 运行状态机

```text
running ── finish(passed) ──> passed
   │
   ├── finish(failed) ─────> failed
   ├── finish(stopped) ────> stopped
   └── finish(error) ──────> error
```

- `running`：已创建 Run，执行尚未结束。
- `passed`：执行器确认全部步骤通过。
- `failed`：执行器确认存在失败步骤。
- `stopped`：用户主动停止，执行器已停止调度。
- `error`：执行器或服务端异常，无法判定业务结果。

兼容映射：历史 `success`、`completed` 在序列化时映射为 `passed`；历史 `failed` 保持 `failed`。

## 6. 数据契约

### 6.1 Run 数据模型

物理表继续使用 `ExecutionLog`，领域对象称为 Run。新增字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `run_id` | `String(64)` unique | 对外运行 ID，默认 `uuid4().hex` |
| `executor` | `String(20)` | `extension` 或 `playwright` |
| `perf_mode` | `String(20)` | `step`、`case`、`none` |
| `perf_summary` | `Text` | 整条 Run 的性能汇总 JSON |
| `steps_total` | `Integer` | 计划步骤数 |
| `steps_passed` | `Integer` | 通过步骤数 |
| `steps_failed` | `Integer` | 失败步骤数 |
| `client_version` | `String(40)` | 扩展版本或执行器版本 |
| `updated_at` | `DateTime` | 最后更新时间 |
| `metadata_json` | `Text` | 执行器附加信息 |

新增 `RunPerfSegment` 表：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `Integer` PK | 自增主键 |
| `run_id` | `String(64)` indexed | 所属 Run |
| `segment_index` | `Integer` | 从 0 开始的分段序号 |
| `scope` | `String(10)` | `step` 或 `case` |
| `step_index` | `Integer` nullable | 单步模式的步骤下标 |
| `heading` | `String(200)` | 展示标题 |
| `summary_json` | `Text` | `background-perf-tracing.js` 返回的 summary |
| `created_at` | `DateTime` | 创建时间 |

唯一约束：`(run_id, segment_index)`。

### 6.2 Run API

#### `POST /api/runs`

请求：

```json
{
  "case_id": "case-uuid",
  "executor": "extension",
  "perf_mode": "step",
  "steps_total": 3,
  "client_version": "1.0.0"
}
```

响应 `201`：

```json
{
  "run_id": "8f3c...",
  "case_id": "case-uuid",
  "status": "running",
  "executor": "extension",
  "perf_mode": "step",
  "started_at": "2026-11-07T08:00:00"
}
```

#### `PATCH /api/runs/<run_id>`

允许在 `running` 状态更新执行进度：

```json
{
  "steps_total": 3,
  "steps_passed": 1,
  "steps_failed": 0,
  "metadata": {"current_step": 2}
}
```

#### `POST /api/runs/<run_id>/perf-segments`

请求：

```json
{
  "scope": "step",
  "step_index": 0,
  "heading": "用例「登录」步骤 1",
  "summary": {
    "collectionMode": "Tracing",
    "totalEvents": 1200,
    "durationTotalWithDur": 12,
    "perfMetrics": {"p0": [], "p1": [], "p2": [], "other": []}
  }
}
```

响应 `201`：

```json
{
  "segment_id": 12,
  "run_id": "8f3c...",
  "segment_index": 0
}
```

#### `POST /api/runs/<run_id>/finish`

请求：

```json
{
  "status": "passed",
  "final_result": "pass",
  "steps_result": [],
  "error_message": null,
  "perf_summary": {"collectionMode": "Tracing", "totalEvents": 4200}
}
```

响应：

```json
{
  "run_id": "8f3c...",
  "status": "passed",
  "finished_at": "2026-11-07T08:01:10",
  "case_stats": {
    "execution_count": 8,
    "success_rate": 0.75
  }
}
```

`finish` 必须幂等：若 Run 已结束，返回当前状态且不重复增加 `execution_count`。

#### 查询接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/runs/<run_id>` | Run 详情，默认包含性能分段 |
| `GET` | `/api/cases/<case_id>/runs?page=1&per_page=10` | 用例运行历史 |
| `GET` | `/api/runs/<run_id>/perf` | 性能分段与汇总 |

#### 废弃接口

`POST /api/cases/<case_id>/execute` 返回 `410 Gone`：

```json
{
  "error": "deprecated",
  "message": "Use POST /api/runs to create a run and POST /api/runs/<run_id>/finish to finish it."
}
```

### 6.3 性能 summary 契约

扩展继续使用 `background-perf-tracing.js` 现有结构，不改变 CDP 采集逻辑：

```json
{
  "collectionMode": "Tracing",
  "totalEvents": 1200,
  "totalMetricsCount": 0,
  "durationEvents": [],
  "durationTotalWithDur": 12,
  "durationTruncated": false,
  "perfMetrics": {
    "p0": [{"name": "Paint", "count": 2, "totalMs": 12.5, "maxMs": 8.1, "avgMs": 6.25, "display": "12.50 ms"}],
    "p1": [],
    "p2": [],
    "other": []
  },
  "perfNote": "",
  "perfDiagnostic": ""
}
```

服务端只校验顶层对象与 `summary` 可 JSON 序列化，不重算 P0/P1/P2，避免服务端与 Chrome 版本耦合。

### 6.4 AI 载荷归一化

`server/routes/ai_service.py` 增加纯函数：

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
```

`/api/ai/heal` 返回：

```json
{"ok": true, "selector": "button[data-testid='submit']", "confidence": 0.86, "reason": "稳定属性匹配"}
```

失败时返回：

```json
{"ok": false, "selector": null, "confidence": 0, "reason": "AI 分析失败"}
```

`/api/ai/generate-cases` 同时接受 `interactives` / `elements` 与 `pageUrl` / `page_url`、`pageTitle` / `page_title`。

## 7. 模块边界

### 7.1 扩展新增模块

| 文件 | 职责 |
| --- | --- |
| `ui-automation-plugin/modules/runs/run-client.js` | 封装 `/api/runs` 创建、追加分段、结束、查询 |
| `ui-automation-plugin/modules/runs/run-coordinator.js` | 编排单条用例的可见执行、性能启停、停止与结束 |
| `ui-automation-plugin/modules/perf/perf-session.js` | 管理一次 Tracing 会话，归一化 summary，生成 segment |

### 7.2 扩展修改模块

| 文件 | 修改 |
| --- | --- |
| `ui-automation-plugin/modules/managers/case-manager.js` | 保留列表、UI、批量循环；把 `_executeCaseStepsWithPerfPerStep()`、`_executeCaseWithPerfWholeCase()` 的执行细节委托给 `RunCoordinator` |
| `ui-automation-plugin/modules/perf/perf-report.js` | 保持纯渲染函数；报告数据改为从 Run 查询结果组装 |
| `ui-automation-plugin/background.js` | 保持消息路由；为 stop 增加可等待的结束确认 |
| `ui-automation-plugin/content/content.js` | 自愈载荷保持扩展字段；不新增同义字段 |

### 7.3 服务端新增模块

| 文件 | 职责 |
| --- | --- |
| `server/contracts/runs.py` | Run、PerfSegment 的入参解析与出参序列化 |
| `server/services/run_service.py` | 创建、追加分段、结束、查询、用例统计更新 |
| `server/routes/runs.py` | 薄 HTTP 层 |
| `server/scripts/migrate_sqlite.py` | 幂等补充 Run 字段与 `run_perf_segment` 表 |
| `server/tests/conftest.py` | 临时 SQLite、Flask test client、fixture |

### 7.4 服务端修改模块

| 文件 | 修改 |
| --- | --- |
| `server/models/models.py` | `ExecutionLog` 增加 Run 字段；新增 `RunPerfSegment` |
| `server/routes/__init__.py` | 移除 `ai_heal` 注册，注册 `runs.bp` |
| `server/routes/ai_service.py` | 增加载荷归一化与 `ok` 字段 |
| `server/routes/cases.py` | `/execute` 改为 410；保留 `/heal-step` |
| `server/routes/execution.py` | 可选 Playwright 执行也写入 Run 字段；stop 增加协作式取消标记 |
| `server/app.py` | 端口与 debug 从环境变量读取；旧库升级由 README 记录的迁移命令完成 |

## 8. 兼容与迁移

### 8.1 数据库迁移

`db.create_all()` 只创建新表，不会为已有 SQLite 表补列。迁移脚本必须：

1. 检查 `execution_log` 是否存在；
2. 逐列检查并 `ALTER TABLE execution_log ADD COLUMN ...`；
3. 用 `task_id` 或 `uuid4().hex` 回填 `run_id`；
4. 将历史 `success` / `completed` 映射为 `passed`；
5. 创建 `run_perf_segment` 表与唯一索引；
6. 重复执行不报错。

迁移前建议复制 `server/instance/automation_cases.db`，迁移脚本不自动删除旧数据。

### 8.2 API 兼容

- 扩展在同一版本内切换到 `/api/runs`；旧 `/api/cases/<id>/execute` 直接返回 410，避免继续产生假运行。
- AI 路由保留扩展字段与旧字段两种输入；响应新增 `ok`，不删除 `selector`。
- `perf-controller/` 不删除，文档标记为可选遗留方案。

## 9. 测试与验收

### 9.1 自动化测试

Python：

- `server/tests/test_health.py`：应用工厂可创建，`GET /api/health` 返回 200。
- `server/tests/test_ai_contract.py`：扩展载荷与旧载荷都能归一化；路由不再被空实现遮蔽。
- `server/tests/test_runs_api.py`：创建 Run、追加分段、结束 Run、重复结束不重复计数。
- `server/tests/test_execute_deprecated.py`：旧 `/execute` 返回 410。
- `server/tests/test_migration.py`：在临时 SQLite 上重复执行迁移脚本不报错。

JavaScript：

- `tests/js/run-client.test.js`：请求体与 URL 断言，使用注入的 `fetch`。
- `tests/js/perf-session.test.js`：summary 归一化与 segment 生成。
- `tests/js/run-contract.test.js`：状态与字段白名单。

### 9.2 手动验收

1. 启动 `server`，确认 `http://localhost:5001/api/health` 返回 200。
2. 加载扩展，录制一条至少 3 步的用例。
3. 以“单步性能”执行，确认生成 3 个 `RunPerfSegment`。
4. 以“整条用例性能”执行，确认生成 1 个 `scope='case'` 分段。
5. 执行中点击停止，确认 Run 最终为 `stopped`，且不会继续追加分段。
6. 调用 `GET /api/runs/<run_id>`，确认能看到 `status`、`perf_summary` 与 `segments`。
7. 触发一次选择器失败，确认 `/api/ai/heal` 返回真实选择器而不是空字符串。
8. 调用旧 `/api/cases/<id>/execute`，确认返回 410。

### 9.3 完成标准

- Python 与 JS 测试在 CI 中通过。
- 仓库中不再出现 `localhost:5000` 作为默认后端地址。
- 不再存在两个 `/api/ai/heal` 路由。
- 扩展执行完成后，数据库中每个 Run 都有真实状态与性能分段。
- `README.md`、`docs/runtime-sequence.md`、`DEBUG_GUIDE.md` 与新契约一致。

## 10. 风险与取舍

| 风险 | 处理 |
| --- | --- |
| SQLite 迁移失败或重复执行 | 迁移脚本幂等、迁移前备份、测试覆盖临时库 |
| 旧扩展版本调用废弃接口 | 同一版本内切换扩展；410 响应明确提示新接口 |
| CDP Tracing 附加失败（DevTools 已打开） | 保留 `perfDiagnostic`，Run 仍可结束为 `passed` 或 `failed`，不因性能失败误判业务失败 |
| 停止不是抢占式 | 明确“协作式停止”：扩展停止后续调度，当前步骤允许完成；服务端 Playwright 增加取消标记 |
| `case-manager.js` 仍然较大 | 先抽出执行与性能，不强行拆 UI；后续按收益继续拆 |
| 服务端与扩展字段漂移 | 用 `server/contracts/runs.py` 与 JS 纯函数测试锁定字段 |

## 11. 实施顺序

1. 测试与 CI 基线。
2. 启动脚本、端口、包管理文件清理。
3. AI 路由合并与载荷归一化。
4. Run 模型、迁移脚本与契约。
5. Run 服务与 API。
6. 废弃假执行接口。
7. 扩展 RunClient、PerfSession、RunCoordinator。
8. `case-manager.js` 接入 RunCoordinator。
9. 停止语义与性能报告落库。
10. 文档、验收与发布。

## 12. 已决策事项

- 采用 B 方案：模块化清理，不做全平台重写。
- 扩展可见执行是默认路径；Playwright 保留为可选执行器。
- `ExecutionLog` 作为 Run 的物理表，不新增平行 `Run` 表。
- 性能 summary 按 Run + Segment 持久化，报告从数据库数据生成。
- AI 自愈以 `server/routes/ai_service.py` 为唯一实现。
- 旧 `/api/cases/<id>/execute` 不再写成功状态，直接废弃。
