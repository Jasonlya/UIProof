# UIProof AI 自动化测试能力设计

## 概述

UIProof 以 Chrome 侧边栏为统一入口，将用例管理、浏览器操作录制、AI 执行、视觉定位、AI 断言和性能分析整合为一套端到端 UI 自动化测试平台。后端通过 LangGraph 编排执行流水线，由 Playwright 驱动真实浏览器，并使用多模态模型提升元素定位、失败自愈和结果校验能力。

**产品形态**: Chrome 扩展侧边面板为主入口
**录制方式**: Content Script 事件录制 + 步骤截图 + Vision Agent 视觉描述
**执行引擎**: Playwright + LangGraph 多节点 AI 执行流水线
**AI 增强**: 全链路 — 录制时视觉描述、执行时 AI 自愈、步骤智能优化、AI 断言验证

## 架构

```
Chrome Extension (侧边面板)
├── 用例管理
├── 录制控制 (事件捕获 + 截图 + AI 描述)
├── 执行中心 (触发 Playwright + AI Agent 执行)
└── 报告查看 (Allure 可视化 + 截图对比)

Flask 后端 (port 5001, 统一服务)
├── routes/
│   ├── cases.py         — 用例 CRUD
│   ├── folders.py       — 文件夹管理
│   ├── recording.py     — 录制 API (截图上传 + AI 描述)
│   ├── execution.py     — 执行调度 + SSE
│   ├── ai_service.py    — AI 能力 API (vision + optimize + assert)
│   └── health.py        — 健康检查
├── agents/              — AI Agent 模块
│   ├── planner.py
│   ├── browser_agent.py
│   ├── vision_agent.py
│   ├── assert_agent.py
│   └── report_agent.py
├── core/                — AI 核心运行时
│   ├── pipeline.py      — LangGraph 流水线
│   ├── settings.py      — 配置加载
│   └── llm.py           — LLM 调用封装
└── mcp/
    └── playwright_client.py

MySQL / SQLite
├── TestCase (steps JSON 格式)
├── Folder
├── ExecutionLog (SSE 进度数据)
└── StepSnapshot (录制/执行截图)
```

## 数据模型扩展

### TestCase.steps JSON 格式 (统一)

录制和执行共享统一的步骤格式:

```json
{
  "steps": [
    {
      "index": 0,
      "type": "click|input|navigate|wait|scroll|assert",
      "selector": "button.submit-btn",
      "selectorFallbacks": ["[data-testid='submit']", "text=提交"],
      "value": "",
      "description": "点击提交按钮",
      "visualDescription": "页面底部的蓝色「提交」按钮",
      "screenshot": "step_001_click.png",
      "coordinates": {"x": 450, "y": 320},
      "timestamp": 1717200000
    }
  ],
  "setupSteps": [
    { "type": "navigate", "value": "https://example.com" }
  ]
}
```

### StepSnapshot 模型

```python
class StepSnapshot(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    snapshot_id = db.Column(db.String(64), unique=True)
    case_id = db.Column(db.String(64))
    execution_id = db.Column(db.String(64), nullable=True)
    step_index = db.Column(db.Integer)
    phase = db.Column(db.String(16))  # 'record' | 'execute' | 'assert'
    screenshot_path = db.Column(db.String(256))
    ai_description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
```

### ExecutionLog 扩展

扩展字段:
- `config_snapshot` — 执行时的配置快照 (JSON)
- `llm_usage` — LLM token 用量 (JSON)
- `steps_result` — 每步执行结果 (JSON)

## API 设计

### 录制相关

| Method | Path | 说明 |
|--------|------|------|
| POST | /api/recording/screenshot | 上传步骤截图 |
| POST | /api/recording/describe | 调用 Vision Agent 描述元素 |
| POST | /api/recording/optimize | LLM 智能优化步骤 |

### 执行相关

| Method | Path | 说明 |
|--------|------|------|
| POST | /api/execution/run/:caseId | 启动 Playwright + AI Agent 执行 |
| POST | /api/execution/batch | 批量执行多个用例 |
| POST | /api/execution/stop/:taskId | 停止执行 |
| GET | /api/execution/stream/:taskId | SSE 实时进度推送 |
| GET | /api/execution/status/:taskId | 查询执行状态 |

### AI 服务 (增强)

| Method | Path | 说明 |
|--------|------|------|
| POST | /api/ai/vision | Vision Agent 元素定位 |
| POST | /api/ai/heal | AI 自愈 (保留) |
| POST | /api/ai/assert | AI 断言截图对比 |
| POST | /api/ai/generate-cases | AI 生成用例 (保留) |

### Excel 兼容

| Method | Path | 说明 |
|--------|------|------|
| POST | /api/cases/import/excel | 导入 Excel 用例 |
| GET | /api/cases/export/excel/:caseId | 导出为 Excel |

## 模块职责

| 模块 | 路径 | 职责 |
|------|------|------|
| 执行规划 | server/agents/planner.py | 将用例步骤转换为可执行动作计划 |
| 浏览器执行 | server/agents/browser_agent.py | 调用 Playwright 执行操作并收集结果 |
| 视觉定位 | server/agents/vision_agent.py | 基于截图和页面信息定位目标元素 |
| AI 断言 | server/agents/assert_agent.py | 校验页面状态与预期结果 |
| 报告生成 | server/agents/report_agent.py | 汇总步骤、断言和模型用量并写入数据库 |
| 流水线编排 | server/core/pipeline.py | 通过 LangGraph 编排规划、执行、断言和报告节点 |
| 配置与模型调用 | server/core/ | 加载配置并提供统一的 LLM 调用封装 |
| 浏览器工具 | server/mcp/ | 封装 Playwright 客户端、截图和日志工具 |

## 执行流程

1. 用户在扩展中选择用例 → 点击「AI 执行」
2. 扩展 POST `/api/execution/run/:caseId`
3. Flask 启动后台线程运行 LangGraph pipeline
4. Pipeline 从 DB 读取步骤，通过 Playwright 执行
5. 每步进度通过 SSE 推送到扩展
6. 失败时调用 Vision Agent 自愈
7. 执行完成生成 Allure 报告 + 写入 ExecutionLog
8. 扩展展示执行结果 + 截图对比

## 依赖合并

后端依赖包括:
- langgraph>=0.2.0
- langchain>=0.3.0
- playwright>=1.40.0
- openai>=1.0.0
- anthropic>=0.40.0
- pyyaml>=6.0
- allure-python-commons>=2.13.0
