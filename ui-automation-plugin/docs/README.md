# UI自动化插件

## 🚀 开发模式（热更新）

### 快速开始

1. **安装依赖**
   ```bash
   cd ui-automation-plugin
   npm install
   ```

2. **设置扩展ID**
   ```bash
   # 获取扩展ID：访问 chrome://extensions/，找到扩展并复制ID
   echo "你的扩展ID" > .extension-id
   ```

3. **启动热更新**
   ```bash
   npm run dev
   ```

4. **开始开发**
   - 修改任何插件文件后，工具会自动提示重新加载扩展
   - 在扩展管理页面点击刷新按钮即可

详细说明请查看 [热更新使用指南](./README_HOT_RELOAD.md)

---

## 📁 项目结构

```
UI自动化插件/
├── ui-automation-plugin/   # 统一自动化插件
│   ├── manifest.json      # 插件配置
│   ├── background.js      # 后台脚本
│   ├── popup.html         # 侧边栏界面
│   ├── popup.js           # 界面逻辑
│   ├── popup.css          # 样式文件
│   ├── content.js         # 页面脚本
│   ├── automation-core.js # 核心自动化API
│   └── automation-advanced.js # 高级自动化API
├── AUTOMATION_API.md      # API文档
└── README.md             # 项目说明
```

## 🚀 统一自动化插件

### **功能特点**
- **🔧 基础操作**: 点击、输入、滚动等基础功能
- **🎬 可视化**: 录制回放、可视化操作
- **⚡ 高级功能**: 工作流程、数据提取、文件操作

### **三种模式**

#### 1. **基础操作模式** 🔧
- **适用**: 开发者、技术用户
- **功能**: 
  - ✅ 点击操作（文本/选择器）
  - ✅ 输入操作
  - ✅ 滚动操作
  - ✅ 登录测试
  - ✅ 页面调试
  - ✅ 错误检查

#### 2. **可视化模式** 🎬
- **适用**: 普通用户、业务人员
- **功能**:
  - 🎬 操作录制
  - ▶️ 操作回放
  - ✏️ 步骤编辑
  - ⚡ 快速操作
  - 📋 工作流程管理

#### 3. **高级功能模式** ⚡
- **适用**: 高级用户、专业需求
- **功能**:
  - 🔄 工作流程管理
  - 📊 数据提取
  - 📁 文件操作
  - 🔍 调试工具
  - 📈 性能监控

## 📦 安装方式

### 安装插件
1. 打开 Chrome 扩展管理页面 (`chrome://extensions/`)
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `ui-automation-plugin/` 文件夹

## 🎯 使用场景

| 场景 | 推荐模式 | 原因 |
|------|----------|------|
| 调试网页元素 | 基础操作 | 精确选择器控制 |
| 自动化登录 | 基础操作 | 专门优化登录流程 |
| 重复性任务 | 可视化 | 录制一次，重复执行 |
| 业务流程 | 可视化 | 用户友好，无需技术背景 |
| 开发测试 | 基础操作 | 灵活配置，快速调试 |
| 数据处理 | 高级功能 | 专业工具，功能强大 |

## 🔧 开发说明

### 共享文件
- `content.js` - 两个插件都使用相同的页面交互逻辑
- `automation-core.js` - 基础插件使用核心API
- `automation-advanced.js` - 基础插件使用高级API

### 独立配置
- 每个插件有自己的 `manifest.json`
- 每个插件有自己的 `background.js`
- 每个插件有自己的UI界面

## 📚 API文档

详细的API使用说明请参考: [AUTOMATION_API.md](./AUTOMATION_API.md)

## 🎨 图标文件

每个插件需要以下图标文件（需要自行添加）:
- `icon16.png` (16x16)
- `icon48.png` (48x48) 
- `icon128.png` (128x128)

## 🚀 未来扩展

- 可以添加更多专业插件（如数据提取、性能监控等）
- 可以创建插件间的通信机制
- 可以添加云端同步功能

ui-automation-plugin/
├── manifest.json          # Chrome扩展清单文件
├── config.js              # 配置文件
├── background.js          # 后台脚本
├── package.json           # 项目配置
├── jsconfig.json          # JS配置
│
├── popup/                 # Popup界面相关
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
│
├── content/               # Content Script相关
│   └── content.js
│
├── modules/               # 业务模块
│   ├── managers/         # 管理器模块
│   │   ├── folder-manager.js
│   │   ├── case-manager.js
│   │   └── recording-manager.js
│   └── utils/            # 工具模块
│       └── ui-utils.js
│
├── automation/           # 自动化功能
│   ├── automation-core.js
│   └── automation-advanced.js
│
├── scripts/              # 开发脚本
│   └── hot-reload/       # 热重载工具
│       ├── hot-reload.js
│       ├── hot-reload-simple.js
│       └── hot-reload-chrome.js
│
└── docs/                 # 文档
    ├── README.md
    ├── README_HOT_RELOAD.md
    └── AUTOMATION_API.md