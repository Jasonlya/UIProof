// Chrome API 自动化操作核心封装
class ChromeAutomation {
  constructor() {
    this.isRecording = false;
    this.recordedSteps = [];
    this.currentStep = 0;
    this.isExecuting = false;
    this.init();
  }
  
  init() {
    this.setupElementHighlighter();
    this.bindEvents();
  }
  
  // ==================== 元素定位 ====================
  
  // 智能元素定位
  findElement(selector, options = {}) {
    const { timeout = 5000, visible = true } = options;
    
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const search = () => {
        let element = null;
        
        // 尝试多种定位方式
        if (selector.startsWith('#')) {
          element = document.getElementById(selector.substring(1));
        } else if (selector.startsWith('.')) {
          element = document.querySelector(selector);
        } else if (selector.startsWith('[') && selector.endsWith(']')) {
          element = document.querySelector(selector);
        } else if (selector.includes(' ')) {
          element = document.querySelector(selector);
        } else {
          // 尝试标签名
          element = document.querySelector(selector);
        }
        
        // 检查元素是否可见
        if (element && visible && !this.isElementVisible(element)) {
          element = null;
        }
        
        if (element) {
          resolve(element);
        } else if (Date.now() - startTime > timeout) {
          reject(new Error(`元素未找到: ${selector}`));
        } else {
          setTimeout(search, 100);
        }
      };
      
      search();
    });
  }
  
  // 检查元素是否可见
  isElementVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      style.opacity !== '0'
    );
  }
  
  // 获取元素选择器
  getElementSelector(element) {
    // 优先使用ID
    if (element.id) {
      return `#${element.id}`;
    }
    
    // 使用类名
    if (element.className) {
      const classes = element.className.split(' ').filter(c => c.length > 0);
      if (classes.length > 0) {
        return `.${classes[0]}`;
      }
    }
    
    // 使用属性
    if (element.name) {
      return `[name="${element.name}"]`;
    }
    
    if (element.type) {
      return `[type="${element.type}"]`;
    }
    
    // 使用文本内容
    if (element.textContent && element.textContent.trim()) {
      const text = element.textContent.trim();
      if (text.length < 50) {
        return `text="${text}"`;
      }
    }
    
    // 使用标签名
    return element.tagName.toLowerCase();
  }
  
  // ==================== 基础操作 ====================
  
  // 点击元素
  async click(selector, options = {}) {
    const { 
      timeout = 5000, 
      scroll = true, 
      highlight = true,
      waitAfter = 500 
    } = options;
    
    try {
      const element = await this.findElement(selector, { timeout, visible: true });
      
      if (scroll) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await this.sleep(300);
      }
      
      if (highlight) {
        this.highlightElement(element);
      }
      
      // 模拟真实点击
      this.simulateClick(element);
      
      if (waitAfter > 0) {
        await this.sleep(waitAfter);
      }
      
      return { success: true, element: element };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 输入文本
  async type(selector, text, options = {}) {
    const { 
      timeout = 5000, 
      clear = true, 
      highlight = true,
      waitAfter = 500 
    } = options;
    
    try {
      const element = await this.findElement(selector, { timeout, visible: true });
      
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.sleep(300);
      
      if (highlight) {
        this.highlightElement(element);
      }
      
      element.focus();
      
      if (clear) {
        element.value = '';
      }
      
      // 模拟真实输入
      this.simulateTyping(element, text);
      
      if (waitAfter > 0) {
        await this.sleep(waitAfter);
      }
      
      return { success: true, element: element };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 获取文本
  async getText(selector, options = {}) {
    const { timeout = 5000 } = options;
    
    try {
      const element = await this.findElement(selector, { timeout, visible: true });
      return { success: true, text: element.textContent.trim() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 获取属性
  async getAttribute(selector, attribute, options = {}) {
    const { timeout = 5000 } = options;
    
    try {
      const element = await this.findElement(selector, { timeout, visible: true });
      return { success: true, value: element.getAttribute(attribute) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 设置属性
  async setAttribute(selector, attribute, value, options = {}) {
    const { timeout = 5000 } = options;
    
    try {
      const element = await this.findElement(selector, { timeout, visible: true });
      element.setAttribute(attribute, value);
      return { success: true, element: element };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // ==================== 高级操作 ====================
  
  // 等待元素出现
  async waitForElement(selector, options = {}) {
    const { timeout = 10000, visible = true } = options;
    
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const check = () => {
        const element = document.querySelector(selector);
        
        if (element && (!visible || this.isElementVisible(element))) {
          resolve({ success: true, element: element });
        } else if (Date.now() - startTime > timeout) {
          reject(new Error(`等待超时: ${selector}`));
        } else {
          setTimeout(check, 100);
        }
      };
      
      check();
    });
  }
  
  // 等待元素消失
  async waitForElementToDisappear(selector, options = {}) {
    const { timeout = 10000 } = options;
    
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const check = () => {
        const element = document.querySelector(selector);
        
        if (!element || !this.isElementVisible(element)) {
          resolve({ success: true });
        } else if (Date.now() - startTime > timeout) {
          reject(new Error(`等待超时: ${selector}`));
        } else {
          setTimeout(check, 100);
        }
      };
      
      check();
    });
  }
  
  // 滚动页面
  async scroll(options = {}) {
    const { 
      direction = 'down', 
      distance = 300, 
      smooth = true,
      waitAfter = 500 
    } = options;
    
    try {
      if (smooth) {
        if (direction === 'down') {
          window.scrollBy({ top: distance, behavior: 'smooth' });
        } else if (direction === 'up') {
          window.scrollBy({ top: -distance, behavior: 'smooth' });
        } else if (direction === 'left') {
          window.scrollBy({ left: -distance, behavior: 'smooth' });
        } else if (direction === 'right') {
          window.scrollBy({ left: distance, behavior: 'smooth' });
        }
      } else {
        if (direction === 'down') {
          window.scrollBy(0, distance);
        } else if (direction === 'up') {
          window.scrollBy(0, -distance);
        } else if (direction === 'left') {
          window.scrollBy(-distance, 0);
        } else if (direction === 'right') {
          window.scrollBy(distance, 0);
        }
      }
      
      if (waitAfter > 0) {
        await this.sleep(waitAfter);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 滚动到元素
  async scrollToElement(selector, options = {}) {
    const { 
      timeout = 5000, 
      block = 'center', 
      inline = 'center',
      smooth = true 
    } = options;
    
    try {
      const element = await this.findElement(selector, { timeout, visible: true });
      
      element.scrollIntoView({ 
        behavior: smooth ? 'smooth' : 'auto',
        block: block,
        inline: inline
      });
      
      await this.sleep(500);
      return { success: true, element: element };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 截图
  async screenshot(options = {}) {
    const { 
      format = 'png', 
      quality = 0.8, 
      fullPage = false 
    } = options;
    
    try {
      // 使用html2canvas库进行截图
      if (typeof html2canvas !== 'undefined') {
        const canvas = await html2canvas(document.body, {
          allowTaint: true,
          useCORS: true,
          scale: 1
        });
        
        const dataURL = canvas.toDataURL(`image/${format}`, quality);
        return { success: true, dataURL: dataURL };
      } else {
        // 使用Chrome API截图
        return await this.chromeScreenshot();
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // Chrome API截图
  async chromeScreenshot() {
    return new Promise((resolve) => {
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataURL) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve({ success: true, dataURL: dataURL });
        }
      });
    });
  }
  
  // ==================== 表单操作 ====================
  
  // 选择下拉框选项
  async selectOption(selector, value, options = {}) {
    const { timeout = 5000 } = options;
    
    try {
      const element = await this.findElement(selector, { timeout, visible: true });
      
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.sleep(300);
      
      this.highlightElement(element);
      
      // 设置值
      element.value = value;
      
      // 触发事件
      element.dispatchEvent(new Event('change', { bubbles: true }));
      
      return { success: true, element: element };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 勾选复选框
  async check(selector, options = {}) {
    const { timeout = 5000, checked = true } = options;
    
    try {
      const element = await this.findElement(selector, { timeout, visible: true });
      
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.sleep(300);
      
      this.highlightElement(element);
      
      if (element.checked !== checked) {
        element.click();
      }
      
      return { success: true, element: element };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 提交表单
  async submitForm(selector, options = {}) {
    const { timeout = 5000 } = options;
    
    try {
      const element = await this.findElement(selector, { timeout, visible: true });
      
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.sleep(300);
      
      this.highlightElement(element);
      
      // 触发表单提交
      element.dispatchEvent(new Event('submit', { bubbles: true }));
      
      return { success: true, element: element };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // ==================== 键盘操作 ====================
  
  // 按键
  async pressKey(key, options = {}) {
    const { 
      ctrlKey = false, 
      altKey = false, 
      shiftKey = false,
      target = document.body 
    } = options;
    
    try {
      const event = new KeyboardEvent('keydown', {
        key: key,
        ctrlKey: ctrlKey,
        altKey: altKey,
        shiftKey: shiftKey,
        bubbles: true
      });
      
      target.dispatchEvent(event);
      
      await this.sleep(100);
      
      const keyupEvent = new KeyboardEvent('keyup', {
        key: key,
        ctrlKey: ctrlKey,
        altKey: altKey,
        shiftKey: shiftKey,
        bubbles: true
      });
      
      target.dispatchEvent(keyupEvent);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // 快捷键
  async shortcut(keys, options = {}) {
    const { target = document.body } = options;
    
    try {
      const keyArray = keys.split('+');
      const ctrlKey = keyArray.includes('ctrl');
      const altKey = keyArray.includes('alt');
      const shiftKey = keyArray.includes('shift');
      const key = keyArray[keyArray.length - 1];
      
      return await this.pressKey(key, { ctrlKey, altKey, shiftKey, target });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  // ==================== 工具方法 ====================
  
  // 模拟点击
  simulateClick(element) {
    // 直接点击
    element.click();
    
    // 模拟鼠标事件
    setTimeout(() => {
      const events = ['mousedown', 'mouseup', 'click'];
      events.forEach(eventType => {
        const event = new MouseEvent(eventType, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: 1,
          clientX: element.getBoundingClientRect().left + element.offsetWidth / 2,
          clientY: element.getBoundingClientRect().top + element.offsetHeight / 2
        });
        element.dispatchEvent(event);
      });
    }, 50);
  }
  
  // 模拟输入
  simulateTyping(element, text) {
    element.focus();
    element.value = '';
    
    // 触发focus事件
    element.dispatchEvent(new Event('focus', { bubbles: true }));
    
    // 逐字符输入
    for (let i = 0; i < text.length; i++) {
      element.value = text.substring(0, i + 1);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('keydown', { bubbles: true }));
      element.dispatchEvent(new Event('keypress', { bubbles: true }));
      element.dispatchEvent(new Event('keyup', { bubbles: true }));
    }
    
    // 触发change和blur事件
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }
  
  // 高亮元素
  highlightElement(element) {
    const prevOutline = element.style.outline;
    element.style.outline = '2px solid #ff4d4f';
    
    setTimeout(() => {
      element.style.outline = prevOutline;
    }, 1000);
  }
  
  // 设置元素高亮器
  setupElementHighlighter() {
    // 鼠标悬停高亮
    document.addEventListener('mouseover', (event) => {
      if (this.isRecording) {
        event.target.style.outline = '1px dashed #1890ff';
      }
    });
    
    document.addEventListener('mouseout', (event) => {
      if (this.isRecording) {
        event.target.style.outline = '';
      }
    });
  }
  
  // 绑定事件
  bindEvents() {
    // 监听来自popup的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // 保持消息通道开放
    });
  }
  
  // 处理消息
  async handleMessage(request, sender, sendResponse) {
    const { action, data } = request;
    
    try {
      let result;
      
      switch (action) {
        case 'click':
          result = await this.click(data.selector, data.options);
          break;
        case 'type':
          result = await this.type(data.selector, data.text, data.options);
          break;
        case 'getText':
          result = await this.getText(data.selector, data.options);
          break;
        case 'scroll':
          result = await this.scroll(data.options);
          break;
        case 'waitForElement':
          result = await this.waitForElement(data.selector, data.options);
          break;
        case 'screenshot':
          result = await this.screenshot(data.options);
          break;
        case 'selectOption':
          result = await this.selectOption(data.selector, data.value, data.options);
          break;
        case 'check':
          result = await this.check(data.selector, data.options);
          break;
        case 'pressKey':
          result = await this.pressKey(data.key, data.options);
          break;
        case 'shortcut':
          result = await this.shortcut(data.keys, data.options);
          break;
        default:
          result = { success: false, error: '未知操作' };
      }
      
      sendResponse(result);
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
  
  // 睡眠
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 初始化自动化核心
const automation = new ChromeAutomation();
