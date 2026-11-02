# UIProof — 智能 UI 自动化测试平台

> 将多模态 AI 测试能力与 Chrome 侧边栏管理界面统一，提供从录制、执行到断言和性能分析的端到端 UI 自动化测试解决方案。

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│              Chrome Extension (侧边面板)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ 用例管理  │ │ 录制增强  │ │ AI 执行  │ │ 报告查看  │  │
│  │ 文件夹树  │ │ 截图+AI  │ │ 进度面板 │ │ 截图对比  │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
└───────────────────────┬─────────────────────────────────┘
                        │ REST API + SSE
┌───────────────────────▼─────────────────────────────────┐
│             Flask 统一后端 (port 5001)                     │
│                                                         │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────┐  │
│  │ 用例管理        │  │ AI Agent 引擎   │  │ AI 服务   │  │
│  │ Cases / Folders │  │ LangGraph 流水线│  │ Vision 等 │  │
│  └───────┬────────┘  └───────┬────────┘  └─────┬─────┘  │
│          │                   │                  │        │
│  ┌───────▼───────────────────▼──────────────────▼─────┐  │
│  │              MySQL / SQLite 数据库                  │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 核心能力

| 能力 | 说明 |
|------|------|
| **用例管理** | 文件夹树形结构、CRUD、批量操作、分页搜索 |
| **录制** | Content Script 事件捕获 + 每步截图 + Vision Agent 元素描述 |
| **AI 执行** | LangGraph 6 节点流水线、Playwright 驱动、视觉定位、SSE 实时进度 |
| **AI 自愈** | 选择器失败时自动分析 DOM + Vision Agent 定位替代元素 |
| **AI 断言** | 截图 + LLM 判断页面状态是否符合预期 |
| **步骤优化** | LLM 智能合并冗余步骤、补充等待、调整顺序 |
| **Excel 兼容** | 导入/导出标准 Excel 用例格式 |
| **性能追踪** | CDP Tracing、P0/P1/P2 分层性能报告 |

## 项目结构

```
├── server/                          # Flask 后端
│   ├── app.py                       # 应用入口
│   ├── config.py                    # Flask 配置 (DB URI 等)
│   ├── agent_config.yaml            # AI Agent 配置 (LLM, 浏览器等)
│   ├── requirements.txt             # Python 依赖
│   ├── models/
│   │   └── models.py                # 数据模型 (TestCase, Folder, ExecutionLog, StepSnapshot)
│   ├── routes/
│   │   ├── cases.py                 # 用例 CRUD
│   │   ├── folders.py               # 文件夹管理
│   │   ├── execution.py             # AI 执行调度 + SSE 进度
│   │   ├── recording.py             # 录制增强 (截图/描述/优化)
│   │   ├── ai_service.py            # AI 服务 (Vision/断言/自愈/生成)
│   │   ├── ai_heal.py               # AI 自愈
│   │   ├── excel_io.py              # Excel 导入导出
│   │   └── health.py                # 健康检查
│   ├── agents/                      # AI Agent 模块
│   │   ├── planner.py               # 执行计划生成
│   │   ├── browser_agent.py         # 浏览器操作执行
│   │   ├── vision_agent.py          # 视觉元素定位 + 元素描述
│   │   ├── assert_agent.py          # AI 断言
│   │   └── report_agent.py          # Allure + Langfuse 报告
│   ├── core/                        # AI 核心运行时
│   │   ├── pipeline.py              # LangGraph 测试流水线
│   │   ├── settings.py              # AI 配置加载
│   │   ├── llm.py                   # 统一 LLM 调用 (OpenAI/Anthropic/千问/智谱)
│   │   ├── prompts.py               # Prompt 模板加载
│   │   ├── json_utils.py            # JSON 安全解析
│   │   └── image_utils.py           # 图片 Base64 编码
│   ├── mcp/                         # 浏览器自动化
│   │   ├── playwright_client.py     # Playwright 封装
│   │   └── tools.py                 # 截图保存、日志工具
│   └── prompts/                     # LLM Prompt 模板
│       ├── vision.md                # 视觉定位提示词
│       ├── planner.md               # 执行规划提示词
│       ├── assert.md                # 断言提示词
│       └── vision_record.md         # 录制元素描述提示词
│
├── ui-automation-plugin/            # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js                # Service Worker (执行协调 + 截图转发)
│   ├── content/
│   │   └── content.js               # 页面脚本 (录制 + 回放 + AI增强)
│   ├── popup/
│   │   ├── popup.html               # 侧边面板 UI
│   │   ├── popup.js                 # 主协调器
│   │   └── popup.css                # 样式
│   └── modules/
│       ├── managers/                # 用例/文件夹/录制管理器
│       ├── execution/               # AI 执行管理器 (SSE 进度)
│       ├── perf/                    # 性能追踪模块
│       └── utils/                   # UI 工具
│
├── perf-controller/                 # 可选的 Node.js 性能追踪服务
├── docs/
│   └── specs/2026-06-01-ai-testing-architecture.md  # AI 测试能力设计
└── README.md                        # 本文件
```

## API 路由一览

| 方法 | 路径 | 说明 |
|------|------|------|
| **用例管理** | | |
| GET/POST | `/api/cases` | 列出/创建用例 |
| GET/PUT/DELETE | `/api/cases/:id` | 读取/更新/删除用例 |
| POST | `/api/cases/:id/execute` | 记录执行 |
| PATCH | `/api/cases/:id/heal-step` | AI 自愈更新选择器 |
| **文件夹** | | |
| GET/POST | `/api/folders` | 列出/创建文件夹 |
| GET | `/api/folders/tree` | 树形结构 |
| **AI 执行** ⭐ | | |
| POST | `/api/execution/run/:caseId` | 启动 Playwright + AI Agent 执行 |
| POST | `/api/execution/batch` | 批量执行 |
| POST | `/api/execution/stop/:taskId` | 停止执行 |
| GET | `/api/execution/stream/:taskId` | SSE 实时进度推送 |
| GET | `/api/execution/status/:taskId` | 查询执行状态 |
| **录制增强** ⭐ | | |
| POST | `/api/recording/screenshot` | 上传步骤截图 |
| POST | `/api/recording/describe` | Vision Agent 元素描述 |
| POST | `/api/recording/optimize` | LLM 步骤优化 |
| POST | `/api/recording/save` | 保存录制用例到数据库 |
| **AI 服务** ⭐ | | |
| POST | `/api/ai/vision` | Vision Agent 元素定位 |
| POST | `/api/ai/assert` | AI 截图断言 |
| POST | `/api/ai/heal` | AI 选择器自愈 |
| POST | `/api/ai/generate-cases` | AI 自动生成用例 |
| **Excel** ⭐ | | |
| POST | `/api/excel/import` | 导入 Excel 用例 |
| GET | `/api/excel/export/:caseId` | 导出用例为 Excel |
| POST | `/api/excel/export-batch` | 批量导出 |

⭐ = 平台增强能力

## 快速开始

### 1. 安装后端依赖

```bash
cd server
pip install -r requirements.txt
playwright install chromium
```

### 2. 配置数据库和 AI

复制环境变量模板并按需填写：

```bash
cp .env.example server/.env
```

默认使用 `server/instance/automation_cases.db`（SQLite），无需额外启动数据库。
生产环境可通过 `DATABASE_URL` 指向 MySQL/PostgreSQL，并通过 `MYSQL_*` 配置迁移脚本。

模型与 Langfuse 凭据通过环境变量提供：

```bash
export DASHSCOPE_API_KEY="your-api-key"
export LANGFUSE_PUBLIC_KEY="your-langfuse-public-key"
export LANGFUSE_SECRET_KEY="your-langfuse-secret-key"
```

`server/agent_config.yaml` 只保存模型名、地址和行为参数，不保存明文密钥。

### 3. 启动后端

```bash
cd server
python app.py
# 服务运行在 http://localhost:5001
```

### 4. 安装 Chrome 扩展

1. 打开 Chrome → `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择 `ui-automation-plugin/` 目录
4. 点击扩展图标 → 侧边面板打开

### 5. 开始使用

1. **管理用例**: 在文件夹树中创建/组织测试用例
2. **录制**: 点击「新增用例」→「开始录制」→ 在页面上操作 → 每步自动截图 + AI 描述
3. **AI 执行**: 勾选用例 → 点击「AI 执行」→ 实时查看 Playwright + AI Agent 执行进度
4. **导入**: 上传 Excel 文件批量导入用例（兼容标准 Excel 用例模板）

## 执行流程

```
用户选择用例 → 点击「AI 执行」
     │
     ▼
Flask 后端启动后台线程
     │
     ▼
LangGraph Pipeline:
  parse → plan → execute → assert → increment → ... → report
     │                              │
     │  每步完成后通过 SSE 推送进度     │  失败时触发 Vision Agent 自愈
     │                              │
     ▼                              ▼
Chrome 扩展实时更新进度面板      自动定位替代元素继续执行
     │
     ▼
执行完成 → Allure 报告 + Langfuse 追踪
```

## 数据库模型

### TestCase（测试用例）
- `steps` — JSON 格式步骤数据，支持 Content Script 录制格式和文本格式
- `expected` — 预期结果（AI 断言用）
- `setup_steps` — 前置条件步骤
- `execution_count` / `success_rate` — 执行统计

### ExecutionLog（执行日志）
- `task_id` — 异步执行任务 ID
- `final_result` — pass / fail / error / uncertain
- `steps_result` — 每步执行结果 JSON
- `llm_usage` — LLM token 用量 JSON

### StepSnapshot（步骤截图）⭐ 新增
- 截图文件路径 + Vision Agent 生成的 AI 描述
- 关联录制/执行阶段

## 技术栈

| 层面 | 技术 |
|------|------|
| 后端 | Python 3.12 + Flask + SQLAlchemy |
| AI 引擎 | LangGraph + OpenAI/Anthropic SDK |
| 浏览器自动化 | Playwright (Chromium) |
| 前端 | Chrome Extension Manifest V3 |
| LLM | 千问 VL-Max / GPT-4o / Claude (可配置) |
| 数据库 | MySQL (主) / SQLite (备) |
| 报告 | Allure JSON + Langfuse 追踪 |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | 数据库连接串 | MySQL |
| `AGENT_CONFIG` | AI 配置文件路径 | `server/agent_config.yaml` |
| `DASHSCOPE_API_KEY` | 千问 API Key (替代配置文件) | — |
