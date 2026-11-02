# 插件热更新使用指南

## 📋 简介

这个工具可以监听插件文件的变化，并在文件修改后自动提示重新加载扩展，实现开发时的热更新体验。

## 🚀 快速开始

### 1. 安装依赖

```bash
cd ui-automation-plugin
npm install
```

### 2. 获取扩展ID

#### 方法一：手动获取（推荐）

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 找到 "UI自动化插件" 扩展
4. 复制扩展ID（类似：`abcdefghijklmnopqrstuvwxyz123456`）
5. 保存到文件：

```bash
echo "你的扩展ID" > .extension-id
```

#### 方法二：通过控制台获取

1. 在扩展管理页面按 `F12` 打开开发者工具
2. 在控制台执行：

```javascript
chrome.management.getAll((extensions) => {
  const ext = extensions.find(e => e.name === "UI自动化插件");
  console.log('扩展ID:', ext.id);
  // 复制输出的ID，然后执行：
  // echo "复制的ID" > .extension-id
});
```

### 3. 启动热更新

```bash
npm run dev
```

或者：

```bash
node hot-reload.js
```

### 4. 开始开发

现在当你修改任何插件文件（`.js`, `.html`, `.css`, `.json`）时，工具会：
- 检测到文件变化
- 提示你重新加载扩展
- 在扩展管理页面手动点击刷新按钮即可

## 📝 使用说明

### 监听的文件类型

工具会监听以下文件的变化：
- `.js` - JavaScript 文件
- `.html` - HTML 文件
- `.css` - CSS 文件
- `.json` - JSON 配置文件（包括 manifest.json）

### 忽略的文件

以下文件不会被监听：
- `.extension-id` - 扩展ID文件
- `node_modules/` - 依赖目录
- `.git/` - Git 目录
- `package.json` - 包配置文件
- `hot-reload*.js` - 热更新脚本本身

### 重新加载扩展

当文件变化时，工具会提示你重新加载扩展。有两种方式：

#### 方式一：手动刷新（推荐）

1. 打开 `chrome://extensions/`
2. 找到 "UI自动化插件"
3. 点击刷新按钮 🔄

#### 方式二：使用 Chrome Management API

在扩展管理页面打开控制台，执行：

```javascript
const extensionId = '你的扩展ID';
chrome.management.setEnabled(extensionId, false, () => {
  chrome.management.setEnabled(extensionId, true);
});
```

## 🔧 高级用法

### 修改监听延迟

默认在文件变化后 500ms 触发重新加载提示。可以在 `hot-reload.js` 中修改：

```javascript
reloadTimer = setTimeout(() => {
  reloadExtension(extensionId);
}, 500); // 修改这个延迟时间（毫秒）
```

### 添加自定义忽略规则

在 `hot-reload.js` 的 `watcher` 配置中添加：

```javascript
ignored: [
  /(^|[\/\\])\../,
  /node_modules/,
  /\.extension-id$/,
  /你的自定义规则/
]
```

## ⚠️ 注意事项

1. **扩展ID必须正确**：如果扩展ID不正确，工具无法自动重新加载扩展
2. **需要手动刷新**：由于 Chrome 扩展的安全限制，无法完全自动重新加载，需要手动点击刷新按钮
3. **保持扩展管理页面打开**：建议在开发时保持 `chrome://extensions/` 页面打开，方便快速刷新
4. **Content Script 需要刷新页面**：修改 `content.js` 等 content script 后，除了重新加载扩展，还需要刷新目标页面才能生效

## 🐛 故障排除

### 问题：找不到扩展ID

**解决方案：**
1. 确认扩展已加载到 Chrome
2. 访问 `chrome://extensions/` 查看扩展ID
3. 将ID保存到 `.extension-id` 文件

### 问题：文件变化没有检测到

**解决方案：**
1. 确认文件在监听目录内
2. 检查文件是否在忽略列表中
3. 查看控制台是否有错误信息

### 问题：扩展重新加载失败

**解决方案：**
1. 手动在扩展管理页面点击刷新按钮
2. 检查扩展是否有错误（查看扩展详情页面的错误信息）
3. 确认 manifest.json 格式正确

## 💡 开发建议

1. **使用多个终端窗口**：
   - 一个运行热更新工具
   - 一个运行后端服务（如果需要）
   - 一个用于其他操作

2. **保持扩展管理页面打开**：
   - 方便快速查看错误信息
   - 快速点击刷新按钮

3. **使用 Chrome 开发者工具**：
   - 侧边栏调试：右键扩展图标 → 检查弹出内容
   - Background 调试：扩展管理页面 → 检查视图 → Service Worker
   - Content Script 调试：在目标页面按 F12

## 📚 相关文档

- [Chrome 扩展开发文档](https://developer.chrome.com/docs/extensions/)
- [调试指南](./README.md)
- [项目主 README](../README.md)

