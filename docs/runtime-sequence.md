# 项目运行时序图

本文档用 Mermaid（及补充示意图）描述 **UI 自动化插件（侧边栏 + Background + Content）** 与 **Flask 服务端** 的主要运行时序。

**性能采集（Tracing）**：由扩展内 **`chrome.debugger` + CDP** 在**当前执行的目标标签页**上完成，经 `background-perf-tracing.js` 实现。**不再**通过侧边栏调用外部 HTTP 服务。  
目录下的 **`perf-controller/`（Node）为可选、遗留方案**：通过远程调试端口连接 Chrome，与当前插件默认路径无关；详见该目录 `README.md` / `requirements.txt`。

---

## 性能采集时序（讲解文档，与当前实现对齐）

入口与主流程：

```
[用户点击录制 / 执行 / 性能相关按钮]
        |
        v
[Chrome 扩展侧边栏 Popup]
 (用例管理 + 录制 + 性能开关 / 手动启停 / 结果面板)
        |
        | 1. 录制用例 → 与 Content / Background 协作
        |    & 保存 steps 到 Flask /api/cases
        |
        | 2. 执行用例 → sendMessage(startExecution, tabId, steps)
        | 3. 性能（自动）：同 tabId 上 sendMessage(perfTracingStart / Stop)
        v
[插件 Background]
 (executionState & 跨页面调度；perf 消息转 background-perf-tracing)
        |
        | sendMessage(runStep + ping)
        v
[Content Script + automation-core/advanced]
 (点击/输入/滚动/导航等 DOM 操作)
        |
        v
[Chrome 目标标签页]
 (页面加载、JS、渲染、网络、V8 等)
        ^
        |    chrome.debugger：Tracing.start / Tracing.end + IO.read（流式 JSON）
        |
[background-perf-tracing.js]
 (attach → Tracing.getCategories / start → end → tracingComplete → summary)
        |
        v
  summary { totalEvents } ----> Popup 性能结果面板 (_appendPerfResultLine)
        |
        v
POST /api/runs 创建运行 → 每步/整条用例追加 perf-segments → POST /api/runs/:id/finish
        |
        v
[Flask]
        |
        v
Run 与性能分段持久化到 SQLite；GET /api/runs/:id/perf 可回读
```

---

### 维度一：单步（Per-Step）

对**每一条选中的用例**，逐步循环：**启动 Tracing → 执行该步 → 停止 Tracing → 写入一行结果**；步骤数为 N 则该用例内 N 次 Tracing 启停、N 条结果行。**支持多选用例**：按列表顺序对每个用例各跑一遍上述循环。

```
[用户勾选 1..N 用例 + 「性能测试」+ 选「单步」]
        |
        v
[侧边栏 CaseManager._performBatchExecute]
        |
        | 对每个 caseId：拉取详情、解析 steps
        | RunCoordinator.runCase(perfMode: 'step')
        |
        | 对当前用例每一步：
        |   sendMessage(perfTracingStart, tabId)
        v
[Background → background-perf-tracing]
 (debugger.attach + Tracing.start)
        |
        v
[同 tabId：startExecution, steps: [当前步]]
        |
        v
[Background → Content：单步执行]
        |
        v
[Popup 轮询 storage 直至本步结束]
        |
        | sendMessage(perfTracingStop, tabId)
        v
[Background：Tracing.end → IO.read → totalEvents]
        |
        v
[_appendPerfResultLine(用例名, 步骤 N, totalEvents)]
        |
        v
RunCoordinator.finishRun('passed' | 'failed' | 'error')
        |
        v
(下一用例重复；用例间隔约 1s)
```

---

### 维度二：整个用例（Whole-Case）

对**每一条选中的用例**：**一次** Tracing.start → **一次** `startExecution`（全部 steps）→ **一次** Tracing.stop 汇总。**支持多选用例**，每条用例独立一整段 Tracing。

```
[用户勾选 1..N 用例 + 「性能测试」+ 选「整个用例」]
        |
        v
[CaseManager → RunCoordinator.runCase(perfMode: 'case')]
        |
        | sendMessage(perfTracingStart, tabId)
        v
[Background → Tracing.start]
        |
        | sendMessage(startExecution, steps 全部, intervalMs)
        v
[顺序执行全部步骤 → 轮询 storage 结束]
        |
        | sendMessage(perfTracingStop, tabId)
        v
[Tracing.end → summary]
        |
        v
[_appendPerfResultLine(用例名, 整条, totalEvents)]
        |
        v
RunCoordinator.finishRun('passed' | 'failed' | 'error')
```

---

## 1. 插件与页面启动

```mermaid
sequenceDiagram
    participant User
    participant Popup as Popup (侧边栏)
    participant BG as Background
    participant Flask as Flask API
    participant Storage as chrome.storage

    User->>Popup: 点击扩展图标 / 打开侧边栏
    Popup->>Popup: DOMContentLoaded
    Popup->>Popup: init()
    Popup->>Popup: 创建 FolderManager, CaseManager, RecordingManager, UIUtils
    Popup->>Popup: bindEvents()
    Popup->>Popup: initCaseManagement()

    Popup->>Flask: GET /api/folders
    Flask-->>Popup: folders[]
    Popup->>Flask: GET /api/cases?page=1&per_page=10...
    Flask-->>Popup: cases[]

    Popup->>Popup: folderManager.renderTreeView()
    Popup->>Storage: get(uiap_cases_list_height, uiap_perf_result_height)
    Popup->>Popup: initResizablePanels() 应用面板高度
    Popup-->>User: 用例管理界面就绪
```

---

## 2. 执行用例（无性能采集）

```mermaid
sequenceDiagram
    participant User
    participant Popup as Popup (CaseManager)
    participant Flask as Flask API
    participant BG as Background
    participant Storage as chrome.storage
    participant Content as Content Script (目标页)

    User->>Popup: 勾选用例 → 点击「执行」
    Popup->>Popup: batchExecuteCases() → _performBatchExecute()

    loop 每个选中的用例
        Popup->>Flask: GET /api/cases/:id
        Flask-->>Popup: caseDetail (含 steps)

        Popup->>Popup: 清理旧状态 (stopExecution, remove storage)
        Popup->>BG: sendMessage({ type: 'startExecution', steps, intervalMs, tabId })
        BG->>Storage: set(uiap_execution_state, { isExecuting: true, steps, tabId })
        BG-->>Popup: { ok: true }
        BG->>BG: executeSteps(tabId) 异步执行

        loop 每一步
            BG->>Content: tabs.sendMessage(tabId, { type: 'runStep', step, index })
            Content->>Content: performStep(step) 注入/执行操作
            Content-->>BG: { success, ... }
            BG->>Storage: 更新 state (currentIndex, results)
            BG->>BG: intervalMs 等待
        end

        BG->>Storage: set(uiap_execution_result, { success, failCount, ... })
        BG->>Storage: remove(uiap_execution_state)

        loop Popup 轮询
            Popup->>Storage: get(uiap_execution_state)
            Storage-->>Popup: 无 / 非 isExecuting
            Popup->>Storage: get(uiap_execution_result)
        end

        Popup->>Flask: POST /api/runs (创建 Run)
        Flask-->>Popup: { run_id, status: running }
        Popup->>Flask: POST /api/runs/:run_id/finish
        Popup->>Popup: 成功/失败计数
    end

    Popup->>Popup: showExecutionResult(batchResult)
    Popup-->>User: 显示执行结果弹窗
```

---

## 3. 执行用例（带性能采集，可多选）

勾选 **「性能测试」** 时，`perfEnabled === true`，**不再**要求仅选中一条用例；对每个选中用例按维度（单步 / 整条）交给 `RunCoordinator.runCase({ perfMode: 'step' | 'case' })`。每段 Tracing 结束后通过 `POST /api/runs/:run_id/perf-segments` 持久化，最终 `POST /api/runs/:run_id/finish` 写入终态并更新用例统计。Tracing 经 **Background** 内 `perfTracingStart` / `perfTracingStop` 消息驱动，作用于 **`tabId`（当前活动标签页）**。

```mermaid
sequenceDiagram
    participant User
    participant Popup as Popup (CaseManager)
    participant Flask as Flask API
    participant BG as Background
    participant Tracer as background-perf-tracing
    participant Storage as chrome.storage
    participant Content as Content Script

    User->>Popup: 勾选 1..N 用例 + 「性能测试」+ 维度(单步/整条)
    Popup->>Popup: _performBatchExecute()，每条用例若 enablePerfOnExecute

    loop 每个选中用例（perf 分支）
        Popup->>Flask: GET /api/cases/:id → steps

        alt 维度 = 整条用例
            Popup->>BG: sendMessage({ type: 'perfTracingStart', tabId })
            BG->>Tracer: perfTracingStart(tabId)
            Tracer->>Tracer: debugger.attach + Tracing.start
            Tracer-->>BG: ok
            BG-->>Popup: { ok: true }

            Popup->>BG: sendMessage(startExecution, steps 全部, tabId)
            BG->>Content: 顺序执行各步
            Note over Popup,Storage: Popup 轮询 uiap_execution_state / result

            Popup->>BG: sendMessage({ type: 'perfTracingStop', tabId })
            BG->>Tracer: perfTracingStop(tabId)
            Tracer->>Tracer: Tracing.end → IO.read → summary
            Tracer-->>BG: { ok, summary }
            BG-->>Popup: result
            Popup->>Popup: _appendPerfResultLine(整条 totalEvents)
        else 维度 = 单步
            loop 每一步
                Popup->>BG: perfTracingStart
                BG->>Tracer: attach/start
                Tracer-->>Popup: ok
                Popup->>BG: startExecution, steps: [一步]
                BG->>Content: 单步
                Note over Popup,Storage: 轮询至本步结束
                Popup->>BG: perfTracingStop
                BG->>Tracer: end → summary
                Tracer-->>Popup: summary
                Popup->>Popup: _appendPerfResultLine(步骤 N)
            end
        end

        Popup->>Flask: POST /api/runs/:run_id/finish
    end

    Popup-->>User: 批量结果弹窗 + 性能面板多行结果
```

---

## 4. 录制步骤

```mermaid
sequenceDiagram
    participant User
    participant Popup as Popup (RecordingManager)
    participant BG as Background
    participant Content as Content Script (当前页)
    participant Storage as chrome.storage
    participant Flask as Flask API

    User->>Popup: 新增/编辑用例 → 点击「开始录制」
    Popup->>BG: sendMessage({ type: 'startRecording' })
    Note over BG,Content: Background 可能转发或 Content 自行监听
    Popup->>Content: tabs.sendMessage(tabId, startRecording) 或 由 Content 已就绪
    Content->>Content: 开启 DOM 监听 (click, input, change...)

    User->>Content: 在页面上操作 (点击、输入等)
    Content->>Content: 生成 step { action, selector, value, ... }
    Content->>Popup: sendMessage({ action: 'stepRecorded', step })
    Popup->>Popup: recordingManager.addStep(step)
    Popup->>Popup: saveStepsToSession()
    Popup->>BG: sendMessage({ type: 'persistSteps', steps })
    BG->>Storage: set(uiap_steps, steps)
    BG-->>Popup: { ok }
    Popup->>Popup: updateStepsList(), updateRecordCount()

    User->>Popup: 点击「停止录制」
    Popup->>Content: tabs.sendMessage(tabId, { type: 'stopRecording' })
    Content->>Content: 关闭录制监听
    Popup->>Popup: 保存用例 → saveCase()
    Popup->>Flask: POST/PUT /api/cases (name, steps, folder_id...)
    Flask-->>Popup: 201/200
    Popup-->>User: 返回用例管理
```

---

## 5. 保存 / 加载用例与文件夹

```mermaid
sequenceDiagram
    participant User
    participant Popup as Popup
    participant Flask as Flask API

    User->>Popup: 编辑用例后点击「保存」
    Popup->>Flask: PUT /api/cases/:id { name, steps, folder_id, ... }
    Flask-->>Popup: 200
    Popup->>Popup: loadCasesList()
    Popup->>Flask: GET /api/cases?...
    Flask-->>Popup: cases[]
    Popup-->>User: 刷新树并返回用例管理

    User->>Popup: 新建文件夹 / 编辑文件夹名
    Popup->>Flask: POST /api/folders 或 PUT /api/folders/:id
    Flask-->>Popup: 201/200
    Popup->>Flask: GET /api/folders
    Flask-->>Popup: folders[]
    Popup->>Popup: renderTreeView()
```

---

## 6. 组件概览与消息流向

```mermaid
flowchart LR
    subgraph ext [Chrome 扩展]
        Popup[侧边栏 Popup]
        BG[Background]
        Tracer[background-perf-tracing]
        Content[Content Script]
    end
    subgraph svc [服务端]
        Flask[Flask API]
    end
    subgraph opt [可选 / 遗留]
        PerfCtrl[perf-controller Node]
    end
    subgraph page [目标页]
        Tab[标签页内核]
    end

    Popup <--> Flask
    Popup <--> BG
    BG <--> Content
    BG <--> Tracer
    Tracer -.->|chrome.debugger CDP| Tab
    Content <--> Tab
    PerfCtrl -.->|可选: 远程调试端口| Tab
```

- **Popup**：用例树、录制面板、执行与「性能测试」开关、维度（单步/整条）、手动开始/停止采集、结果展示、可拖拽面板高度；与 Flask 拉取/保存用例与文件夹。
- **Background**：`startExecution` / `stopExecution`、执行状态写入 storage、向目标 tab 的 Content 发 `runStep`；**转发** `perfTracingStart` / `perfTracingStop` 至 `background-perf-tracing.js`。
- **background-perf-tracing**：在同一 `tabId` 上 `chrome.debugger` + CDP Tracing，返回 `summary.totalEvents`（不经过 Node）。
- **Content**：目标页 DOM 自动化与录制上报。
- **Flask**：用例与文件夹 CRUD、执行记录接口。
- **perf-controller（可选）**：独立 Node 服务，历史上用于 HTTP 触发 Tracing；**当前插件默认流程不依赖**，仅在你自行对接远程调试工作流时使用。
