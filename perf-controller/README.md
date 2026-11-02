# perf-controller（可选 / 遗留）

本目录为 **独立的 Node HTTP 服务**，通过 **Chrome 远程调试端口**（如 `--remote-debugging-port=9222`）连接浏览器，使用 **puppeteer-core** 做 CDP Tracing 启停。

## 与 ui-automation-plugin 的关系

- **当前默认**：`ui-automation-plugin` 已在扩展内通过 **`chrome.debugger` + `background-perf-tracing.js`** 完成性能采集，**不需要**启动本服务。
- **本服务定位**：可选工具；适用于希望从 **Node/CI** 侧通过 HTTP 控制 Tracing、或沿用旧架构对接的场景，**不是**侧边栏用例执行的必需组件。

安装与运行见同目录 **`requirements.txt`**。
