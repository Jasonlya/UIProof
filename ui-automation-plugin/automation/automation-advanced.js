// 高级自动化操作封装
class AdvancedAutomation {
  constructor() {
    this.automation = window.automation; // 引用基础自动化类
    this.workflows = [];
    this.currentWorkflow = null;
    this.init();
  }
  
  init() {
    this.setupWorkflowManager();
  }
  
  // ==================== 工作流程管理 ====================
  
  // 创建工作流程
  createWorkflow(name, description = '') {
    const workflow = {
      id: Date.now(),
      name: name,
      description: description,
      steps: [],
      variables: {},
      createdAt: new Date().toISOString()
    };
    
    this.workflows.push(workflow);
    return workflow;
  }
  
  // 添加步骤到工作流程
  addStep(workflowId, step) {
    const workflow = this.workflows.find(w => w.id === workflowId);
    if (workflow) {
      workflow.steps.push({
        id: Date.now(),
        ...step,
        order: workflow.steps.length
      });
    }
    return workflow;
  }
  
  // 执行工作流程
  async executeWorkflow(workflowId, options = {}) {
    const { 
      stopOnError = true, 
      retryCount = 0,
      delay = 1000 
    } = options;
    
    const workflow = this.workflows.find(w => w.id === workflowId);
    if (!workflow) {
      return { success: false, error: '工作流程不存在' };
    }
    
    this.currentWorkflow = workflow;
    const results = [];
    
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      
      try {
        const result = await this.executeStep(step, workflow.variables);
        results.push({ step: step, result: result });
        
        if (!result.success && stopOnError) {
          return { 
            success: false, 
            error: `步骤 ${i + 1} 执行失败: ${result.error}`,
            results: results
          };
        }
        
        if (delay > 0) {
          await this.automation.sleep(delay);
        }
      } catch (error) {
        if (stopOnError) {
          return { 
            success: false, 
            error: `步骤 ${i + 1} 执行异常: ${error.message}`,
            results: results
          };
        }
      }
    }
    
    return { success: true, results: results };
  }
  
  // 执行单个步骤
  async executeStep(step, variables = {}) {
    const { type, data } = step;
    
    // 替换变量
    const processedData = this.replaceVariables(data, variables);
    
    switch (type) {
      case 'click':
        return await this.automation.click(processedData.selector, processedData.options);
      case 'type':
        return await this.automation.type(processedData.selector, processedData.text, processedData.options);
      case 'wait':
        return await this.automation.sleep(processedData.duration);
      case 'scroll':
        return await this.automation.scroll(processedData.options);
      case 'screenshot':
        return await this.automation.screenshot(processedData.options);
      case 'condition':
        return await this.executeCondition(processedData, variables);
      case 'loop':
        return await this.executeLoop(processedData, variables);
      default:
        return { success: false, error: `未知步骤类型: ${type}` };
    }
  }
  
  // ==================== 条件执行 ====================
  
  // 执行条件
  async executeCondition(condition, variables) {
    const { 
      selector, 
      operator, 
      expectedValue, 
      trueSteps, 
      falseSteps 
    } = condition;
    
    try {
      const element = await this.automation.findElement(selector);
      const actualValue = this.getElementValue(element, condition.valueType);
      
      const isTrue = this.compareValues(actualValue, operator, expectedValue);
      
      if (isTrue && trueSteps) {
        return await this.executeSteps(trueSteps, variables);
      } else if (!isTrue && falseSteps) {
        return await this.executeSteps(falseSteps, variables);
      }
      
      return { success: true, result: isTrue };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 比较值
  compareValues(actual, operator, expected) {
    switch (operator) {
      case 'equals':
        return actual === expected;
      case 'contains':
        return actual.includes(expected);
      case 'startsWith':
        return actual.startsWith(expected);
      case 'endsWith':
        return actual.endsWith(expected);
      case 'greaterThan':
        return Number(actual) > Number(expected);
      case 'lessThan':
        return Number(actual) < Number(expected);
      case 'exists':
        return actual !== null && actual !== undefined;
      default:
        return false;
    }
  }
  
  // 获取元素值
  getElementValue(element, valueType) {
    switch (valueType) {
      case 'text':
        return element.textContent.trim();
      case 'value':
        return element.value;
      case 'attribute':
        return element.getAttribute(valueType.attribute);
      case 'visible':
        return this.automation.isElementVisible(element);
      default:
        return element.textContent.trim();
    }
  }
  
  // ==================== 循环执行 ====================
  
  // 执行循环
  async executeLoop(loopData, variables) {
    const { 
      type, 
      count, 
      condition, 
      steps, 
      delay = 1000 
    } = loopData;
    
    const results = [];
    
    if (type === 'count') {
      for (let i = 0; i < count; i++) {
        variables.loopIndex = i;
        const result = await this.executeSteps(steps, variables);
        results.push(result);
        
        if (delay > 0) {
          await this.automation.sleep(delay);
        }
      }
    } else if (type === 'condition') {
      let index = 0;
      while (await this.evaluateCondition(condition, variables)) {
        variables.loopIndex = index;
        const result = await this.executeSteps(steps, variables);
        results.push(result);
        
        if (delay > 0) {
          await this.automation.sleep(delay);
        }
        
        index++;
      }
    }
    
    return { success: true, results: results };
  }
  
  // 执行步骤列表
  async executeSteps(steps, variables) {
    const results = [];
    
    for (const step of steps) {
      const result = await this.executeStep(step, variables);
      results.push(result);
      
      if (!result.success) {
        break;
      }
    }
    
    return { success: true, results: results };
  }
  
  // 评估条件
  async evaluateCondition(condition, variables) {
    const { selector, operator, expectedValue } = condition;
    
    try {
      const element = await this.automation.findElement(selector);
      const actualValue = this.getElementValue(element, condition.valueType);
      return this.compareValues(actualValue, operator, expectedValue);
    } catch (error) {
      return false;
    }
  }
  
  // ==================== 数据提取 ====================
  
  // 提取表格数据
  async extractTableData(selector, options = {}) {
    const { 
      includeHeaders = true, 
      timeout = 5000 
    } = options;
    
    try {
      const table = await this.automation.findElement(selector, { timeout });
      const rows = table.querySelectorAll('tr');
      const data = [];
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.querySelectorAll('td, th');
        const rowData = [];
        
        for (const cell of cells) {
          rowData.push(cell.textContent.trim());
        }
        
        if (rowData.length > 0) {
          data.push(rowData);
        }
      }
      
      return { success: true, data: data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 提取列表数据
  async extractListData(selector, options = {}) {
    const { 
      itemSelector = 'li', 
      timeout = 5000 
    } = options;
    
    try {
      const list = await this.automation.findElement(selector, { timeout });
      const items = list.querySelectorAll(itemSelector);
      const data = [];
      
      for (const item of items) {
        data.push(item.textContent.trim());
      }
      
      return { success: true, data: data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 提取表单数据
  async extractFormData(selector, options = {}) {
    const { timeout = 5000 } = options;
    
    try {
      const form = await this.automation.findElement(selector, { timeout });
      const inputs = form.querySelectorAll('input, select, textarea');
      const data = {};
      
      for (const input of inputs) {
        const name = input.name || input.id;
        if (name) {
          if (input.type === 'checkbox' || input.type === 'radio') {
            data[name] = input.checked;
          } else {
            data[name] = input.value;
          }
        }
      }
      
      return { success: true, data: data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // ==================== 文件操作 ====================
  
  // 下载文件
  async downloadFile(url, filename, options = {}) {
    const { 
      timeout = 30000,
      showProgress = true 
    } = options;
    
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      return { success: true, filename: filename };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 上传文件
  async uploadFile(selector, file, options = {}) {
    const { timeout = 5000 } = options;
    
    try {
      const input = await this.automation.findElement(selector, { timeout });
      
      // 创建文件对象
      const fileList = new DataTransfer();
      fileList.items.add(file);
      
      input.files = fileList.files;
      
      // 触发事件
      input.dispatchEvent(new Event('change', { bubbles: true }));
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // ==================== 工具方法 ====================
  
  // 替换变量
  replaceVariables(data, variables) {
    if (typeof data === 'string') {
      return data.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return variables[key] || match;
      });
    } else if (typeof data === 'object' && data !== null) {
      const result = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.replaceVariables(value, variables);
      }
      return result;
    }
    return data;
  }
  
  // 设置工作流程管理器
  setupWorkflowManager() {
    // 监听来自popup的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleAdvancedMessage(request, sender, sendResponse);
      return true;
    });
  }
  
  // 处理高级消息
  async handleAdvancedMessage(request, sender, sendResponse) {
    const { action, data } = request;
    
    try {
      let result;
      
      switch (action) {
        case 'createWorkflow':
          result = this.createWorkflow(data.name, data.description);
          break;
        case 'addStep':
          result = this.addStep(data.workflowId, data.step);
          break;
        case 'executeWorkflow':
          result = await this.executeWorkflow(data.workflowId, data.options);
          break;
        case 'extractTableData':
          result = await this.extractTableData(data.selector, data.options);
          break;
        case 'extractListData':
          result = await this.extractListData(data.selector, data.options);
          break;
        case 'extractFormData':
          result = await this.extractFormData(data.selector, data.options);
          break;
        case 'downloadFile':
          result = await this.downloadFile(data.url, data.filename, data.options);
          break;
        case 'uploadFile':
          result = await this.uploadFile(data.selector, data.file, data.options);
          break;
        default:
          result = { success: false, error: '未知操作' };
      }
      
      sendResponse(result);
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
}

// 初始化高级自动化
const advancedAutomation = new AdvancedAutomation();
