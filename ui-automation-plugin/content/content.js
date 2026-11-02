// 必要注释：页面侧脚本，接收消息并执行操作

// 防止重复加载：如果已经加载过，直接返回
if (window.__UI_AUTOMATION_CONTENT_LOADED__) {
  console.warn('⚠️ Content script 已加载，跳过重复加载');
} else {
  window.__UI_AUTOMATION_CONTENT_LOADED__ = true;

const isVisible = (el) => {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
};

const queryAllWithText = (text) => {
  const lower = text.trim().toLowerCase();
  const result = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
  let node;
  while ((node = walker.nextNode())) {
    if (!node) continue;
    if (!isVisible(node)) continue;

    // 检查多种文本来源
    const textSources = [
      node.innerText,
      node.textContent,
      node.getAttribute('aria-label'),
      node.getAttribute('title'),
      node.getAttribute('data-text'),
      node.getAttribute('value')
    ];

    for (const source of textSources) {
      if (!source) continue;
      const t = source.trim().toLowerCase();
      if (t && t.includes(lower)) {
        result.push(node);
        break;
      }
    }
  }

  // 优先返回叶子节点（DOM depth最深、innerText最短），避免返回包含文本的父容器
  result.sort((a, b) => {
    // 优先可直接交互的标签
    const interactiveTags = new Set(['button', 'a', 'input', 'label', 'select', 'option', 'textarea']);
    const aInteractive = interactiveTags.has(a.tagName.toLowerCase()) ? 0 : 1;
    const bInteractive = interactiveTags.has(b.tagName.toLowerCase()) ? 0 : 1;
    if (aInteractive !== bInteractive) return aInteractive - bInteractive;
    // 再按 innerText 长度升序（文本越短越精确）
    const aLen = (a.innerText || a.textContent || '').trim().length;
    const bLen = (b.innerText || b.textContent || '').trim().length;
    return aLen - bLen;
  });

  return result;
};

const smoothScrollIntoView = (el) => {
  try {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  } catch (_) {
    el.scrollIntoView(true);
  }
};

const highlight = (el) => {
  if (!el) return;
  const prev = el.style.outline;
  el.style.outline = "2px solid #ff4d4f";
  el.setAttribute('data-uiap-highlighted', 'true');
  setTimeout(() => {
    el.style.outline = prev;
    el.removeAttribute('data-uiap-highlighted');
  }, 1200);
};

// 清除所有高亮样式
const clearAllHighlights = () => {
  const highlightedElements = document.querySelectorAll('[data-uiap-highlighted="true"]');
  highlightedElements.forEach(el => {
    el.style.outline = '';
    el.removeAttribute('data-uiap-highlighted');
  });
};

const clickByText = (text) => {
  // 使用文本匹配查找可点击元素（避免使用非标准的 :contains() 选择器）
  const candidates = queryAllWithText(text);

  // 优先精确匹配按钮/链接/role=button
  let target = candidates.find((n) =>
    n.tagName === 'BUTTON' ||
    n.tagName === 'A' ||
    n.getAttribute('role') === 'button' ||
    n.classList.contains('btn') ||
    n.classList.contains('light-btn')
  );

  // 降级：取文本最短的匹配元素（最精确）
  if (!target && candidates.length > 0) {
    target = candidates[0];
  }

  if (!target) return { ok: false, message: '未找到包含文本的按钮元素' };

  smoothScrollIntoView(target);
  highlight(target);
  
  // 尝试多种点击方式
  try {
    // 方式1：直接点击
    target.click();
    
    // 方式2：模拟完整的鼠标事件序列
    setTimeout(() => {
      const mouseEvents = [
        { type: 'mousedown', button: 0 },
        { type: 'mouseup', button: 0 },
        { type: 'click', button: 0 }
      ];
      
      mouseEvents.forEach(eventData => {
        const event = new MouseEvent(eventData.type, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: eventData.button,
          buttons: 1,
          clientX: target.getBoundingClientRect().left + target.offsetWidth / 2,
          clientY: target.getBoundingClientRect().top + target.offsetHeight / 2
        });
        target.dispatchEvent(event);
      });
    }, 50);
    
    // 方式3：如果是按钮或链接，尝试focus后回车
    if (target.tagName === 'BUTTON' || target.tagName === 'A' || target.getAttribute('role') === 'button') {
      setTimeout(() => {
        target.focus();
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true
        });
        target.dispatchEvent(enterEvent);
      }, 150);
    }
    
    // 方式4：尝试触发表单提交（如果是表单内的按钮）
    if (target.form) {
      setTimeout(() => {
        target.form.dispatchEvent(new Event('submit', { bubbles: true }));
      }, 200);
    }
    
    return { ok: true };
  } catch (e) {
    return { ok: false, message: "点击执行失败: " + e.message };
  }
};

// ===================== 输入工具（支持 React/Vue 受控组件）=====================

// 获取 React/Vue 内部 setter，绕过框架的 value 拦截
function getNativeSetter(el) {
  const proto = Object.getPrototypeOf(el);
  const nativeDescriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (nativeDescriptor && typeof nativeDescriptor.set === 'function') return nativeDescriptor.set;
  // 兜底：HTMLInputElement.prototype
  const inputProto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  return inputProto?.set || null;
}

const typeIntoSelector = (selector, value, selectorFallbacks, maxWait = 5000, _healStep = null) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const INTERVAL = 150;

    const attempt = async () => {
      try {
        let el = findElementWithFallbacks(selector, selectorFallbacks);

        if (!el) {
          if (Date.now() - startTime >= maxWait) {
            // ── AI 自愈 ──────────────────────────────────────────
            console.log('🤖 [AI自愈] 输入框未找到，尝试 AI 修复选择器:', selector);
            const healedSelector = await aiHealSelector(selector, selectorFallbacks, 'input');
            if (healedSelector) {
              el = findElementBySelector(healedSelector);
              if (el && isVisible(el)) {
                console.log('✅ [AI自愈] 找到输入框，新选择器:', healedSelector);
                notifyHealPersist(_healStep, healedSelector, selectorFallbacks);
                // 继续执行输入逻辑（fall through）
              }
            }
            if (!el) {
              return resolve({ ok: false, message: `输入框未找到（等待${maxWait}ms超时）: ${selector}` });
            }
          } else {
            return setTimeout(attempt, INTERVAL);
          }
        }

        smoothScrollIntoView(el);
        highlight(el);
        el.focus();

        // 清空：先用 native setter 触发 React 感知
        const nativeSetter = getNativeSetter(el);
        if (nativeSetter) {
          nativeSetter.call(el, '');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          nativeSetter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // 触发 keydown/keyup Enter（某些表单监听回车提交）
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));

        resolve({ ok: true });
      } catch (e) {
        resolve({ ok: false, message: '输入异常: ' + e.message });
      }
    };

    attempt();
  });
};

const scrollToText = (text) => {
  const candidates = queryAllWithText(text);
  const target = candidates[0];
  if (!target) return { ok: false, message: "未找到文本" };
  smoothScrollIntoView(target);
  highlight(target);
  return { ok: true };
};

const debugElements = () => {
  try {
    // 统计邮箱输入框
    const emailSelectors = [
      'input[type="email"]', 'input[name="email"]', 'input[name="username"]', 
      'input[name="account"]', 'input[autocomplete="email"]', 'input[autocomplete="username"]'
    ];
    let emailCount = 0;
    emailSelectors.forEach(selector => {
      emailCount += document.querySelectorAll(selector).length;
    });
    
    // 统计密码输入框
    const passwordSelectors = [
      'input[type="password"]', 'input[name="password"]', 'input[name="pwd"]',
      'input[autocomplete="current-password"]'
    ];
    let passwordCount = 0;
    passwordSelectors.forEach(selector => {
      passwordCount += document.querySelectorAll(selector).length;
    });
    
    // 统计按钮
    const buttonSelectors = ['button', 'input[type="submit"]', 'input[type="button"]', '[role="button"]'];
    let buttonCount = 0;
    buttonSelectors.forEach(selector => {
      buttonCount += document.querySelectorAll(selector).length;
    });
    
    return { 
      ok: true, 
      emailCount, 
      passwordCount, 
      buttonCount,
      pageTitle: document.title,
      url: window.location.href
    };
  } catch (e) {
    return { ok: false, message: "调试失败: " + e.message };
  }
};

// 页面变化检测
let lastPageState = null;

const checkPageChange = () => {
  try {
    const currentState = {
      url: window.location.href,
      title: document.title,
      loginFormExists: document.querySelector('form') !== null,
      loginButtonExists: document.querySelector('button[type="submit"]') !== null || 
                        document.querySelector('input[type="submit"]') !== null
    };
    
    if (!lastPageState) {
      lastPageState = currentState;
      return { ok: true, changed: false };
    }
    
    const changed = (
      currentState.url !== lastPageState.url ||
      currentState.title !== lastPageState.title ||
      currentState.loginFormExists !== lastPageState.loginFormExists ||
      currentState.loginButtonExists !== lastPageState.loginButtonExists
    );
    
    if (changed) {
      lastPageState = currentState;
    }
    
    return { ok: true, changed };
  } catch (e) {
    return { ok: false, message: "页面检测失败: " + e.message };
  }
};

const checkPageErrors = () => {
  try {
    const errors = [];
    
    // 检查常见的错误信息（更精确的检测）
    const errorSelectors = [
      '.error:not([style*="display: none"])', 
      '.alert:not([style*="display: none"])', 
      '.warning:not([style*="display: none"])', 
      '.danger:not([style*="display: none"])',
      '[class*="error"]:not([style*="display: none"])', 
      '[class*="alert"]:not([style*="display: none"])', 
      '[class*="warning"]:not([style*="display: none"])',
      '.message:not([style*="display: none"])', 
      '.notice:not([style*="display: none"])', 
      '.tip:not([style*="display: none"])'
    ];
    
    errorSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        const style = window.getComputedStyle(el);
        const elementVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        const hasContent = el.offsetWidth > 0 && el.offsetHeight > 0;
        
        if (elementVisible && hasContent) {
          const text = el.innerText?.trim();
          if (text && text.length > 0 && text.length < 200) {
            // 过滤掉一些常见的非错误文本
            const ignoreTexts = ['提示', '提示信息', '帮助', '说明', '注意', '温馨提示'];
            if (!ignoreTexts.some(ignore => text.includes(ignore))) {
              errors.push(text);
            }
          }
        }
      });
    });
    
    // 检查输入框的验证状态
    const inputs = document.querySelectorAll('input[type="email"], input[type="password"]');
    inputs.forEach(input => {
      if (input.validationMessage) {
        errors.push(`输入框验证: ${input.validationMessage}`);
      }
      if (input.classList.contains('error') || input.classList.contains('invalid')) {
        errors.push(`输入框错误状态: ${input.placeholder || input.name}`);
      }
    });
    
    // 检查是否有验证码相关元素（更精确的检测）
    const captchaElements = document.querySelectorAll(
      '[class*="captcha"]:not([style*="display: none"]), ' +
      '[class*="verify"]:not([style*="display: none"]), ' +
      '[class*="code"]:not([style*="display: none"]), ' +
      'iframe[src*="captcha"], ' +
      'iframe[src*="recaptcha"], ' +
      '.g-recaptcha, ' +
      '[data-sitekey]'
    );
    
    // 检查验证码元素是否可见且包含实际内容
    let hasVisibleCaptcha = false;
    captchaElements.forEach(el => {
      const style = window.getComputedStyle(el);
      const elementVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      const hasContent = el.offsetWidth > 0 && el.offsetHeight > 0;
      if (elementVisible && hasContent) {
        hasVisibleCaptcha = true;
      }
    });
    
    if (hasVisibleCaptcha) {
      errors.push('页面可能需要验证码');
    }
    
    // 检查是否有加载状态
    const loadingElements = document.querySelectorAll('[class*="loading"], [class*="spinner"]');
    if (loadingElements.length > 0) {
      errors.push('页面正在加载中...');
    }
    
    return { ok: true, errors: [...new Set(errors)] };
  } catch (e) {
    return { ok: false, message: "错误检查失败: " + e.message };
  }
};

const inspectButton = (text) => {
  try {
    const candidates = queryAllWithText(text);
    if (candidates.length === 0) {
      return { ok: false, message: "未找到包含文本的元素" };
    }
    
    const target = candidates[0];
    const details = {
      tagName: target.tagName,
      className: target.className,
      id: target.id,
      innerText: target.innerText,
      textContent: target.textContent,
      ariaLabel: target.getAttribute('aria-label'),
      title: target.getAttribute('title'),
      disabled: target.disabled,
      type: target.type,
      role: target.getAttribute('role'),
      tabIndex: target.tabIndex,
      isVisible: isVisible(target),
      rect: target.getBoundingClientRect(),
      computedStyle: {
        display: window.getComputedStyle(target).display,
        visibility: window.getComputedStyle(target).visibility,
        opacity: window.getComputedStyle(target).opacity
      }
    };
    
    return { ok: true, details: JSON.stringify(details, null, 2) };
  } catch (e) {
    return { ok: false, message: "按钮检查失败: " + e.message };
  }
};

// ===================== 元素查找工具 =====================

// 通过选择器查找元素（支持 text="..." 语法）
function findElementBySelector(selector) {
  if (!selector) return null;
  const textMatch = selector.match(/^text="(.+)"$/);
  if (textMatch) {
    const text = textMatch[1];
    const candidates = queryAllWithText(text);
    if (!candidates.length) return null;
    // 优先：叶子按钮/链接/role=button，然后文本最短的匹配（最精确）
    const clickable = candidates.find(el =>
      el.tagName === 'BUTTON' || el.tagName === 'A' ||
      el.getAttribute('role') === 'button' ||
      el.onclick != null || el.getAttribute('onclick') ||
      window.getComputedStyle(el).cursor === 'pointer'
    );
    return clickable || candidates[0];
  }
  try {
    return document.querySelector(selector);
  } catch (_) {
    return null;
  }
}

// 带 fallback 链的元素查找（依次尝试 selectorFallbacks）
function findElementWithFallbacks(selector, selectorFallbacks) {
  let el = findElementBySelector(selector);
  if (el && isVisible(el)) return el;

  if (Array.isArray(selectorFallbacks)) {
    for (const fb of selectorFallbacks) {
      if (fb === selector) continue;
      el = findElementBySelector(fb);
      if (el && isVisible(el)) return el;
    }
  }
  return null;
}

// ===================== AI 自愈 =====================

/**
 * 提取目标选择器附近的 DOM 上下文（≤3000字符），用于发给 AI 推断新选择器。
 * 策略：先尝试 body 内最近的 form / section / main，再整个 body 截断。
 */
function getDomContext() {
  try {
    const root = document.querySelector('main, [role="main"], form, section, #app, #root, body');
    const html = root ? root.innerHTML : document.body.innerHTML;
    // 去掉 script/style 内容，保留结构
    return html.replace(/<script[\s\S]*?<\/script>/gi, '')
               .replace(/<style[\s\S]*?<\/style>/gi, '')
               .replace(/\s{2,}/g, ' ')
               .slice(0, 3000);
  } catch (_) {
    return '';
  }
}

/**
 * 调用 Flask AI 自愈接口，返回推断出的新选择器（失败时返回空字符串）。
 */
async function aiHealSelector(selector, selectorFallbacks, stepType) {
  try {
    const SERVER_URL = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.SERVER_URL)
      ? APP_CONFIG.SERVER_URL
      : 'http://localhost:5001';

    const resp = await fetch(`${SERVER_URL}/api/ai/heal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selector,
        selectorFallbacks: selectorFallbacks || [],
        stepType,
        pageUrl: window.location.href,
        domContext: getDomContext()
      })
    });

    if (!resp.ok) return '';
    const data = await resp.json();
    return (data.ok && data.selector) ? data.selector : '';
  } catch (_) {
    return '';
  }
}

/**
 * 自愈成功后，通知 background 把新选择器落库。
 * step 对象需含 caseId / stepIndex 字段（回放时由 stepExecutors 注入）。
 */
function notifyHealPersist(step, newSelector, newFallbacks) {
  if (!step || !step.caseId || step.stepIndex == null) return;
  try {
    chrome.runtime.sendMessage({
      type: 'aiHealPersist',
      caseId: step.caseId,
      stepIndex: step.stepIndex,
      selector: newSelector,
      selectorFallbacks: newFallbacks || []
    });
  } catch (_) {}
}

// 真实点击（修复时序：同步返回前完成全部点击事件）
function performClick(target) {
  const rect = target.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const opts = {
    bubbles: true, cancelable: true, view: window,
    button: 0, buttons: 1, clientX: centerX, clientY: centerY
  };

  // 按正确顺序依次触发
  target.dispatchEvent(new MouseEvent('mouseenter', opts));
  target.dispatchEvent(new MouseEvent('mouseover', opts));
  target.dispatchEvent(new MouseEvent('mousedown', opts));
  target.dispatchEvent(new MouseEvent('mouseup', opts));
  target.dispatchEvent(new MouseEvent('click', opts));

  // 对 <button>/<a> 同时调用 .click()（与上面事件互不干扰）
  if (typeof target.click === 'function') {
    try { target.click(); } catch (_) {}
  }
}

// ===================== 主点击函数（重写，修复时序 bug）=====================
const clickBySelector = (selector, selectorFallbacks, maxWait = 5000, _healStep = null) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const INTERVAL = 150;

    const attempt = async () => {
      try {
        let target = findElementWithFallbacks(selector, selectorFallbacks);

        if (!target) {
          if (Date.now() - startTime >= maxWait) {
            // ── AI 自愈 ──────────────────────────────────────────
            console.log('🤖 [AI自愈] 元素未找到，尝试 AI 修复选择器:', selector);
            const healedSelector = await aiHealSelector(selector, selectorFallbacks, 'click');
            if (healedSelector) {
              target = findElementBySelector(healedSelector);
              if (target && isVisible(target)) {
                console.log('✅ [AI自愈] 找到元素，新选择器:', healedSelector);
                smoothScrollIntoView(target);
                highlight(target);
                performClick(target);
                notifyHealPersist(_healStep, healedSelector, selectorFallbacks);
                return resolve({ ok: true, healed: true, healedSelector, message: `AI自愈成功: ${healedSelector}` });
              }
            }
            // ────────────────────────────────────────────────────
            return resolve({ ok: false, message: `元素未找到（等待${maxWait}ms超时）: ${selector}` });
          }
          return setTimeout(attempt, INTERVAL);
        }

        smoothScrollIntoView(target);
        highlight(target);
        performClick(target);
        resolve({ ok: true, message: `已点击: ${target.tagName}` });
      } catch (e) {
        resolve({ ok: false, message: '点击异常: ' + e.message });
      }
    };

    attempt();
  });
};

// 录制功能相关变量
let isRecording = false;
let recordedSteps = [];
let _lastRecord = { time: 0, selector: '', type: '' };
const _suppressMap = new Map();
// 输入防抖相关：用于合并连续输入为一条步骤
const _inputDebounceTimers = new Map(); // selector -> timer
const _inputPendingSteps = new Map(); // selector -> step index

// ── AI 增强录制：截图 + Vision Agent 描述 ──
const SERVER_URL = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.SERVER_URL)
  ? APP_CONFIG.SERVER_URL
  : 'http://localhost:5001';

let _aiEnhanceEnabled = true; // 可通过消息开关

/** 截取当前可视区域为 base64 PNG */
function captureViewport() {
  return new Promise((resolve) => {
    try {
      // 使用 chrome.tabs 截图需要通过 background 转发
      chrome.runtime.sendMessage({ type: 'captureScreenshot' }, (response) => {
        if (response && response.dataUrl) {
          // 去掉 data:image/png;base64, 前缀
          const base64 = response.dataUrl.replace(/^data:image\/\w+;base64,/, '');
          resolve(base64);
        } else {
          resolve(null);
        }
      });
    } catch (e) {
      console.warn('截图失败:', e);
      resolve(null);
    }
  });
}

/** 调用后端 Vision Agent 获取元素描述 */
async function getAiDescription(imageBase64) {
  if (!_aiEnhanceEnabled || !imageBase64) return '';
  try {
    const resp = await fetch(`${SERVER_URL}/api/recording/describe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64 }),
    });
    if (!resp.ok) return '';
    const data = await resp.json();
    return data.description || '';
  } catch (e) {
    console.warn('AI 描述失败:', e);
    return '';
  }
}

/** 上传截图到后端保存 */
async function uploadScreenshot(imageBase64, caseId, stepIndex, phase) {
  if (!imageBase64) return null;
  try {
    const resp = await fetch(`${SERVER_URL}/api/recording/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageBase64,
        case_id: caseId,
        step_index: stepIndex,
        phase: phase || 'record',
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.snapshot_id || null;
  } catch (e) {
    console.warn('截图上传失败:', e);
    return null;
  }
}

/** 增强录制步骤：添加截图和 AI 描述 */
async function enhanceStepWithAi(step, caseId) {
  if (!_aiEnhanceEnabled) return;
  try {
    const screenshot = await captureViewport();
    if (screenshot) {
      step.screenshotBase64 = screenshot;
      // 异步获取 AI 描述（不阻塞录制流程）
      getAiDescription(screenshot).then(desc => {
        if (desc) {
          step.visualDescription = desc;
          console.log('🤖 AI 描述:', desc);
          // 通知 popup 更新
          try {
            chrome.runtime.sendMessage({
              action: 'stepEnhanced',
              stepIndex: recordedSteps.indexOf(step),
              visualDescription: desc,
            });
          } catch (_) {}
        }
      });
      // 异步上传截图到后端
      uploadScreenshot(screenshot, caseId, recordedSteps.length - 1, 'record');
    }
  } catch (e) {
    console.warn('步骤增强失败:', e);
  }
}

// 数据持久化（使用chrome.storage.local保存，避免页面跳转丢失）
const STORAGE_KEY = 'uiap_steps';
const RECORDING_STATE_KEY = 'uiap_recording_state'; // 录制状态key

// 检查扩展上下文是否有效
function isExtensionContextValid() {
  try {
    // 尝试访问 chrome.runtime.id，如果上下文失效会抛出错误
    return chrome.runtime && chrome.runtime.id !== undefined;
  } catch (e) {
    return false;
  }
}

// 保存录制数据到存储（完整数组）
async function saveRecordedSteps() {
  // 检查扩展上下文是否有效
  if (!isExtensionContextValid()) {
    console.warn('⚠️ 扩展上下文已失效（扩展可能被重新加载），跳过保存');
    // 使用 localStorage 作为临时备份（仅限当前页面）
    try {
      localStorage.setItem('uiap_steps_backup', JSON.stringify(recordedSteps));
      localStorage.setItem('uiap_recording_state_backup', String(isRecording));
      console.log('💾 已保存到 localStorage 作为备份');
    } catch (e) {
      console.warn('⚠️ localStorage 保存也失败:', e);
    }
    return;
  }
  
  try {
    // 检查数据大小
    const dataSize = JSON.stringify(recordedSteps).length;
    const maxSize = 8 * 1024 * 1024; // 8MB (chrome.storage.local 限制)
    
    if (dataSize > maxSize) {
      console.warn('⚠️ 录制步骤数据过大:', dataSize, 'bytes，超过限制:', maxSize, 'bytes');
      // 尝试只保存最近的步骤
      const maxSteps = 1000;
      if (recordedSteps.length > maxSteps) {
        const recentSteps = recordedSteps.slice(-maxSteps);
        console.warn('⚠️ 只保存最近', maxSteps, '个步骤');
        recordedSteps = recentSteps;
      }
    }
    
    // 保存步骤数据
    if (recordedSteps.length > 0) {
      try {
        await chrome.storage.local.set({ [STORAGE_KEY]: recordedSteps });
        console.log('💾 已保存录制步骤到storage，数量:', recordedSteps.length, '大小:', dataSize, 'bytes');
      } catch (storageError) {
        // 检查是否是扩展上下文失效
        if (storageError.message && storageError.message.includes('Extension context invalidated')) {
          console.warn('⚠️ 扩展上下文已失效，使用 localStorage 备份');
          try {
            localStorage.setItem('uiap_steps_backup', JSON.stringify(recordedSteps));
            console.log('💾 已保存到 localStorage 作为备份');
          } catch (e) {
            console.warn('⚠️ localStorage 保存失败:', e);
          }
          return;
        }
        console.error('❌ chrome.storage.local.set 失败:', storageError);
        // 检查是否是配额问题
        if (storageError.message && storageError.message.includes('QUOTA_BYTES')) {
          console.error('❌ 存储配额已满，请清理一些数据');
        }
        throw storageError;
      }
    }
    
    // 保存录制状态
    try {
      await chrome.storage.local.set({ [RECORDING_STATE_KEY]: isRecording });
    } catch (stateError) {
      // 检查是否是扩展上下文失效
      if (stateError.message && stateError.message.includes('Extension context invalidated')) {
        console.warn('⚠️ 扩展上下文已失效，跳过状态保存');
        return;
      }
      console.warn('⚠️ 保存录制状态失败:', stateError);
    }
    
    // 同时通知后台脚本持久化
    try {
      await chrome.runtime.sendMessage({ 
        type: 'persistSteps', 
        steps: recordedSteps 
      });
    } catch (e) {
      // 检查是否是扩展上下文失效
      if (e.message && e.message.includes('Extension context invalidated')) {
        console.warn('⚠️ 扩展上下文已失效，跳过后台持久化');
        return;
      }
      console.warn('⚠️ 后台持久化失败，已使用本地storage:', e.message || e);
    }
  } catch (error) {
    // 检查是否是扩展上下文失效
    if (error.message && error.message.includes('Extension context invalidated')) {
      console.warn('⚠️ 扩展上下文已失效，无法保存录制步骤');
      // 使用 localStorage 作为临时备份
      try {
        localStorage.setItem('uiap_steps_backup', JSON.stringify(recordedSteps));
        localStorage.setItem('uiap_recording_state_backup', String(isRecording));
        console.log('💾 已保存到 localStorage 作为备份');
      } catch (e) {
        console.warn('⚠️ localStorage 保存也失败:', e);
      }
      return;
    }
    
    console.error('❌ 保存录制步骤失败:', error);
    console.error('❌ 错误详情:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      stepsCount: recordedSteps.length,
      stepsSize: JSON.stringify(recordedSteps).length
    });
    
    // 尝试降级保存：只保存基本信息
    try {
      const simplifiedSteps = recordedSteps.map(step => ({
        type: step.type,
        selector: step.selector,
        value: step.value,
        text: step.text,
        timestamp: step.timestamp
      }));
      await chrome.storage.local.set({ [STORAGE_KEY]: simplifiedSteps });
      console.log('✅ 已保存简化版步骤数据');
    } catch (fallbackError) {
      // 检查是否是扩展上下文失效
      if (fallbackError.message && fallbackError.message.includes('Extension context invalidated')) {
        console.warn('⚠️ 扩展上下文已失效，无法保存');
        return;
      }
      console.error('❌ 降级保存也失败:', fallbackError);
    }
  }
}

// 从存储加载录制数据
async function loadRecordedSteps() {
  try {
    // 优先从后台脚本获取
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: 'loadPersistedSteps' 
      });
      if (response && response.ok && Array.isArray(response.steps)) {
        recordedSteps = response.steps;
        console.log('📥 从后台恢复录制步骤:', recordedSteps.length);
        return recordedSteps;
      }
    } catch (e) {
      console.warn('从后台加载失败，尝试本地storage:', e);
    }
    
    // fallback到本地storage
    const data = await chrome.storage.local.get(STORAGE_KEY);
    if (data[STORAGE_KEY] && Array.isArray(data[STORAGE_KEY])) {
      recordedSteps = data[STORAGE_KEY];
      console.log('📥 从本地storage恢复录制步骤:', recordedSteps.length);
      return recordedSteps;
    }
    
    console.log('ℹ️ 本地storage中无录制步骤');
    return [];
  } catch (error) {
    console.error('❌ 加载录制步骤失败:', error);
    return [];
  }
}

// 通知 popup 数据已加载
function notifyPopupDataLoaded() {
  console.log('📊 录制数据已加载，等待 popup 请求:', recordedSteps.length, '个步骤');
}

// 添加页面加载检测
console.log('🎯 Content script 已加载到页面:', window.location.href);
console.log('📄 页面标题:', document.title);
console.log('⏰ 加载时间:', new Date().toLocaleTimeString());

// 添加更明显的检测标记
if (document.body) {
  document.body.setAttribute('data-automation-plugin-loaded', 'true');
}
console.log('✅ 插件标记已添加到页面');

// 恢复录制状态（自动重新开始录制）
async function restoreRecordingState() {
  try {
    // 从storage恢复录制状态
    const data = await chrome.storage.local.get([STORAGE_KEY, RECORDING_STATE_KEY]);
    const wasRecording = data[RECORDING_STATE_KEY] === true;
    
    // 恢复步骤数据（只有在当前没有步骤时才恢复，避免覆盖用户清空的操作）
    if (data[STORAGE_KEY] && Array.isArray(data[STORAGE_KEY]) && data[STORAGE_KEY].length > 0) {
      // 如果当前步骤为空，才恢复（避免覆盖用户清空的操作）
      if (recordedSteps.length === 0) {
        recordedSteps = data[STORAGE_KEY];
        console.log('📥 已恢复', recordedSteps.length, '个录制步骤');
      } else {
        console.log('ℹ️ 当前已有步骤，不恢复storage中的步骤（可能是用户清空后重新录制）');
      }
    }
    
    // 如果之前在录制，自动恢复录制状态
    if (wasRecording) {
      console.log('🔄 检测到之前正在录制，自动恢复录制状态...');
      
      // 延迟一点，确保页面完全加载
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 重新添加事件监听器
      document.removeEventListener('click', recordClick, true);
      document.removeEventListener('input', recordInput, true);
      document.removeEventListener('change', recordChange, true);
      document.removeEventListener('submit', recordSubmit, true);
      
      document.addEventListener('click', recordClick, true);
      document.addEventListener('input', recordInput, true);
      document.addEventListener('change', recordChange, true);
      document.addEventListener('submit', recordSubmit, true);
      
      isRecording = true;
      console.log('✅ 录制状态已自动恢复，事件监听器已重新添加');
      
      // 通知popup更新状态
      try {
        chrome.runtime.sendMessage({ 
          action: 'recordingRestored',
          isRecording: true,
          stepCount: recordedSteps.length
        });
      } catch (e) {
        console.warn('通知popup失败:', e);
      }
    }
  } catch (error) {
    console.error('❌ 恢复录制状态失败:', error);
  }
}

// 页面加载时自动恢复录制状态
(async () => {
  // 延迟一点恢复，确保页面完全加载
  await new Promise(resolve => setTimeout(resolve, 100));
  await restoreRecordingState();
  
  // 检查是否有正在执行的步骤（页面跳转后继续执行）
  try {
    const data = await chrome.storage.local.get('uiap_execution_state');
    if (data.uiap_execution_state && data.uiap_execution_state.isExecuting) {
      console.log('🔄 检测到正在执行，等待页面完全加载后通知background继续');
      // 等待页面完全加载
      if (document.readyState !== 'complete') {
        await new Promise(resolve => {
          if (document.readyState === 'complete') {
            resolve();
          } else {
            window.addEventListener('load', resolve, { once: true });
          }
        });
      }
      // 再等待一下，确保动态内容加载完成
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('✅ 页面加载完成，通知background继续执行');
      // 通知background继续执行
      chrome.runtime.sendMessage({
        type: 'continueExecution'
      }).catch(e => {
        console.warn('通知background继续执行失败:', e);
      });
    }
  } catch (e) {
    console.warn('检查执行状态失败:', e);
  }
})();

// 页面卸载时保存数据（同步保存，确保不丢失）
window.addEventListener('beforeunload', () => {
  if (recordedSteps.length > 0) {
    // 使用同步方式保存，确保在页面卸载前完成
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: recordedSteps }, () => {
        console.log('💾 页面卸载前已同步保存录制数据:', recordedSteps.length);
      });
      // 同时通知后台
      try {
        chrome.runtime.sendMessage({ 
          type: 'persistSteps', 
          steps: recordedSteps 
        }, () => {});
      } catch (_) {}
    } catch (e) {
      console.error('保存失败:', e);
    }
  }
});

// 页面隐藏时保存数据
document.addEventListener('visibilitychange', () => {
  if (document.hidden && recordedSteps.length > 0) {
    saveRecordedSteps();
  }
});

// 监听页面导航（SPA应用）
let lastUrl = window.location.href;
const checkUrlChange = () => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    console.log('🔄 检测到页面URL变化:', lastUrl, '->', currentUrl);
    lastUrl = currentUrl;
    
    // URL变化时保存步骤和状态
    if (recordedSteps.length > 0 || isRecording) {
      saveRecordedSteps();
    }
    
    // 如果正在录制，确保事件监听器仍然有效（SPA跳转时可能需要重新绑定）
    if (isRecording) {
      console.log('🔄 URL变化时重新确保事件监听器有效');
      // 延迟一点，等待新页面内容加载
      setTimeout(() => {
        if (isRecording) {
          // 重新添加事件监听器（移除旧的，添加新的）
          document.removeEventListener('click', recordClick, true);
          document.removeEventListener('input', recordInput, true);
          document.removeEventListener('change', recordChange, true);
          document.removeEventListener('submit', recordSubmit, true);
          
          document.addEventListener('click', recordClick, true);
          document.addEventListener('input', recordInput, true);
          document.addEventListener('change', recordChange, true);
          document.addEventListener('submit', recordSubmit, true);
          
          console.log('✅ URL变化后事件监听器已重新绑定');
        }
      }, 300);
    }
  }
};
// 定期检查URL变化（用于SPA应用）
setInterval(checkUrlChange, 500);
// 监听popstate事件（浏览器前进后退）
window.addEventListener('popstate', () => {
  if (recordedSteps.length > 0) {
    saveRecordedSteps();
  }
});

// 处理 Back/Forward Cache (bfcache) 问题
// 当页面从bfcache恢复时，content script需要重新初始化
window.addEventListener('pageshow', (event) => {
  console.log('📄 pageshow事件触发, persisted:', event.persisted);
  
  // 如果页面是从bfcache恢复的，或者普通页面加载
  (async () => {
    // 延迟一点，确保页面完全恢复
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // 自动恢复录制状态
    await restoreRecordingState();
  })();
});

// 页面即将进入bfcache时保存数据
window.addEventListener('pagehide', (event) => {
  if (event.persisted) {
    console.log('💾 页面即将进入bfcache，保存数据');
    if (recordedSteps.length > 0) {
      // 使用同步方式保存
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: recordedSteps }, () => {
          console.log('💾 bfcache前已保存录制数据:', recordedSteps.length);
        });
      } catch (e) {
        console.error('bfcache前保存失败:', e);
      }
    }
  }
});

// 录制功能：开始录制
function startRecording() {
  try {
    console.log('🎬 开始录制用户操作');
    console.log('📊 当前录制状态:', isRecording);
    console.log('📊 当前录制步骤数:', recordedSteps.length);
    console.log('📄 当前页面:', window.location.href);
    console.log('📄 页面标题:', document.title);
    
    // 如果已经在录制中，直接返回成功
    if (isRecording) {
      console.log('⚠️ 已经在录制中，直接返回成功');
      return { ok: true, message: "已在录制中" };
    }
    
    // 检查函数是否存在
    console.log('🔍 检查函数定义:');
    console.log('- recordClick:', typeof recordClick);
    console.log('- recordInput:', typeof recordInput);
    console.log('- recordChange:', typeof recordChange);
    console.log('- recordSubmit:', typeof recordSubmit);
    console.log('- generateSelector:', typeof generateSelector);
    console.log('- highlight:', typeof highlight);
    
    if (typeof recordClick !== 'function') {
      console.error('❌ recordClick 函数未定义');
      return { ok: false, message: "recordClick 函数未定义" };
    }
    if (typeof recordInput !== 'function') {
      console.error('❌ recordInput 函数未定义');
      return { ok: false, message: "recordInput 函数未定义" };
    }
    if (typeof recordChange !== 'function') {
      console.error('❌ recordChange 函数未定义');
      return { ok: false, message: "recordChange 函数未定义" };
    }
    if (typeof recordSubmit !== 'function') {
      console.error('❌ recordSubmit 函数未定义');
      return { ok: false, message: "recordSubmit 函数未定义" };
    }
    if (typeof generateSelector !== 'function') {
      console.error('❌ generateSelector 函数未定义');
      return { ok: false, message: "generateSelector 函数未定义" };
    }
    
    // 先移除可能已存在的事件监听器（避免重复添加）
    console.log('🧹 清理可能存在的旧事件监听器...');
    document.removeEventListener('click', recordClick, true);
    document.removeEventListener('input', recordInput, true);
    document.removeEventListener('change', recordChange, true);
    document.removeEventListener('submit', recordSubmit, true);
    
    // 追加录制模式：不清空已存在的步骤
    console.log('🧩 采用追加录制模式，保留已有步骤:', recordedSteps.length);
    
    // 添加事件监听器
    console.log('📝 添加事件监听器...');
    document.addEventListener('click', recordClick, true);
    document.addEventListener('input', recordInput, true);
    document.addEventListener('change', recordChange, true);
    document.addEventListener('submit', recordSubmit, true);
    
    isRecording = true;
    console.log('✅ 事件监听器已添加，录制状态:', isRecording);
    console.log('✅ 录制功能已启动，等待用户操作...');
    
    return { ok: true, message: "开始录制" };
  } catch (error) {
    console.error('❌ 开始录制失败:', error);
    console.error('错误堆栈:', error.stack);
    isRecording = false;
    return { ok: false, message: "开始录制失败: " + error.message };
  }
}

// 录制功能：停止录制
function stopRecording() {
  console.log('🛑 停止录制用户操作');
  console.log('📊 停止前录制状态:', isRecording);
  console.log('📊 停止前录制步骤数:', recordedSteps.length);
  
  if (!isRecording) {
    console.log('⚠️ 当前未在录制中');
    return { ok: true, message: "未在录制中", steps: recordedSteps };
  }
  
  isRecording = false;
  
  // 移除事件监听器
  document.removeEventListener('click', recordClick, true);
  document.removeEventListener('input', recordInput, true);
  document.removeEventListener('change', recordChange, true);
  document.removeEventListener('submit', recordSubmit, true);
  
  // 清除所有高亮样式
  if (typeof clearAllHighlights === 'function') {
    clearAllHighlights();
  }
  
  // 保存最终步骤和状态
  if (recordedSteps.length > 0) {
    saveRecordedSteps();
  }
  
  // 清除录制状态（无论是否有步骤都要清除）
  chrome.storage.local.set({ [RECORDING_STATE_KEY]: false });
  
  console.log('✅ 录制已停止，最终步骤数:', recordedSteps.length);
  return { ok: true, message: "停止录制", steps: recordedSteps };
}

// 录制功能：清空录制
function clearRecording() {
  console.log('🗑️ 清空录制步骤');
  recordedSteps = [];
  isRecording = false; // 清空时也重置录制状态
  
  // 清理输入防抖定时器
  _inputDebounceTimers.forEach((timer) => clearTimeout(timer));
  _inputDebounceTimers.clear();
  _inputPendingSteps.clear();
  
  // 移除事件监听器
  document.removeEventListener('click', recordClick, true);
  document.removeEventListener('input', recordInput, true);
  document.removeEventListener('change', recordChange, true);
  document.removeEventListener('submit', recordSubmit, true);
  
  // 清除所有高亮样式
  if (typeof clearAllHighlights === 'function') {
    clearAllHighlights();
  }
  
  // 清除storage中的状态
  chrome.storage.local.set({ 
    [STORAGE_KEY]: [],
    [RECORDING_STATE_KEY]: false 
  });
  
  // 同时清除background中的持久化数据
  try {
    chrome.runtime.sendMessage({ 
      type: 'clearPersistedSteps' 
    }).catch(_ => {});
  } catch (_) {}
  
  console.log('✅ 录制步骤已清空，录制状态已重置');
  return { ok: true, message: "清空录制" };
}

// 录制点击事件
function recordClick(event) {
  try {
    console.log('🖱️ 点击事件触发，录制状态:', isRecording);
    
    if (!isRecording) {
      console.log('❌ 录制未激活，忽略点击事件');
      return;
    }
    
    console.log('🖱️ 检测到点击事件，开始录制');
    const target = event.target;
    console.log('🎯 点击目标:', target);
    console.log('🏷️ 标签名:', target.tagName);
    console.log('📝 文本内容:', target.innerText || target.textContent);
    
    const selector = generateSelector(target);
    // 针对开关/复选框：直接记录为 toggle，避免后续多条重复
    if ((target.type === 'checkbox') || target.getAttribute('role') === 'switch' || target.hasAttribute('aria-checked')) {
      const targetState = target.type === 'checkbox' ? !!target.checked : (String(target.getAttribute('aria-checked')) !== 'false');
      const step = {
        type: 'toggle',
        selector,
        targetState,
        timestamp: Date.now(),
        tagName: target.tagName
      };
      // 防抖/去重：短时间对同一元素的重复记录丢弃
      if (step.timestamp - _lastRecord.time < 250 && _lastRecord.selector === selector && _lastRecord.type === step.type) {
        return;
      }
      _lastRecord = { time: step.timestamp, selector, type: step.type };
      _suppressMap.set(selector, step.timestamp + 350); // 抑制后续 input/change
      recordedSteps.push(step);
      console.log('录制开关/复选框切换:', step);
      
      // 推送到侧边栏
      try { chrome.runtime.sendMessage({ action: 'stepRecorded', step }); } catch (_) {}
      
      // 保存完整的步骤数组
      saveRecordedSteps();
      
      if (typeof highlight === 'function') highlight(target);
      return;
    }
    
    const directText = getDirectText(target) || target.innerText?.trim() || '';
    const step = {
      type: 'click',
      selector,
      selectorFallbacks: generateSelectorFallbacks(target),
      text: directText,
      timestamp: Date.now(),
      tagName: target.tagName,
      className: target.className,
      id: target.id
    };
    if (step.timestamp - _lastRecord.time < 250 && _lastRecord.selector === selector && _lastRecord.type === step.type) {
      return;
    }
    _lastRecord = { time: step.timestamp, selector, type: step.type };
    
    recordedSteps.push(step);
    console.log('✅ 录制点击成功:', step);
    console.log('📊 当前录制步骤数:', recordedSteps.length);

    // AI 增强：截图 + Vision Agent 描述
    enhanceStepWithAi(step);

    // 推送到侧边栏，实时更新步骤列表
    try { chrome.runtime.sendMessage({ action: 'stepRecorded', step }); } catch (_) {}

    // 保存完整的步骤数组（避免重复追加）
    saveRecordedSteps();

    // 高亮显示被点击的元素
    if (typeof highlight === 'function') {
      highlight(target);
    } else {
      console.warn('⚠️ highlight 函数不存在');
    }
  } catch (error) {
    console.error('❌ 录制点击事件失败:', error);
  }
}

// 检测复选框点击
function detectCheckboxClick(target) {
  const checkboxInfo = {};
  
  // 检查是否是复选框标签
  if (target.tagName === 'SPAN' && target.classList.contains('label-check')) {
    // 查找关联的复选框
    const checkbox = document.querySelector('#policy');
    if (checkbox && checkbox.type === 'checkbox') {
      checkboxInfo.isCheckboxLabel = true;
      checkboxInfo.checkboxSelector = '#policy';
      checkboxInfo.checkboxId = checkbox.id;
      checkboxInfo.currentState = checkbox.checked;
      console.log('🔍 检测到复选框标签点击，关联复选框:', checkbox);
    }
  }
  
  // 检查是否直接点击了复选框
  if (target.type === 'checkbox') {
    checkboxInfo.isCheckbox = true;
    checkboxInfo.currentState = target.checked;
    checkboxInfo.checkboxSelector = generateSelector(target);
    console.log('🔍 检测到复选框直接点击:', target);
  }
  
  return checkboxInfo;
}

// 点击复选框标签
function clickCheckboxLabel(labelSelector, checkboxSelector, targetState) {
  try {
    console.log('🔘 点击复选框标签:', labelSelector, '目标复选框:', checkboxSelector, '目标状态:', targetState);
    
    // 找到复选框
    const checkbox = document.querySelector(checkboxSelector);
    if (!checkbox) {
      return { ok: false, message: "未找到复选框: " + checkboxSelector };
    }
    
    // 设置复选框状态
    checkbox.checked = targetState;
    
    // 触发相关事件
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    checkbox.dispatchEvent(new Event('click', { bubbles: true }));
    
    // 高亮显示
    highlight(checkbox);
    
    console.log('✅ 复选框状态已设置:', targetState);
    return { ok: true, message: `复选框已${targetState ? '选中' : '取消选中'}` };
  } catch (error) {
    console.error('❌ 点击复选框标签失败:', error);
    return { ok: false, message: "操作失败: " + error.message };
  }
}

// 切换复选框状态
function toggleCheckbox(selector, targetState) {
  try {
    console.log('🔘 切换复选框状态:', selector, '目标状态:', targetState);
    
    const checkbox = document.querySelector(selector);
    if (!checkbox) {
      return { ok: false, message: "未找到复选框: " + selector };
    }
    
    // 设置复选框状态
    checkbox.checked = targetState;
    
    // 触发相关事件
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    checkbox.dispatchEvent(new Event('click', { bubbles: true }));
    
    // 高亮显示
    highlight(checkbox);
    
    console.log('✅ 复选框状态已切换:', targetState);
    return { ok: true, message: `复选框已${targetState ? '选中' : '取消选中'}` };
  } catch (error) {
    console.error('❌ 切换复选框失败:', error);
    return { ok: false, message: "操作失败: " + error.message };
  }
}

// 录制输入事件（使用防抖，合并连续输入为一条）
function recordInput(event) {
  if (!isRecording) return;
  
  const target = event.target;
  const selector = generateSelector(target);
  const now = Date.now();
  
  // 检查是否被抑制（例如刚刚的toggle操作）
  const until = _suppressMap.get(selector) || 0;
  if (now < until) {
    return; // 抑制与刚刚的toggle重复的事件
  }
  
  // 清除之前的防抖定时器
  if (_inputDebounceTimers.has(selector)) {
    clearTimeout(_inputDebounceTimers.get(selector));
  }
  
  // 检查是否已有待处理的输入步骤
  let stepIndex = _inputPendingSteps.get(selector);
  let step;
  
  if (stepIndex !== undefined && stepIndex >= 0 && stepIndex < recordedSteps.length) {
    // 更新已存在的输入步骤
    step = recordedSteps[stepIndex];
    step.value = target.value; // 更新为最新值
    step.timestamp = now; // 更新时间戳
    console.log('📝 更新输入步骤:', stepIndex, step);
  } else {
    // 创建新的输入步骤
    step = {
      type: 'input',
      selector: selector,
      selectorFallbacks: generateSelectorFallbacks(target),
      value: target.value,
      timestamp: now,
      tagName: target.tagName,
      inputType: target.type
    };
    
    // 添加到步骤列表
    stepIndex = recordedSteps.length;
    recordedSteps.push(step);
    _inputPendingSteps.set(selector, stepIndex);
    console.log('📝 创建新输入步骤:', stepIndex, step);
  }
  
  // 设置防抖定时器：500ms后保存（如果用户停止输入）
  const timer = setTimeout(() => {
    // 保存最终值
    if (stepIndex !== undefined && stepIndex >= 0 && stepIndex < recordedSteps.length) {
      const finalStep = recordedSteps[stepIndex];
      finalStep.value = target.value; // 确保是最新值
      console.log('💾 输入完成，保存最终值:', finalStep);
      
      // 推送到侧边栏
      try { chrome.runtime.sendMessage({ action: 'stepRecorded', step: finalStep }); } catch (_) {}
      
      // 保存完整的步骤数组
      saveRecordedSteps();
      
      // 清理
      _inputDebounceTimers.delete(selector);
      _inputPendingSteps.delete(selector);
    }
  }, 500);
  
  _inputDebounceTimers.set(selector, timer);
  
  // 监听失去焦点事件，立即保存
  const handleBlur = () => {
    if (_inputDebounceTimers.has(selector)) {
      clearTimeout(_inputDebounceTimers.get(selector));
      _inputDebounceTimers.delete(selector);
    }
    
    if (stepIndex !== undefined && stepIndex >= 0 && stepIndex < recordedSteps.length) {
      const finalStep = recordedSteps[stepIndex];
      finalStep.value = target.value; // 确保是最新值
      console.log('💾 输入框失去焦点，立即保存:', finalStep);
      
      // 推送到侧边栏
      try { chrome.runtime.sendMessage({ action: 'stepRecorded', step: finalStep }); } catch (_) {}
      
      // 保存完整的步骤数组
      saveRecordedSteps();
      
      // 清理
      _inputPendingSteps.delete(selector);
    }
    
    // 移除blur监听器（避免重复）
    target.removeEventListener('blur', handleBlur);
  };
  
  // 添加blur监听器（如果还没有）
  target.removeEventListener('blur', handleBlur); // 先移除，避免重复
  target.addEventListener('blur', handleBlur, { once: true });
}

// 录制表单提交事件
function recordSubmit(event) {
  if (!isRecording) return;
  
  const target = event.target;
  const step = {
    type: 'submit',
    selector: generateSelector(target),
    timestamp: Date.now(),
    tagName: target.tagName
  };
  
  recordedSteps.push(step);
  console.log('录制提交:', step);
  
  // 推送到侧边栏
  try { chrome.runtime.sendMessage({ action: 'stepRecorded', step }); } catch (_) {}
  
  // 保存完整的步骤数组
  saveRecordedSteps();
}

// 录制选择变化事件
function recordChange(event) {
  if (!isRecording) return;
  
  const target = event.target;
  const selector = generateSelector(target);
  let step;
  const now = Date.now();
  const until = _suppressMap.get(selector) || 0;
  if (now < until) {
    return; // 抑制与刚刚的toggle重复的事件
  }
  if (target.tagName === 'SELECT' && target.multiple) {
    const values = Array.from(target.selectedOptions || []).map(o => o.value);
    step = {
      type: 'setOptions',
      selector,
      values,
      timestamp: Date.now(),
      tagName: target.tagName
    };
  } else {
    step = {
      type: 'change',
      selector,
      value: target.value,
      timestamp: Date.now(),
      tagName: target.tagName
    };
  }
  if (step.timestamp - _lastRecord.time < 250 && _lastRecord.selector === selector && _lastRecord.type === step.type) {
    return;
  }
  _lastRecord = { time: step.timestamp, selector, type: step.type };
  
  recordedSteps.push(step);
  console.log('录制变化:', step);
  
  // 推送到侧边栏
  try { chrome.runtime.sendMessage({ action: 'stepRecorded', step }); } catch (_) {}
  
  // 保存完整的步骤数组
  saveRecordedSteps();
}

// ===================== 选择器生成工具 =====================

// 判断是否是动态/不稳定的 ID（纯数字、hash 字符串、太长等）
function isDynamicId(id) {
  return !id ||
    /^[0-9]+$/.test(id) ||
    /^[a-f0-9]{8,}$/i.test(id) ||
    id.length > 60 ||
    /[:[\]{}()|^$*+?,\\]/.test(id); // 含特殊字符
}

// 获取元素自身的直接文本（不含子元素继承文本），避免选中父容器
function getDirectText(element) {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
  }
  return text.trim();
}

// 只保留稳定的 class（排除状态类：active/loading/disabled/hover 等）
function getStableClasses(element) {
  const dynamicPatterns = [
    /^is-/, /^has-/, /^was-/,
    /active/i, /selected/i, /loading/i, /disabled/i,
    /hover/i, /focus/i, /checked/i, /error/i, /valid/i,
    /open/i, /show/i, /hide/i, /visible/i,
    /^v-/, /^ng-/, /\d{4,}/, // Vue/Angular 生成的类、带数字 hash
  ];
  if (!element.className || typeof element.className !== 'string') return '';
  return element.className.split(' ')
    .map(c => c.trim())
    .filter(c => c && !dynamicPatterns.some(p => p.test(c)))
    .slice(0, 2)
    .join('.');
}

// 构建 CSS 路径（用于兜底）
function buildCssPath(element) {
  const path = [];
  let el = element;
  while (el && el !== document.body && el.tagName) {
    const tag = el.tagName.toLowerCase();
    const stableClasses = getStableClasses(el);
    let selector = tag + (stableClasses ? '.' + stableClasses : '');

    // 同级同类元素超过 1 个则加 nth-of-type
    if (el.parentElement) {
      const siblings = Array.from(el.parentElement.children).filter(s => {
        const sTag = s.tagName.toLowerCase();
        const sCls = getStableClasses(s);
        return sTag + (sCls ? '.' + sCls : '') === selector;
      });
      if (siblings.length > 1) {
        selector += `:nth-of-type(${siblings.indexOf(el) + 1})`;
      }
    }

    path.unshift(selector);
    el = el.parentElement;

    // 遇到稳定 ID 就停止向上
    if (el && el.id && !isDynamicId(el.id)) {
      try { path.unshift(`#${CSS.escape(el.id)}`); } catch (_) { path.unshift(`#${el.id}`); }
      break;
    }
    if (path.length >= 4) break;
  }
  return path.join(' > ');
}

// 生成主选择器（稳定优先级排序）
function generateSelector(element) {
  const tag = element.tagName.toLowerCase();
  const esc = (v) => { try { return CSS.escape(v); } catch(_) { return v.replace(/["\\]/g, '\\$&'); } };

  // 1. 测试专用属性（最稳定）
  for (const attr of ['data-testid', 'data-cy', 'data-qa', 'data-test', 'data-automation-id', 'data-id']) {
    const val = element.getAttribute(attr);
    if (val) return `[${attr}="${esc(val)}"]`;
  }

  // 2. name 属性（表单元素，语义稳定）
  if (element.name) {
    const sel = `${tag}[name="${esc(element.name)}"]`;
    return sel;
  }

  // 3. aria-label（按钮/交互元素语义标识）
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    const sel = `${tag}[aria-label="${esc(ariaLabel)}"]`;
    try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (_) {}
  }

  // 4. placeholder（输入框）
  const placeholder = element.getAttribute('placeholder');
  if (placeholder && (tag === 'input' || tag === 'textarea')) {
    const sel = `${tag}[placeholder="${esc(placeholder)}"]`;
    try { if (document.querySelectorAll(sel).length <= 2) return sel; } catch (_) {}
  }

  // 5. 稳定 ID
  if (element.id && !isDynamicId(element.id)) {
    try { return `#${CSS.escape(element.id)}`; } catch (_) { return `#${element.id}`; }
  }

  // 6. 叶子文本（按钮、链接、标签等直接操作元素）
  if (['button', 'a', 'label', 'option'].includes(tag)) {
    const text = getDirectText(element) || element.innerText?.trim() || '';
    if (text && text.length <= 40) return `text="${text}"`;
  }

  // 7. type + 稳定属性组合（非泛化的 input type）
  if (tag === 'input' && element.type && !['text', 'password'].includes(element.type)) {
    const sel = `input[type="${element.type}"]`;
    try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (_) {}
  }

  // 8. CSS 路径兜底
  return buildCssPath(element);
}

// 生成 fallback 选择器数组（供回放时依次尝试）
function generateSelectorFallbacks(element) {
  const fallbacks = [];
  const tag = element.tagName.toLowerCase();
  const esc = (v) => { try { return CSS.escape(v); } catch(_) { return v.replace(/["\\]/g, '\\$&'); } };

  // 文本 fallback（最实用）
  const text = getDirectText(element) || element.innerText?.trim() || element.textContent?.trim() || '';
  if (text && text.length <= 50) fallbacks.push(`text="${text}"`);

  // aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) fallbacks.push(`[aria-label="${esc(ariaLabel)}"]`);

  // placeholder
  const placeholder = element.getAttribute('placeholder');
  if (placeholder) fallbacks.push(`${tag}[placeholder="${esc(placeholder)}"]`);

  // name
  if (element.name) fallbacks.push(`${tag}[name="${esc(element.name)}"]`);

  // stable id
  if (element.id && !isDynamicId(element.id)) {
    try { fallbacks.push(`#${CSS.escape(element.id)}`); } catch (_) {}
  }

  // CSS path
  const cssPath = buildCssPath(element);
  if (cssPath) fallbacks.push(cssPath);

  return [...new Set(fallbacks)];
}

// 执行单个步骤（重构版）
function normalizeResult(r) {
  if (r === undefined || r === null) return { ok: true };
  if (typeof r === 'object') {
    if (r.ok === false) return { ok: false, message: r.message };
    if (r.success === false) return { ok: false, message: r.message };
    return { ok: r.ok === true || r.success === true || true };
  }
  return { ok: true };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const stepExecutors = {
  async click(step) {
    const selector = String(step.selector || '');
    if (!selector) return { ok: false, message: '无效选择器' };
    const maxWait = Number(step.maxWait || 5000); // 默认等待5秒

    // 记录点击前的URL
    const urlBeforeClick = window.location.href;

    const r = await clickBySelector(selector, step.selectorFallbacks, maxWait, step);
    
    // 点击后检测页面是否跳转
    if (r && r.ok) {
      // 等待一下，给页面跳转时间
      await sleep(500);
      
      // 检测URL是否变化（页面跳转）或页面刷新
      let urlChanged = false;
      let pageReloaded = false;
      let checkCount = 0;
      const maxChecks = 30; // 最多检查3秒（30 * 100ms）
      
      while (checkCount < maxChecks) {
        const currentUrl = window.location.href;
        
        // 检查URL是否变化
        if (currentUrl !== urlBeforeClick) {
          urlChanged = true;
          console.log('🔄 检测到页面跳转:', urlBeforeClick, '->', currentUrl);
          break;
        }
        
        // 检查页面是否刷新（通过检查document.readyState）
        if (document.readyState === 'loading') {
          pageReloaded = true;
          console.log('🔄 检测到页面刷新');
          break;
        }
        
        await sleep(100);
        checkCount++;
      }
      
      // 如果检测到页面刷新，等待页面加载完成
      if (pageReloaded) {
        console.log('⏳ 检测到页面刷新，等待页面加载完成...');
        let loadCount = 0;
        const maxLoadChecks = 50; // 最多等待5秒
        while (loadCount < maxLoadChecks) {
          if (document.readyState === 'complete') {
            // 再等待一下，确保动态内容加载完成
            await sleep(1000);
            console.log('✅ 页面刷新后加载完成');
            urlChanged = true; // 标记为页面变化，触发后续等待逻辑
            break;
          }
          await sleep(100);
          loadCount++;
        }
      }
      
      // 如果页面跳转，等待新页面加载完成
      if (urlChanged) {
        console.log('⏳ 等待新页面加载完成...');
        // 等待页面加载完成
        let loadComplete = false;
        let waitCount = 0;
        const maxWaitCount = 50; // 最多等待5秒
        
        while (waitCount < maxWaitCount && !loadComplete) {
          if (document.readyState === 'complete') {
            // 再等待一下，确保动态内容加载完成
            await sleep(500);
            loadComplete = true;
            console.log('✅ 新页面加载完成');
          } else {
            await sleep(100);
            waitCount++;
          }
        }
        
        if (!loadComplete) {
          console.warn('⚠️ 等待页面加载超时，继续执行');
        }
      } else {
        // 没有跳转，只等待一下
        await sleep(200);
      }
    }
    
    return normalizeResult(r);
  },
  async input(step) {
    const selector = String(step.selector || '');
    const value = String(step.value || '');
    if (!selector) return { ok: false, message: '无效选择器' };
    const maxWait = Number(step.maxWait || 5000); // 默认等待5秒
    const r = await typeIntoSelector(selector, value, step.selectorFallbacks, maxWait, step);
    return normalizeResult(r);
  },
  async wait(step) {
    const ms = Number(step.value || step.duration || 500);
    console.log(`⏳ 等待 ${ms} 毫秒...`);
    await sleep(ms);
    console.log(`✅ 等待完成`);
    return { ok: true };
  },
  async submit(step) {
    const selector = String(step.selector || 'form');
    const el = document.querySelector(selector);
    if (!el) return { ok: false, message: '未找到可提交元素' };
    const form = el.tagName === 'FORM' ? el : (el.form || el.closest('form'));
    if (!form) return { ok: false, message: '未找到表单' };
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    if (typeof form.submit === 'function') {
      try { form.submit(); } catch(_) {}
    }
    // 提交后等待更长时间，给页面跳转时间
    await sleep(500);
    return { ok: true };
  },
  async change(step) {
    const selector = String(step.selector || '');
    const el = selector ? document.querySelector(selector) : null;
    if (!el) return { ok: false, message: '未找到元素' };
    if (el.tagName === 'SELECT' && el.multiple && Array.isArray(step.values)) {
      Array.from(el.options).forEach(opt => { opt.selected = step.values.includes(opt.value); });
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    if ('value' in el && step.value != null) {
      el.value = String(step.value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  },
  async toggle(step) {
    const selector = String(step.selector || '');
    const el = selector ? document.querySelector(selector) : null;
    if (!el) return { ok: false, message: '未找到元素' };
    if (el.type === 'checkbox') {
      el.checked = !!step.targetState;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('click', { bubbles: true }));
      return { ok: true };
    }
    if (el.getAttribute('role') === 'switch' || el.hasAttribute('aria-checked')) {
      el.setAttribute('aria-checked', step.targetState ? 'true' : 'false');
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('click', { bubbles: true }));
      return { ok: true };
    }
    // fallback：尝试点击
    const maxWait = Number(step.maxWait || 5000);
    const r = await clickBySelector(selector, maxWait);
    return normalizeResult(r);
  },
  async scroll(step) {
    const selector = String(step.selector || '');
    if (selector) {
      const el = document.querySelector(selector);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return { ok: true };
  }
};

async function performStep(step) {
  try {
    const type = String(step?.type || '').toLowerCase();
    const exec = stepExecutors[type];
    if (!exec) return { ok: false, message: '未知操作类型' };
    return await exec(step);
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// ===================== AI 自动生成用例：提取页面交互元素 =====================

function extractPageInteractives() {
  const esc = (v) => { try { return CSS.escape(v); } catch(_) { return v; } };
  const results = [];
  const seen = new Set();

  const INTERACTIVE_SELECTORS = [
    'button', 'a[href]', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="menuitem"]',
    '[role="tab"]', '[role="checkbox"]', '[role="radio"]',
    '[tabindex]', 'label[for]'
  ];

  const elements = document.querySelectorAll(INTERACTIVE_SELECTORS.join(','));

  for (const el of elements) {
    if (!isVisible(el)) continue;

    const tag = el.tagName.toLowerCase();
    const text = (el.innerText || el.textContent || '').trim().slice(0, 60);
    const ariaLabel = el.getAttribute('aria-label') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const name = el.getAttribute('name') || '';
    const role = el.getAttribute('role') || '';
    const inputType = el.getAttribute('type') || '';
    const href = el.getAttribute('href') || '';

    // 生成稳定选择器
    const selector = generateSelector(el);

    // 去重（相同 selector + text 的跳过）
    const key = `${selector}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      tag,
      inputType,
      text,
      ariaLabel,
      placeholder,
      name,
      role,
      href,
      selector
    });

    if (results.length >= 100) break; // 最多 100 个
  }

  return {
    ok: true,
    pageUrl: window.location.href,
    pageTitle: document.title,
    interactives: results
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const { type } = msg || {};
  try {
    if (type === 'extractPageInteractives') {
      return void sendResponse(extractPageInteractives());
    }
    if (type === "clickByText") {
      const { text } = msg;
      return void sendResponse(clickByText(String(text || "")));
    }
    if (type === "typeIntoSelector") {
      const { selector, value } = msg;
      (async () => {
        const result = await typeIntoSelector(String(selector || ""), String(value || ""));
        sendResponse(result);
      })();
      return true;
    }
    if (type === "scrollToText") {
      const { text } = msg;
      return void sendResponse(scrollToText(String(text || "")));
    }
    if (type === "ping") {
      console.log('🏓 收到 ping 请求');
      return void sendResponse({ ok: true, message: "Content script 正常工作" });
    }
    if (type === "debugElements") {
      return void sendResponse(debugElements());
    }
    if (type === "checkPageChange") {
      return void sendResponse(checkPageChange());
    }
    if (type === "checkPageErrors") {
      return void sendResponse(checkPageErrors());
    }
    if (type === "inspectButton") {
      const { text } = msg;
      return void sendResponse(inspectButton(String(text || "")));
    }
    if (type === "clickBySelector") {
      const { selector } = msg;
      (async () => {
        const result = await clickBySelector(String(selector || ""));
        sendResponse(result);
      })();
      return true;
    }
    // 录制功能消息处理
    if (type === "startRecording") {
      console.log('🎬 Content script 收到开始录制消息');
      const result = startRecording();
      console.log('🎬 录制启动结果:', result);
      sendResponse(result);
      return true;
    }
    if (type === "stopRecording") {
      const result = stopRecording();
      sendResponse(result);
      return true;
    }
    if (type === "clearRecording") {
      const result = clearRecording();
      sendResponse(result);
      return true;
    }
    if (type === "clearAllHighlights") {
      if (typeof clearAllHighlights === 'function') {
        clearAllHighlights();
      }
      sendResponse({ ok: true, message: "已清除所有高亮" });
      return true;
    }
    if (type === "getRecordedSteps") {
      sendResponse({ ok: true, steps: recordedSteps });
      return true;
    }
    if (type === "ping") {
      return void sendResponse({ ok: true, message: "Content script 已就绪" });
    }
    if (type === "updateRecordedSteps") {
      const { steps } = msg;
      recordedSteps = Array.isArray(steps) ? steps : [];
      console.log('📝 更新录制步骤，数量:', recordedSteps.length);
      saveRecordedSteps();
      sendResponse({ ok: true, message: "录制步骤已更新" });
      return true;
    }
    if (type === "clickCheckboxLabel") {
      const { labelSelector, checkboxSelector, targetState } = msg;
      return void sendResponse(clickCheckboxLabel(labelSelector, checkboxSelector, targetState));
    }
    if (type === "toggleCheckbox") {
      const { selector, targetState } = msg;
      return void sendResponse(toggleCheckbox(selector, targetState));
    }
    if (type === "playRecordedSteps") {
      (async () => {
        try {
          const steps = Array.isArray(msg.steps) ? msg.steps : [];
          const intervalMs = Math.max(0, Number(msg.intervalMs || 0));
          for (const step of steps) {
            const r = await performStep(step);
            if (!r.ok) break;
            if (intervalMs > 0) {
              await new Promise(res => setTimeout(res, intervalMs));
            }
          }
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, message: e.message });
        }
      })();
      return true;
    }
    if (type === "playSingleStep") {
      console.log('🎯 收到执行单步请求:', msg.step);
      (async () => {
        try {
          const step = msg.step || {};
          console.log('📝 开始执行步骤:', step.type, step.selector);
          const r = await performStep(step);
          console.log('✅ 步骤执行完成，结果:', r);
          if (r) {
            sendResponse(r);
          } else {
            sendResponse({ ok: true }); // 如果没有返回结果，默认成功
          }
        } catch (e) {
          console.error('❌ 步骤执行异常:', e);
          sendResponse({ ok: false, message: e.message || String(e) });
        }
      })();
      return true; // 保持通道开放，等待异步响应
    }
    // AI 增强录制开关
    if (type === "setAiEnhance") {
      _aiEnhanceEnabled = !!msg.enabled;
      sendResponse({ ok: true, enabled: _aiEnhanceEnabled });
      return true;
    }
    // 保存录制用例到数据库
    if (type === "saveCaseToDb") {
      (async () => {
        try {
          const { name, description, steps, setupSteps, folderId, expected } = msg;
          // 将录制步骤转为 DB 格式
          const dbSteps = (steps || recordedSteps).map((s, i) => ({
            index: i,
            type: s.type,
            selector: s.selector,
            selectorFallbacks: s.selectorFallbacks || [],
            value: s.value || '',
            text: s.text || '',
            description: s.visualDescription || s.text || '',
            visualDescription: s.visualDescription || '',
            coordinates: (s.x !== undefined && s.y !== undefined) ? { x: s.x, y: s.y } : null,
            timestamp: s.timestamp,
          }));
          const resp = await fetch(`${SERVER_URL}/api/recording/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: name || '未命名用例',
              description: description || '',
              steps: dbSteps,
              setup_steps: setupSteps || [],
              folder_id: folderId || null,
              expected: expected || '',
            }),
          });
          const data = await resp.json();
          sendResponse(data);
        } catch (e) {
          sendResponse({ error: e.message });
        }
      })();
      return true;
    }
    if (type === "testRecording") {
      // 测试录制功能
      console.log('🧪 测试录制功能');
      console.log('isRecording:', isRecording);
      console.log('recordedSteps.length:', recordedSteps.length);
      console.log('document readyState:', document.readyState);
      console.log('window.location:', window.location.href);
      console.log('document.title:', document.title);
      
      // 测试事件监听器
      console.log('🔍 检查事件监听器状态...');
      console.log('document.addEventListener 存在:', typeof document.addEventListener);
      
      // 测试基本函数
      try {
        console.log('测试 highlight 函数...');
        if (typeof highlight === 'function') {
          console.log('✅ highlight 函数存在');
        } else {
          console.log('❌ highlight 函数不存在');
        }
      } catch (e) {
        console.log('❌ highlight 函数测试失败:', e);
      }
      
      return void sendResponse({ ok: true, message: "测试完成" });
    }
    if (type === "testClickRecording") {
      // 手动测试点击录制
      console.log('🧪 手动测试点击录制');
      console.log('当前录制状态:', isRecording);
      
      if (isRecording) {
        // 模拟一个点击事件
        const testEvent = {
          target: document.body,
          type: 'click'
        };
        recordClick(testEvent);
        console.log('✅ 手动测试点击完成');
      } else {
        console.log('❌ 录制未激活，无法测试');
      }
      
      return void sendResponse({ ok: true, message: "手动测试完成" });
    }
    sendResponse({ ok: false, message: "未知指令" });
  } catch (e) {
    sendResponse({ ok: false, message: "执行异常" });
  }
  return true;
});

} // 结束防止重复加载的检查


