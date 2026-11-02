# UI自动化项目调试指南

## 📋 目录
1. [Chrome扩展调试](#chrome扩展调试)
2. [后端服务调试](#后端服务调试)
3. [常见问题排查](#常见问题排查)
4. [日志查看](#日志查看)
5. [调试技巧](#调试技巧)

---

## 🔧 Chrome扩展调试

### 1. 侧边栏（Popup）调试

**步骤：**
1. 打开Chrome扩展管理页面：`chrome://extensions/`
2. 找到"UI自动化插件"，点击"检查视图" → "侧边栏"
3. 或者右键点击插件图标 → "检查弹出内容"

**调试内容：**
- 查看 `popup.js` 的 console 输出
- 检查网络请求（API调用）
- 查看 DOM 结构和样式
- 设置断点调试

**常用调试命令：**
```javascript
// 在控制台直接访问模块
window.caseManager
window.recordingManager
window.folderManager
window.uiUtils

// 查看当前状态
console.log('用例列表:', window.caseManager.casesList)
console.log('录制步骤:', window.recordingManager.recordedSteps)
console.log('文件夹:', window.folderManager.folders)
```

### 2. Content Script 调试

**步骤：**
1. 在目标网页上按 `F12` 打开开发者工具
2. 在 Console 中可以看到 content script 的日志
3. 注意：content script 运行在页面上下文中，可以访问页面 DOM

**调试技巧：**
```javascript
// 在页面控制台检查 content script 是否加载
console.log(window.__UI_AUTOMATION_CONTENT_LOADED__)

// 手动触发录制测试
chrome.runtime.sendMessage({ type: 'startRecording' }, (response) => {
  console.log('录制响应:', response)
})

// 检查录制状态
chrome.runtime.sendMessage({ type: 'getRecordedSteps' }, (response) => {
  console.log('当前步骤:', response)
})
```

### 3. Background Script 调试

**步骤：**
1. 打开 `chrome://extensions/`
2. 找到插件，点击"检查视图" → "Service Worker"
3. 会打开一个独立的调试窗口

**调试内容：**
- 查看执行状态
- 监控消息传递
- 检查存储数据

**常用调试命令：**
```javascript
// 查看执行状态
chrome.storage.local.get('uiap_execution_state', (data) => {
  console.log('执行状态:', data)
})

// 查看持久化的步骤
chrome.storage.local.get('uiap_steps', (data) => {
  console.log('持久化步骤:', data)
})

// 清除所有存储
chrome.storage.local.clear(() => {
  console.log('存储已清除')
})
```

### 4. 网络请求调试

**在侧边栏控制台：**
```javascript
// 测试API连接
fetch('http://localhost:5000/api/health')
  .then(r => r.json())
  .then(data => console.log('健康检查:', data))

// 查看用例列表
fetch('http://localhost:5000/api/cases')
  .then(r => r.json())
  .then(data => console.log('用例列表:', data))
```

---

## 🖥️ 后端服务调试

### 1. 启动调试模式

**方法1：直接运行（开发模式）**
```bash
cd server
python app.py
# 默认运行在 http://localhost:5000，开启 debug=True
```

**方法2：使用启动脚本**
```bash
cd server
./start.sh
```

### 2. 查看日志

**实时查看应用日志：**
```bash
cd server
tail -f logs/app.log
```

**查看错误日志：**
```bash
tail -f logs/error.log
```

**查看所有日志：**
```bash
tail -f logs/*.log
```

### 3. 使用日志脚本
```bash
cd server
./logs.sh  # 显示最近50行日志
```

### 4. API 测试

**使用 curl 测试：**
```bash
# 健康检查
curl http://localhost:5000/api/health

# 获取用例列表
curl http://localhost:5000/api/cases

# 创建用例
curl -X POST http://localhost:5000/api/cases \
  -H "Content-Type: application/json" \
  -d '{"name":"测试用例","description":"测试","steps":"[]"}'

# 获取文件夹列表
curl http://localhost:5000/api/folders
```

**使用浏览器测试：**
- 直接访问：http://localhost:5000/api/health
- 使用 Postman 或类似工具

### 5. 数据库调试

**检查数据库连接：**
```python
# 在 Python 控制台
from app import app, db
with app.app_context():
    from app import TestCase, Folder
    # 查看用例数量
    print(TestCase.query.count())
    # 查看文件夹数量
    print(Folder.query.count())
```

**查看表结构：**
```bash
cd server
python check_tables.py
```

---

## 🐛 常见问题排查

### 1. 插件无法加载

**检查清单：**
- ✅ 确认 `manifest.json` 格式正确
- ✅ 检查文件路径是否正确
- ✅ 查看扩展管理页面的错误信息
- ✅ 重新加载插件（点击刷新按钮）

**调试步骤：**
```javascript
// 在扩展管理页面查看错误
// 常见错误：
// - "Manifest file is missing or unreadable" → 检查 manifest.json
// - "Service worker registration failed" → 检查 background.js
// - "Content script failed" → 检查 content.js
```

### 2. 录制功能不工作

**排查步骤：**

1. **检查 content script 是否加载**
```javascript
// 在页面控制台
console.log(window.__UI_AUTOMATION_CONTENT_LOADED__)
// 应该输出 true
```

2. **检查录制状态**
```javascript
// 在侧边栏控制台
console.log('录制状态:', window.recordingManager.isRecording)
```

3. **检查消息传递**
```javascript
// 在 content script 中手动发送测试消息
chrome.runtime.sendMessage(
  { action: 'stepRecorded', step: { type: 'click', selector: '#test' } },
  (response) => console.log('响应:', response)
)
```

4. **查看权限**
- 确认 `manifest.json` 中有 `host_permissions: ["<all_urls>"]`
- 确认 `permissions` 包含 `activeTab`, `scripting`

### 3. 执行失败

**排查步骤：**

1. **检查执行状态**
```javascript
// 在 background script 控制台
chrome.storage.local.get('uiap_execution_state', (data) => {
  console.log('执行状态:', data)
})
```

2. **检查页面跳转**
- 查看 background.js 的日志
- 确认页面跳转检测逻辑是否正常

3. **检查元素选择器**
```javascript
// 在页面控制台测试选择器
document.querySelector('#your-selector')
// 如果返回 null，说明选择器有问题
```

4. **查看错误信息**
- 检查 background script 控制台的错误
- 检查 content script 控制台的错误

### 4. API 请求失败

**排查步骤：**

1. **检查服务是否运行**
```bash
# 检查端口是否被占用
lsof -i :5000

# 检查服务是否响应
curl http://localhost:5000/api/health
```

2. **检查 CORS 配置**
- 确认 Flask 中已启用 CORS
- 检查请求头是否正确

3. **查看网络请求**
- 在侧边栏控制台的 Network 标签
- 查看请求和响应详情

4. **检查数据库连接**
```python
# 在 Flask 控制台
from app import db
try:
    db.engine.connect()
    print("数据库连接成功")
except Exception as e:
    print("数据库连接失败:", e)
```

### 5. 数据丢失问题

**排查步骤：**

1. **检查存储**
```javascript
// 检查 Chrome Storage
chrome.storage.local.get(null, (items) => {
  console.log('所有存储:', items)
})

// 检查 IndexedDB
// 在 Application 标签 → IndexedDB → uiap-db
```

2. **检查数据库**
```sql
-- SQLite：sqlite3 server/instance/automation_cases.db
SELECT * FROM test_case;
SELECT * FROM folders;
```

---

## 📊 日志查看

### Chrome 扩展日志位置

1. **侧边栏日志**：侧边栏控制台
2. **Content Script 日志**：页面控制台
3. **Background Script 日志**：Service Worker 控制台

### 后端日志位置

- **应用日志**：`server/logs/app.log`
- **错误日志**：`server/logs/error.log`

### 日志级别

**后端日志包含：**
- 请求详情（URL、方法、参数）
- 响应详情（状态码、数据大小）
- 数据库操作
- 错误信息

**前端日志包含：**
- 模块初始化
- 用户操作
- API 请求
- 错误信息

---

## 💡 调试技巧

### 1. 使用断点

**在 Chrome DevTools：**
- 在 Sources 标签找到文件
- 点击行号设置断点
- 刷新页面或触发操作

**在代码中添加断点：**
```javascript
debugger; // 代码执行到这里会暂停
```

### 2. 监控消息传递

```javascript
// 在 background.js 中添加
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('📨 收到消息:', msg, '来自:', sender)
  // ... 原有逻辑
})
```

### 3. 监控存储变化

```javascript
// 在 popup.js 中添加
chrome.storage.onChanged.addListener((changes, area) => {
  console.log('💾 存储变化:', changes, '区域:', area)
})
```

### 4. 性能分析

**使用 Performance 标签：**
- 录制操作过程
- 分析执行时间
- 查找性能瓶颈

**使用 Memory 标签：**
- 检查内存泄漏
- 查看对象引用

### 5. 网络分析

**在 Network 标签：**
- 查看 API 请求时间
- 检查请求/响应数据
- 分析网络错误

### 6. 元素选择器测试

```javascript
// 在页面控制台测试选择器
function testSelector(selector) {
  const el = document.querySelector(selector)
  if (el) {
    console.log('✅ 找到元素:', el)
    el.style.border = '2px solid red' // 高亮显示
    return el
  } else {
    console.log('❌ 未找到元素:', selector)
    return null
  }
}

// 使用
testSelector('#your-selector')
```

### 7. 录制步骤验证

```javascript
// 在侧边栏控制台
const steps = window.recordingManager.getRecordedSteps()
console.log('当前步骤:', steps)

// 验证步骤格式
steps.forEach((step, index) => {
  console.log(`步骤 ${index + 1}:`, {
    type: step.type,
    selector: step.selector,
    value: step.value,
    description: step.description
  })
})
```

### 8. 模拟执行

```javascript
// 在页面控制台手动执行步骤
const step = {
  type: 'click',
  selector: '#button-id'
}

// 发送到 content script
chrome.runtime.sendMessage({
  type: 'playSingleStep',
  step: step
}, (response) => {
  console.log('执行结果:', response)
})
```

---

## 🔍 调试检查清单

### 开发前检查
- [ ] 后端服务已启动
- [ ] 数据库连接正常
- [ ] 插件已加载且无错误
- [ ] 所有文件路径正确

### 录制时检查
- [ ] Content script 已加载
- [ ] 录制状态为 true
- [ ] 步骤正常添加到列表
- [ ] 步骤已持久化到存储

### 执行时检查
- [ ] Background script 正常运行
- [ ] 执行状态正确更新
- [ ] 页面跳转检测正常
- [ ] Content script 重新注入成功

### 保存时检查
- [ ] API 请求成功
- [ ] 数据正确保存到数据库
- [ ] 用例列表正确刷新

---

## 📞 获取帮助

如果遇到问题：

1. **查看日志**：检查所有相关日志文件
2. **检查控制台**：查看浏览器控制台错误
3. **验证配置**：确认所有配置正确
4. **测试最小场景**：简化问题，逐步排查

---

**提示**：调试时保持耐心，逐步缩小问题范围，使用日志和断点定位具体问题。

