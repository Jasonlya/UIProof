# Run API

Run 表示一次真实执行。扩展通过 Run API 创建运行、追加性能分段并结束运行；服务端据此更新用例统计，不再使用旧的 `/api/cases/<case_id>/execute` 伪造成功记录。

## 状态机

```text
running ──> passed
        ├─> failed
        ├─> stopped
        └─> error
```

`finish` 是幂等的：已结束的 Run 再次调用时返回原状态，不会重复增加 `execution_count`。

## POST /api/runs

创建运行。

```json
{
  "case_id": "case-uuid",
  "executor": "extension",
  "perf_mode": "step",
  "steps_total": 3,
  "client_version": "0.3.0"
}
```

- `executor`: `extension` | `playwright` | `legacy`
- `perf_mode`: `step` | `case` | `none`

响应 `201`：

```json
{
  "run_id": "8f3c...",
  "case_id": "case-uuid",
  "status": "running",
  "executor": "extension",
  "perf_mode": "step",
  "steps_total": 3,
  "steps_passed": 0,
  "steps_failed": 0,
  "started_at": "2026-11-07T08:00:00",
  "segments": []
}
```

## PATCH /api/runs/:run_id

在 `running` 状态更新进度。已结束的 Run 返回 `409 run_not_running`。

```json
{
  "steps_passed": 1,
  "steps_failed": 0,
  "metadata": {"current_step": 2}
}
```

可更新字段：`steps_total`、`steps_passed`、`steps_failed`、`client_version`、`metadata`。

## POST /api/runs/:run_id/perf-segments

追加一段性能结果。`segment_index` 由服务端按 `max + 1` 分配。

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

- `scope=step` 时必须提供 `step_index`
- `scope=case` 时忽略 `step_index`
- 已结束的 Run 返回 `409 run_not_running`

响应 `201`：

```json
{
  "run_id": "8f3c...",
  "segment_index": 0,
  "scope": "step",
  "step_index": 0,
  "heading": "用例「登录」步骤 1"
}
```

## POST /api/runs/:run_id/finish

结束运行并更新用例统计。

```json
{
  "status": "passed",
  "final_result": "passed",
  "steps_result": [
    {"status": "passed", "step_index": 0},
    {"status": "passed", "step_index": 1}
  ],
  "error_message": null,
  "perf_summary": {"collectionMode": "Tracing", "segments": 2}
}
```

- `status`: `passed` | `failed` | `stopped` | `error`
- 首次结束会增加 `TestCase.execution_count` 并重算 `success_rate`
- 重复结束返回 `idempotent: true` 和当前用例统计

## GET /api/runs/:run_id

返回 Run 详情与全部分段。

## GET /api/runs/:run_id/perf

返回运行级性能摘要与分段列表：

```json
{
  "run_id": "8f3c...",
  "case_id": "case-uuid",
  "perf_mode": "step",
  "perf_summary": {"collectionMode": "Tracing", "segments": 2},
  "segments": []
}
```

## GET /api/cases/:case_id/runs

按开始时间倒序返回某用例的运行历史。

## 旧接口

`POST /api/cases/:case_id/execute` 已废弃，固定返回 `410 Gone`：

```json
{
  "error": "deprecated",
  "message": "Use POST /api/runs to create a run and POST /api/runs/<run_id>/finish to finish it."
}
```
