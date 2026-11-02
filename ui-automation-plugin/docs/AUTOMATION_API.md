# Chrome API 自动化操作文档

## 基础操作

### 1. 点击操作
```javascript
// 基础点击
await automation.click('#button');

// 高级点击选项
await automation.click('#button', {
  timeout: 5000,      // 等待超时时间
  scroll: true,       // 是否滚动到元素
  highlight: true,    // 是否高亮元素
  waitAfter: 500      // 点击后等待时间
});
```

### 2. 输入操作
```javascript
// 基础输入
await automation.type('#input', 'Hello World');

// 高级输入选项
await automation.type('#input', 'Hello World', {
  timeout: 5000,      // 等待超时时间
  clear: true,        // 是否清空原有内容
  highlight: true,    // 是否高亮元素
  waitAfter: 500      // 输入后等待时间
});
```

### 3. 获取文本
```javascript
// 获取元素文本
const result = await automation.getText('#element');
console.log(result.text);

// 获取元素属性
const result = await automation.getAttribute('#element', 'href');
console.log(result.value);
```

### 4. 滚动操作
```javascript
// 基础滚动
await automation.scroll();

// 高级滚动选项
await automation.scroll({
  direction: 'down',  // 滚动方向: up, down, left, right
  distance: 300,      // 滚动距离
  smooth: true,       // 是否平滑滚动
  waitAfter: 500     // 滚动后等待时间
});

// 滚动到指定元素
await automation.scrollToElement('#element', {
  block: 'center',    // 垂直对齐方式
  inline: 'center',   // 水平对齐方式
  smooth: true        // 是否平滑滚动
});
```

## 高级操作

### 1. 等待操作
```javascript
// 等待元素出现
await automation.waitForElement('#element', {
  timeout: 10000,     // 等待超时时间
  visible: true       // 是否要求元素可见
});

// 等待元素消失
await automation.waitForElementToDisappear('#element', {
  timeout: 10000      // 等待超时时间
});
```

### 2. 表单操作
```javascript
// 选择下拉框选项
await automation.selectOption('#select', 'option-value');

// 勾选复选框
await automation.check('#checkbox', {
  checked: true       // 是否勾选
});

// 提交表单
await automation.submitForm('#form');
```

### 3. 键盘操作
```javascript
// 按键
await automation.pressKey('Enter');

// 快捷键
await automation.shortcut('ctrl+c');
await automation.shortcut('alt+tab');
```

### 4. 截图操作
```javascript
// 基础截图
const result = await automation.screenshot();

// 高级截图选项
const result = await automation.screenshot({
  format: 'png',      // 图片格式
  quality: 0.8,       // 图片质量
  fullPage: true      // 是否截取整个页面
});
```

## 工作流程管理

### 1. 创建工作流程
```javascript
// 创建简单工作流程
const workflow = advancedAutomation.createWorkflow('登录流程', '自动登录系统');

// 添加步骤
advancedAutomation.addStep(workflow.id, {
  type: 'type',
  data: {
    selector: '#username',
    text: 'admin',
    options: { timeout: 5000 }
  }
});

advancedAutomation.addStep(workflow.id, {
  type: 'type',
  data: {
    selector: '#password',
    text: 'password',
    options: { timeout: 5000 }
  }
});

advancedAutomation.addStep(workflow.id, {
  type: 'click',
  data: {
    selector: '#login-button',
    options: { timeout: 5000 }
  }
});
```

### 2. 执行工作流程
```javascript
// 执行工作流程
const result = await advancedAutomation.executeWorkflow(workflow.id, {
  stopOnError: true,  // 遇到错误时是否停止
  retryCount: 0,      // 重试次数
  delay: 1000         // 步骤间延迟
});
```

## 条件执行

### 1. 条件判断
```javascript
// 添加条件步骤
advancedAutomation.addStep(workflow.id, {
  type: 'condition',
  data: {
    selector: '#status',
    operator: 'equals',
    expectedValue: 'success',
    valueType: 'text',
    trueSteps: [
      { type: 'click', data: { selector: '#next-button' } }
    ],
    falseSteps: [
      { type: 'click', data: { selector: '#retry-button' } }
    ]
  }
});
```

### 2. 循环执行
```javascript
// 添加循环步骤
advancedAutomation.addStep(workflow.id, {
  type: 'loop',
  data: {
    type: 'count',
    count: 5,
    steps: [
      { type: 'click', data: { selector: '#next-page' } },
      { type: 'wait', data: { duration: 2000 } }
    ],
    delay: 1000
  }
});
```

## 数据提取

### 1. 提取表格数据
```javascript
const result = await advancedAutomation.extractTableData('#table', {
  includeHeaders: true,  // 是否包含表头
  timeout: 5000          // 等待超时时间
});

console.log(result.data); // 二维数组
```

### 2. 提取列表数据
```javascript
const result = await advancedAutomation.extractListData('#list', {
  itemSelector: 'li',    // 列表项选择器
  timeout: 5000          // 等待超时时间
});

console.log(result.data); // 字符串数组
```

### 3. 提取表单数据
```javascript
const result = await advancedAutomation.extractFormData('#form', {
  timeout: 5000          // 等待超时时间
});

console.log(result.data); // 对象，包含所有表单字段
```

## 文件操作

### 1. 下载文件
```javascript
const result = await advancedAutomation.downloadFile(
  'https://example.com/file.pdf',
  'downloaded-file.pdf',
  {
    timeout: 30000,      // 下载超时时间
    showProgress: true   // 是否显示进度
  }
);
```

### 2. 上传文件
```javascript
const file = new File(['content'], 'test.txt', { type: 'text/plain' });
const result = await advancedAutomation.uploadFile('#file-input', file, {
  timeout: 5000          // 等待超时时间
});
```

## 使用示例

### 完整登录流程
```javascript
// 1. 创建登录工作流程
const loginWorkflow = advancedAutomation.createWorkflow('自动登录', '登录到系统');

// 2. 添加登录步骤
advancedAutomation.addStep(loginWorkflow.id, {
  type: 'type',
  data: {
    selector: '#username',
    text: '{{username}}',
    options: { timeout: 5000, clear: true }
  }
});

advancedAutomation.addStep(loginWorkflow.id, {
  type: 'type',
  data: {
    selector: '#password',
    text: '{{password}}',
    options: { timeout: 5000, clear: true }
  }
});

advancedAutomation.addStep(loginWorkflow.id, {
  type: 'click',
  data: {
    selector: '#login-button',
    options: { timeout: 5000 }
  }
});

// 3. 添加等待和验证
advancedAutomation.addStep(loginWorkflow.id, {
  type: 'waitForElement',
  data: {
    selector: '#dashboard',
    options: { timeout: 10000 }
  }
});

// 4. 执行工作流程
const result = await advancedAutomation.executeWorkflow(loginWorkflow.id, {
  variables: {
    username: 'admin',
    password: 'password123'
  }
});
```

### 数据提取流程
```javascript
// 1. 创建数据提取工作流程
const extractWorkflow = advancedAutomation.createWorkflow('数据提取', '提取页面数据');

// 2. 添加提取步骤
advancedAutomation.addStep(extractWorkflow.id, {
  type: 'extractTableData',
  data: {
    selector: '#data-table',
    options: { includeHeaders: true }
  }
});

// 3. 执行并获取结果
const result = await advancedAutomation.executeWorkflow(extractWorkflow.id);
console.log(result.results[0].result.data);
```

## 错误处理

### 1. 基础错误处理
```javascript
try {
  const result = await automation.click('#button');
  if (result.success) {
    console.log('点击成功');
  } else {
    console.error('点击失败:', result.error);
  }
} catch (error) {
  console.error('操作异常:', error.message);
}
```

### 2. 工作流程错误处理
```javascript
const result = await advancedAutomation.executeWorkflow(workflowId, {
  stopOnError: true,  // 遇到错误时停止
  retryCount: 3       // 重试3次
});

if (result.success) {
  console.log('工作流程执行成功');
} else {
  console.error('工作流程执行失败:', result.error);
  console.log('已完成的步骤:', result.results);
}
```

## 最佳实践

### 1. 选择器策略
- 优先使用ID选择器
- 使用有意义的类名
- 避免过于复杂的选择器
- 使用属性选择器作为备选

### 2. 等待策略
- 使用智能等待而不是固定延迟
- 设置合理的超时时间
- 检查元素可见性

### 3. 错误处理
- 始终检查操作结果
- 提供有意义的错误信息
- 实现重试机制

### 4. 性能优化
- 避免不必要的等待
- 使用批量操作
- 缓存元素引用

这个API提供了完整的Chrome自动化操作能力，既简单易用又功能强大！
