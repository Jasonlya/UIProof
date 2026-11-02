/**
 * 录制功能模块
 * 负责录制用户操作、步骤管理和执行
 */

class RecordingManager {
  constructor() {
    this.recordedSteps = [];
    this.selectedSteps = new Set();
    this.currentStepIndex = 0;
    this.isRecording = false;
    this.isPlaying = false;
    this.recordingStartTime = null;
    this.liveSyncTimer = null;
    this.lastSyncedCount = 0;
    this.undoStack = [];
    this.redoStack = [];
  }

  // ===== IndexedDB (持久化，避免刷新/跳转丢失) =====
  openIDB() {
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open('uiap-db', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) {
            db.createObjectStore('kv');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    });
  }

  async idbSet(key, val) {
    try {
      const db = await this.openIDB();
      await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch (_) {}
  }

  async idbGet(key) {
    try {
      const db = await this.openIDB();
      return await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(key);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    } catch (_) { return undefined; }
  }

  async idbRemove(key) {
    try {
      const db = await this.openIDB();
      await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch (_) {}
  }

  // 会话级持久化（避免页面跳转丢失）
  async saveStepsToSession() {
    try {
      // 由后台统一持久化
      try {
        const r = await chrome.runtime.sendMessage({ type: 'persistSteps', steps: this.recordedSteps });
        console.log('💾 后台持久化结果:', r);
      } catch (e) {
        console.warn('后台持久化失败，fallback 到 local/IDB');
        await chrome.storage.local.set({ uiap_steps: this.recordedSteps });
        await this.idbSet('uiap_steps', this.recordedSteps);
      }
    } catch (_) {}
  }

  async loadStepsFromSession() {
    try {
      try {
        const r = await chrome.runtime.sendMessage({ type: 'loadPersistedSteps' });
        if (r && r.ok && Array.isArray(r.steps)) {
          console.log('📥 从后台恢复步骤:', r.steps.length);
          return r.steps;
        }
      } catch (_) {}
      // fallback
      const dataLocal = await chrome.storage.local.get('uiap_steps');
      if (Array.isArray(dataLocal.uiap_steps)) return dataLocal.uiap_steps;
      const idbSteps = await this.idbGet('uiap_steps');
      if (Array.isArray(idbSteps)) return idbSteps;
      return [];
    } catch (_) {
      return [];
    }
  }

  async clearSessionSteps() {
    try {
      try { await chrome.runtime.sendMessage({ type: 'clearPersistedSteps' }); } catch (_) {}
      await chrome.storage.local.remove('uiap_steps');
      await this.idbRemove('uiap_steps');
    } catch (_) {}
  }

  /**
   * 发送消息到内容脚本，带超时和自动重试
   */
  async sendMessageWithTimeout(tabId, message, timeoutMs = 3000, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await new Promise((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            if (!settled) {
              settled = true;
              reject(new Error('内容脚本响应超时'));
            }
          }, timeoutMs);

          try {
            chrome.tabs.sendMessage(tabId, message, (response) => {
              if (settled) return;
              clearTimeout(timer);
              settled = true;
              if (chrome.runtime.lastError) {
                const errorMsg = chrome.runtime.lastError.message;
                // 检查是否是bfcache相关错误
                if (/port closed|Receiving end does not exist|message channel closed/i.test(errorMsg)) {
                  return reject(new Error('PORT_CLOSED_BFCACHE'));
                }
                return reject(new Error(errorMsg));
              }
              resolve(response);
            });
          } catch (e) {
            clearTimeout(timer);
            if (!settled) reject(e);
          }
        });
        return result;
      } catch (error) {
        const errorMsg = String(error.message || error);
        
        // 如果是bfcache错误，尝试重新注入脚本并重试
        if (errorMsg.includes('PORT_CLOSED_BFCACHE') || 
            errorMsg.includes('port closed') ||
            errorMsg.includes('Receiving end does not exist')) {
          
          console.warn(`⚠️ 消息通道关闭 (可能是bfcache)，尝试恢复 (${attempt + 1}/${retries + 1})`);
          
          if (attempt < retries) {
            // 等待页面从bfcache恢复
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 尝试重新注入内容脚本
            try {
              await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content/content.js']
              });
              console.log('✅ 已重新注入内容脚本');
              await new Promise(resolve => setTimeout(resolve, 300));
            } catch (injectError) {
              console.warn('重新注入脚本失败:', injectError);
            }
            
            // 继续重试
            continue;
          }
        }
        
        // 最后一次尝试失败，抛出错误
        if (attempt === retries) {
          throw error;
        }
      }
    }
  }

  /**
   * 确保内容脚本已就绪；若未就绪则动态注入
   */
  async ensureContentScriptReady(tabId) {
    for (let i = 0; i < 5; i++) {
      try {
        const pong = await this.sendMessageWithTimeout(tabId, { type: 'ping' }, 800, 1);
        if (pong && pong.ok) return true;
      } catch (error) {
        const errorMsg = String(error.message || error);
        // 如果是bfcache错误，尝试重新注入
        if (errorMsg.includes('PORT_CLOSED_BFCACHE') || 
            errorMsg.includes('port closed')) {
          console.log('🔄 检测到bfcache问题，尝试重新注入内容脚本');
          try {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: ['content.js']
            });
            await new Promise(r => setTimeout(r, 500));
            // 再次尝试ping
            try {
              const pong = await this.sendMessageWithTimeout(tabId, { type: 'ping' }, 800, 0);
              if (pong && pong.ok) return true;
            } catch (_) {}
          } catch (injectError) {
            console.warn('重新注入失败:', injectError);
          }
        }
      }
      await new Promise(r => setTimeout(r, 300));
    }
    console.error('内容脚本不可用: 多次 ping 未响应');
    return false;
  }

  /**
   * 获取当前活动网页的 tabId（兼容侧边栏窗口）
   */
  async getActivePageTabId() {
    // 优先获取最近聚焦的“普通”浏览器窗口
    try {
      const win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
      if (win && win.tabs) {
        const activeTab = win.tabs.find(t => t.active && t.id && t.url && !t.url.startsWith('chrome-extension://'))
          || win.tabs.find(t => t.id && t.url && !t.url.startsWith('chrome-extension://'));
        if (activeTab && activeTab.id) return activeTab.id;
      }
    } catch (_) {}

    // 退化方案：在所有窗口中查找一个可用的 http/https 标签页
    const allTabs = await chrome.tabs.query({});
    const httpTab = allTabs.find(t => t.id && t.url && /^https?:/i.test(t.url));
    return httpTab ? httpTab.id : null;
  }

  /**
   * 初始化录制模式
   */
  initRecordingMode() {
    console.log('🎬 初始化录制模式');
    
    // 延迟绑定事件，确保DOM已加载
    setTimeout(() => {
      this.bindRecordingEvents();
    }, 100);
    
    // 更新UI
    this.updateStepsList();
    this.updateRecordCount();
    // 初始状态不显示"准备就绪"，等待用户点击"开始录制"
    this.updateRecordStatus('等待开始录制');
    this.updateRecordButtons();
    this.updateUndoRedoButtons();
    // 总是尝试从持久化恢复（用于页面跳转或面板重载后）
    this.loadStepsFromSession().then(steps => {
      if (Array.isArray(steps) && steps.length > 0) {
        // 使用无持久化的方法，避免循环写入
        this.setRecordedStepsFromStorage(steps);
        this.updateStepsList();
        this.updateRecordCount();
        console.log('✅ 已从 storage 恢复步骤并刷新UI:', steps.length);
      } else {
        console.log('ℹ️ 持久化中无步骤可恢复');
      }
    });
  }

  /**
   * 绑定录制事件
   */
  bindRecordingEvents() {
    console.log('🔗 绑定录制事件...');
    
    // 开始录制按钮
    const startRecordBtn = document.querySelector('#startRecord');
    console.log('📋 开始录制按钮:', startRecordBtn);
    if (startRecordBtn) {
      // 先移除旧的事件监听器（如果有）
      startRecordBtn.removeEventListener('click', this._startRecordingHandler);
      // 创建新的事件处理器并保存引用
      this._startRecordingHandler = () => {
        console.log('🎬 开始录制按钮被点击');
        this.startRecording();
      };
      startRecordBtn.addEventListener('click', this._startRecordingHandler);
      console.log('✅ 开始录制按钮事件已绑定');
    } else {
      console.error('❌ 未找到开始录制按钮 #startRecord');
    }
    
    // 停止录制按钮
    const stopRecordBtn = document.querySelector('#stopRecord');
    if (stopRecordBtn) {
      stopRecordBtn.removeEventListener('click', this._stopRecordingHandler);
      this._stopRecordingHandler = () => this.stopRecording();
      stopRecordBtn.addEventListener('click', this._stopRecordingHandler);
    }
    
    // 清空步骤按钮（与 HTML 对齐）
    const clearStepsBtn = document.querySelector('#clearRecord');
    if (clearStepsBtn) {
      clearStepsBtn.removeEventListener('click', this._clearStepsHandler);
      this._clearStepsHandler = () => this.clearSteps();
      clearStepsBtn.addEventListener('click', this._clearStepsHandler);
    }
    
    // 保存用例按钮
    const saveCaseBtn = document.querySelector('#saveCase');
    if (saveCaseBtn) {
      saveCaseBtn.removeEventListener('click', this._saveCaseHandler);
      this._saveCaseHandler = () => this.saveCase();
      saveCaseBtn.addEventListener('click', this._saveCaseHandler);
    }
    
    // 取消按钮
    const cancelBtn = document.querySelector('#cancelRecord');
    if (cancelBtn) {
      cancelBtn.removeEventListener('click', this._cancelRecordHandler);
      this._cancelRecordHandler = () => this.cancelRecord();
      cancelBtn.addEventListener('click', this._cancelRecordHandler);
    }
    
    // 返回用例管理按钮
    const backBtn = document.querySelector('#backToCases');
    if (backBtn) {
      backBtn.removeEventListener('click', this._backToManagementHandler);
      this._backToManagementHandler = () => this.backToManagement();
      backBtn.addEventListener('click', this._backToManagementHandler);
    }

    // 执行选中
    const playSelectedBtn = document.querySelector('#playSelected');
    if (playSelectedBtn) {
      playSelectedBtn.removeEventListener('click', this._playSelectedHandler);
      this._playSelectedHandler = () => this.playSelected();
      playSelectedBtn.addEventListener('click', this._playSelectedHandler);
    }

    // 执行全部
    const playAllBtn = document.querySelector('#playAll');
    if (playAllBtn) {
      playAllBtn.removeEventListener('click', this._playAllHandler);
      this._playAllHandler = () => this.playAll();
      playAllBtn.addEventListener('click', this._playAllHandler);
    }
    
    console.log('✅ 录制事件绑定完成');

    // 添加步骤
    const addStepBtn = document.querySelector('#addStep');
    if (addStepBtn) {
      addStepBtn.removeEventListener('click', this._addStepHandler);
      this._addStepHandler = () => this.openAddStepDialog();
      addStepBtn.addEventListener('click', this._addStepHandler);
    }

    // 撤销操作
    const undoBtn = document.querySelector('#undoStep');
    if (undoBtn) {
      undoBtn.removeEventListener('click', this._undoHandler);
      this._undoHandler = () => this.undo();
      undoBtn.addEventListener('click', this._undoHandler);
    }

    // 重做操作
    const redoBtn = document.querySelector('#redoStep');
    if (redoBtn) {
      redoBtn.removeEventListener('click', this._redoHandler);
      this._redoHandler = () => this.redo();
      redoBtn.addEventListener('click', this._redoHandler);
    }

    // 初始化按钮状态
    this.updateUndoRedoButtons();
  }

  setCurrentStepIndex(stepIndex) {
    const idx = Math.max(0, Math.min(stepIndex, this.recordedSteps.length - 1));
    this.currentStepIndex = idx;
    // 仅高亮当前一步
    this.selectedSteps.clear();
    this.selectedSteps.add(idx);
    this.updateAllStepSelections();
    // 滚动到可见
    const el = document.querySelector(`[data-step-index="${idx}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  async playAll() {
    try {
      if (this.recordedSteps.length === 0) {
        this.setStatus('没有可执行的步骤', false);
        return;
      }
      const intervalInput = document.querySelector('#playInterval');
      const intervalMs = Math.max(0, parseInt((intervalInput && intervalInput.value) || '0', 10) || 0);
      const tabId = await this.getActivePageTabId();
      if (!tabId) throw new Error('无法获取当前标签页');
      
      // 更新执行按钮为执行中状态
      this.setExecutionButtonState('playAll', true);
      
      this.setStatus('正在执行步骤...', true);
      
      // 使用background script协调执行（支持跨页面）
      try {
        console.log('🚀 开始执行，步骤数:', this.recordedSteps.length, 'tabId:', tabId);
        const response = await chrome.runtime.sendMessage({
          type: 'startExecution',
          steps: this.recordedSteps,
          intervalMs: intervalMs,
          tabId: tabId  // 明确传递tabId
        });
        
        if (response && response.ok) {
          // 开始执行（background会协调）
          this.setStatus('执行中，支持跨页面...', true);
          
          // 监听执行完成（通过轮询检查）
          const checkInterval = setInterval(async () => {
            try {
              const state = await chrome.storage.local.get('uiap_execution_state');
              if (!state.uiap_execution_state || !state.uiap_execution_state.isExecuting) {
                clearInterval(checkInterval);
                
                // 获取执行结果
                const resultData = await chrome.storage.local.get('uiap_execution_result');
                const executionResult = resultData.uiap_execution_result;
                
                // 恢复执行按钮状态
                this.setExecutionButtonState('playAll', false);
                
                if (state.uiap_execution_state && state.uiap_execution_state.currentIndex >= state.uiap_execution_state.steps.length) {
                  this.setStatus('执行完成', true);
                  
                  // 显示执行结果弹窗（调试页面，显示步骤详情）
                  if (executionResult && this.uiUtils) {
                    setTimeout(() => {
                      this.uiUtils.showExecutionResult(executionResult, true);
                    }, 500);
                  }
                } else {
                  this.setStatus('执行已停止', false);
                  
                  // 显示执行结果弹窗（即使中断也显示）
                  if (executionResult && this.uiUtils) {
                    setTimeout(() => {
                      this.uiUtils.showExecutionResult(executionResult, true);
                    }, 500);
                  }
                }
                
                // 清理结果数据
                await chrome.storage.local.remove('uiap_execution_result');
              } else {
                const progress = state.uiap_execution_state.currentIndex || 0;
                const total = state.uiap_execution_state.steps?.length || 0;
                this.setStatus(`执行中: ${progress}/${total}`, true);
                console.log('📊 执行进度:', progress, '/', total);
              }
            } catch (e) {
              console.error('检查执行状态失败:', e);
              clearInterval(checkInterval);
            }
          }, 300);
          
          // 30秒后停止检查（防止无限等待）
          setTimeout(() => {
            clearInterval(checkInterval);
          }, 300000);
        } else {
          throw new Error('启动执行失败');
        }
      } catch (e) {
        // fallback到原来的方式（单页面执行）
        console.warn('使用background执行失败，fallback到单页面执行:', e);
        const ready = await this.ensureContentScriptReady(tabId);
        if (!ready) throw new Error('内容脚本未就绪');
        const resp = await this.sendMessageWithTimeout(tabId, { type: 'playRecordedSteps', steps: this.recordedSteps, intervalMs }, 600000);
        
        // 恢复执行按钮状态
        this.setExecutionButtonState('playAll', false);
        
        if (resp && resp.ok) {
          this.setStatus('执行完成', true);
          
          // 对于单页面执行，构建简单的结果对象
          if (this.uiUtils) {
            const simpleResult = {
              success: true,
              totalSteps: this.recordedSteps.length,
              successCount: this.recordedSteps.length,
              failCount: 0,
              results: this.recordedSteps.map((_, index) => ({
                stepIndex: index,
                success: true,
                message: '执行成功'
              }))
            };
            setTimeout(() => {
              this.uiUtils.showExecutionResult(simpleResult, true);
            }, 500);
          }
        } else {
          throw new Error(resp?.message || '执行失败');
        }
      }
    } catch (e) {
      // 恢复执行按钮状态
      this.setExecutionButtonState('playAll', false);
      this.setStatus(`执行失败: ${e.message}`, false);
    }
  }

  getIntervalMs() {
    const intervalInput = document.querySelector('#playInterval');
    return Math.max(0, parseInt((intervalInput && intervalInput.value) || '0', 10) || 0);
  }

  getSelectedStepsArray() {
    const indices = Array.from(this.selectedSteps.values()).sort((a, b) => a - b);
    return indices.map(i => this.recordedSteps[i]).filter(Boolean);
  }

  async playSelected() {
    try {
      const steps = this.getSelectedStepsArray();
      if (steps.length === 0) {
        this.setStatus('未选择任何步骤', false);
        return;
      }
      
      // 更新执行按钮为执行中状态
      this.setExecutionButtonState('playSelected', true);
      
      const tabId = await this.getActivePageTabId();
      if (!tabId) throw new Error('无法获取当前标签页');
      const ready = await this.ensureContentScriptReady(tabId);
      if (!ready) throw new Error('内容脚本未就绪');
      const resp = await this.sendMessageWithTimeout(tabId, { type: 'playRecordedSteps', steps, intervalMs: this.getIntervalMs() }, 600000);
      
      // 恢复执行按钮状态
      this.setExecutionButtonState('playSelected', false);
      
      if (!resp || resp.ok) {
        this.setStatus('执行完成', true);
        
        // 对于单页面执行，构建简单的结果对象
        if (this.uiUtils) {
          const simpleResult = {
            success: true,
            totalSteps: steps.length,
            successCount: steps.length,
            failCount: 0,
            results: steps.map((_, index) => ({
              stepIndex: index,
              success: true,
              message: '执行成功'
            }))
          };
          setTimeout(() => {
            this.uiUtils.showExecutionResult(simpleResult, true);
          }, 500);
        }
      } else {
        throw new Error(resp?.message || '执行失败');
      }
    } catch (e) {
      // 恢复执行按钮状态
      this.setExecutionButtonState('playSelected', false);
      this.setStatus(`执行失败: ${e.message}`, false);
    }
  }

  /**
   * 设置执行按钮的执行中状态
   */
  setExecutionButtonState(buttonId, isExecuting) {
    const button = document.querySelector(`#${buttonId}`);
    if (!button) return;
    
    if (isExecuting) {
      button.disabled = true;
      button.classList.add('executing');
      const originalHTML = button.innerHTML;
      button.dataset.originalHTML = originalHTML;
      
      if (buttonId === 'playAll') {
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 执行中...';
      } else if (buttonId === 'playSelected') {
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 执行中...';
      }
    } else {
      button.disabled = false;
      button.classList.remove('executing');
      // 恢复原始内容
      if (button.dataset.originalHTML) {
        button.innerHTML = button.dataset.originalHTML;
        delete button.dataset.originalHTML;
      }
    }
  }

  async playNextStep() {
    try {
      if (this.currentStepIndex >= this.recordedSteps.length) {
        this.setStatus('没有更多步骤', false);
        return;
      }
      const step = this.recordedSteps[this.currentStepIndex];
      const tabId = await this.getActivePageTabId();
      if (!tabId) throw new Error('无法获取当前标签页');
      const ready = await this.ensureContentScriptReady(tabId);
      if (!ready) throw new Error('内容脚本未就绪');
      const resp = await this.sendMessageWithTimeout(tabId, { type: 'playSingleStep', step }, 30000);
      // 无响应或未显式失败都视为成功（部分站点操作不会返回标准结构）
      if (!resp || resp.ok || resp.success) {
        this.currentStepIndex += 1;
        this.setStatus(`已执行第 ${this.currentStepIndex} 步`, true);
        if (this.currentStepIndex < this.recordedSteps.length) {
          this.setCurrentStepIndex(this.currentStepIndex);
        }
      } else {
        throw new Error(resp?.message || '执行失败');
      }
    } catch (e) {
      const msg = String(e && e.message || e || '');
      // 如果页面跳转导致通道关闭或超时，视为这一步已触发成功，继续推进
      if (/port closed|No response|响应超时|Timed out|Receiving end does not exist/i.test(msg)) {
        this.currentStepIndex += 1;
        this.setStatus(`已执行第 ${this.currentStepIndex} 步（页面变化，继续）`, true);
        if (this.currentStepIndex < this.recordedSteps.length) {
          this.setCurrentStepIndex(this.currentStepIndex);
        }
        return;
      }
      this.setStatus(`执行失败: ${msg}`, false);
    }
  }

  /**
   * 开始录制
   */
  async startRecording() {
    console.log('🎬 开始录制');
    
    if (this.isRecording) {
      console.log('⚠️ 已经在录制中');
      return;
    }
    
    try {
      // 更新状态为"准备就绪"
      this.updateRecordStatus('准备就绪');
      this.setStatus('正在启动录制...', true);
      
      if (!(window && window.chrome && chrome.tabs)) {
        throw new Error('chrome.tabs 不可用，请确认在扩展弹窗内操作并授予权限');
      }
      
      const tabId = await this.getActivePageTabId();
      if (!tabId) {
        throw new Error('无法获取当前标签页');
      }
      
      // 确保内容脚本已就绪
      const ready = await this.ensureContentScriptReady(tabId);
      if (!ready) {
        throw new Error('内容脚本未就绪');
      }

      // 同步内容页的步骤状态：
      // - 新增用例（本地为空）：先检查content script中是否有步骤，如果有则保留，如果没有则清空
      // - 编辑用例（本地有步骤）：同步到内容页
      if (this.recordedSteps && this.recordedSteps.length > 0) {
        await this.sendMessageWithTimeout(tabId, { type: 'updateRecordedSteps', steps: this.recordedSteps }, 3000);
      } else {
        // 本地步骤为空时，直接清空content script中的步骤
        // 这样可以确保用户清空后，不会因为页面跳转或重新开始录制而恢复步骤
        console.log('🧹 本地步骤为空，清空content script中的步骤');
        await this.sendMessageWithTimeout(tabId, { type: 'clearRecording' }, 3000);
      }
      // 再发送开始录制消息
      const response = await this.sendMessageWithTimeout(tabId, { type: 'startRecording' }, 3000);
      console.log('startRecording response:', response);
      
      if (response && response.ok) {
        this.isRecording = true;
        this.recordingStartTime = Date.now();
        
        // 更新UI
        this.updateRecordStatus('正在录制...');
        this.updateRecordButtons();
        // 启动实时同步步骤（每 800ms 拉取一次）
        this.lastSyncedCount = this.recordedSteps.length;
        this.liveSyncTimer && clearInterval(this.liveSyncTimer);
        this.liveSyncTimer = setInterval(async () => {
          try {
            const currentTabId = await this.getActivePageTabId();
            if (!currentTabId || !this.isRecording) return;
            const resp = await this.sendMessageWithTimeout(currentTabId, { type: 'getRecordedSteps' }, 1500);
            if (resp && resp.ok && Array.isArray(resp.steps)) {
              if (resp.steps.length !== this.lastSyncedCount) {
                this.setRecordedSteps(resp.steps);
                this.updateStepsList();
                this.updateRecordCount();
                this.lastSyncedCount = resp.steps.length;
              }
            }
          } catch (_) {}
        }, 800);
        
        this.setStatus('录制已开始，请操作页面', true);
        console.log('✅ 录制启动成功');
      } else {
        throw new Error(response?.error || '录制启动失败');
      }
    } catch (error) {
      console.error('❌ 录制启动失败:', error);
      this.setStatus(`录制启动失败: ${error.message}`, false);
    }
  }

  /**
   * 停止录制
   */
  async stopRecording() {
    console.log('🛑 停止录制');
    
    if (!this.isRecording) {
      console.log('⚠️ 当前没有在录制');
      // 即使没有在录制，也清除storage中的录制状态和所有高亮
      try {
        await chrome.storage.local.set({ uiap_recording_state: false });
        // 向所有标签页发送清除高亮的消息
        const tabs = await chrome.tabs.query({});
        tabs.forEach(tab => {
          if (tab.id && tab.url && /^https?:/i.test(tab.url)) {
            chrome.tabs.sendMessage(tab.id, { type: 'clearAllHighlights' }).catch(() => {});
          }
        });
      } catch (e) {
        console.warn('清除录制状态失败:', e);
      }
      return;
    }
    
    try {
      this.setStatus('正在停止录制...', true);
      
      if (!(window && window.chrome && chrome.tabs)) {
        throw new Error('chrome.tabs 不可用');
      }
      
      // 向所有标签页发送停止录制消息，确保所有页面都停止录制
      const tabs = await chrome.tabs.query({});
      const stopPromises = tabs
        .filter(tab => tab.id && tab.url && /^https?:/i.test(tab.url))
        .map(tab => 
          chrome.tabs.sendMessage(tab.id, { type: 'stopRecording' }).catch(() => {
            // 忽略发送失败（可能是content script未加载）
            return { ok: true };
          })
        );
      
      await Promise.all(stopPromises);
      
      this.isRecording = false;
      if (this.liveSyncTimer) {
        clearInterval(this.liveSyncTimer);
        this.liveSyncTimer = null;
      }
      
      // 清除storage中的录制状态，防止页面刷新后自动恢复录制
      try {
        await chrome.storage.local.set({ uiap_recording_state: false });
      } catch (e) {
        console.warn('清除录制状态失败:', e);
      }
      
      // 更新UI
      this.updateRecordStatus('录制已停止');
      this.updateRecordButtons();
      
      this.setStatus('录制已停止', true);
      console.log('✅ 录制停止成功');
    } catch (error) {
      console.error('❌ 录制停止失败:', error);
      // 即使出错，也清除录制状态
      this.isRecording = false;
      try {
        await chrome.storage.local.set({ uiap_recording_state: false });
      } catch (e) {
        console.warn('清除录制状态失败:', e);
      }
      this.setStatus(`录制停止失败: ${error.message}`, false);
    }
  }

  /**
   * 清空步骤
   */
  clearSteps() {
    console.log('🗑️ 清空步骤');
    
    if (this.recordedSteps.length === 0) {
      this.setStatus('没有步骤需要清空', false);
      return;
    }
    
    // 使用自定义确认弹窗
    if (this.uiUtils && typeof this.uiUtils.showConfirm === 'function') {
      this.uiUtils.showConfirm(
        `确定要清空所有 ${this.recordedSteps.length} 个步骤吗？`,
        () => {
          this._performClearSteps();
        },
        () => {
          console.log('用户取消清空步骤');
        }
      );
      return;
    }
    
    // 降级到原生 confirm
    if (!confirm(`确定要清空所有 ${this.recordedSteps.length} 个步骤吗？`)) {
      return;
    }
    
    this._performClearSteps();
  }

  _performClearSteps() {
    this.recordedSteps = [];
    this.selectedSteps.clear();
    this.currentStepIndex = 0;
    this.undoStack = [];
    this.redoStack = [];
    
    // 更新UI
    this.updateStepsList();
    this.updateRecordCount();
    this.updateUndoRedoButtons();
    
    this.setStatus('步骤已清空', true);
    // 清空会话存储
    this.clearSessionSteps();
  }

  /**
   * 更新步骤列表
   */
  updateStepsList() {
    console.log('📝 更新步骤列表');
    console.log('📝 recordedSteps类型:', typeof this.recordedSteps);
    console.log('📝 recordedSteps是否为数组:', Array.isArray(this.recordedSteps));
    
    // 检查步骤数据
    if (this.recordedSteps.length === 0) {
      console.log('📝 检测到空步骤，这是正常的（新增用例时会添加默认步骤）');
    }
    
    const list = document.querySelector('#stepsList');
    if (!list) {
      console.error('❌ 找不到步骤列表元素 #stepsList');
      return;
    }
    
    if (this.recordedSteps.length === 0) {
      list.innerHTML = `
        <div class="empty-steps">
          <p><i class="fas fa-list"></i> 暂无操作步骤</p>
          <p>点击"开始录制"开始录制操作</p>
        </div>
      `;
      return;
    }
    
    let html = '';
    this.recordedSteps.forEach((step, index) => {
      const isSelected = this.selectedSteps.has(index);
      const desc = step.description || this.generateStepDescription(step.type, step.selector, step.value || step.text);
      html += `
        <div class="step-item ${isSelected ? 'selected' : ''}" data-step-index="${index}">
          <div class="step-header">
            <div class="step-select">
              <input type="checkbox" class="step-checkbox" data-step-index="${index}" ${isSelected ? 'checked' : ''}>
            </div>
            <div class="step-info">
              <div class="step-type">${this.getStepTypeIcon(step.type)}</div>
              <div class="step-description">${desc}</div>
            </div>
            <div class="step-actions">
              <button class="btn-up-step" data-step-index="${index}" title="上移"><i class="fas fa-arrow-up"></i></button>
              <button class="btn-down-step" data-step-index="${index}" title="下移"><i class="fas fa-arrow-down"></i></button>
              <button class="btn-edit-step" data-step-index="${index}" title="编辑步骤"><i class="fas fa-edit"></i></button>
              <button class="btn-delete-step" data-step-index="${index}" title="删除步骤"><i class="fas fa-trash"></i></button>
            </div>
          </div>
          <div class="step-details">
            <div class="step-selector">选择器: ${step.selector || '无'}</div>
            ${step.value ? `<div class="step-value">值: ${step.value}</div>` : ''}
          </div>
        </div>
      `;
    });
    
    list.innerHTML = html;
    
    // 绑定步骤事件
    this.bindStepEvents();

    // 同步多选高亮
    this.updateAllStepSelections();
    
    console.log('📝 步骤列表更新完成，共', this.recordedSteps.length, '个步骤');
  }

  /**
   * 绑定步骤事件
   */
  bindStepEvents() {
    // 勾选框：多选切换
    document.querySelectorAll('.step-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const stepIndex = parseInt(e.target.getAttribute('data-step-index'));
        if (e.target.checked) {
          this.selectedSteps.add(stepIndex);
        } else {
          this.selectedSteps.delete(stepIndex);
        }
        this.updateStepSelection(stepIndex);
      });
    });
    
    // 点击整行：多选切换（排除编辑/删除/上移/下移按钮与checkbox）
    document.querySelectorAll('.step-item .step-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const target = e.target;
        if (
          target.closest('.btn-edit-step') ||
          target.closest('.btn-delete-step') ||
          target.closest('.btn-up-step') ||
          target.closest('.btn-down-step') ||
          target.closest('.step-checkbox')
        ) return;
        const stepIndex = parseInt(header.parentElement.getAttribute('data-step-index'));
        if (this.selectedSteps.has(stepIndex)) {
          this.selectedSteps.delete(stepIndex);
        } else {
          this.selectedSteps.add(stepIndex);
        }
        this.updateStepSelection(stepIndex);
      });
    });
    
    // 编辑步骤
    document.querySelectorAll('.btn-edit-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const stepIndex = parseInt(e.currentTarget.getAttribute('data-step-index'));
        this.editStep(stepIndex);
      });
    });

    // 上移
    document.querySelectorAll('.btn-up-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const stepIndex = parseInt(e.currentTarget.getAttribute('data-step-index'));
        this.moveStepUp(stepIndex);
      });
    });

    // 下移
    document.querySelectorAll('.btn-down-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const stepIndex = parseInt(e.currentTarget.getAttribute('data-step-index'));
        this.moveStepDown(stepIndex);
      });
    });
    
    // 删除步骤
    document.querySelectorAll('.btn-delete-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const stepIndex = parseInt(e.currentTarget.getAttribute('data-step-index'));
        this.deleteStep(stepIndex);
      });
    });
  }

  /**
   * 更新步骤选择状态
   */
  updateStepSelection(stepIndex) {
    const stepItem = document.querySelector(`[data-step-index="${stepIndex}"]`);
    if (stepItem) {
      if (this.selectedSteps.has(stepIndex)) {
        stepItem.classList.add('selected');
        const cb = stepItem.querySelector('.step-checkbox');
        if (cb) cb.checked = true;
      } else {
        stepItem.classList.remove('selected');
        const cb = stepItem.querySelector('.step-checkbox');
        if (cb) cb.checked = false;
      }
    }
  }

  updateAllStepSelections() {
    document.querySelectorAll('.step-item').forEach(item => {
      const idx = parseInt(item.getAttribute('data-step-index'));
      if (this.selectedSteps.has(idx)) {
        item.classList.add('selected');
        const cb = item.querySelector('.step-checkbox');
        if (cb) cb.checked = true;
      } else {
        item.classList.remove('selected');
        const cb = item.querySelector('.step-checkbox');
        if (cb) cb.checked = false;
      }
    });
  }

  /**
   * 编辑步骤
   */
  editStep(stepIndex) {
    console.log('✏️ 编辑步骤:', stepIndex);
    
    const step = this.recordedSteps[stepIndex];
    if (!step) {
      console.error('❌ 步骤不存在:', stepIndex);
      return;
    }
    
    // 创建编辑对话框
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3><i class="fas fa-edit"></i> 编辑步骤</h3>
        <div class="form-group">
          <label>操作类型:</label>
          <select id="editStepType">
            <option value="click" ${step.type === 'click' ? 'selected' : ''}>点击</option>
            <option value="input" ${step.type === 'input' ? 'selected' : ''}>输入</option>
            <option value="wait" ${step.type === 'wait' ? 'selected' : ''}>等待</option>
            <option value="scroll" ${step.type === 'scroll' ? 'selected' : ''}>滚动</option>
          </select>
        </div>
        <div class="form-group">
          <label>选择器:</label>
          <input type="text" id="editStepSelector" value="${step.selector || ''}" placeholder="CSS选择器">
        </div>
        <div class="form-group">
          <label>值:</label>
          <input type="text" id="editStepValue" value="${step.value || ''}" placeholder="输入值或等待时间">
        </div>
        <div class="form-group">
          <label>描述:</label>
          <input type="text" id="editStepDescription" value="${step.description || ''}" placeholder="步骤描述">
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="saveStepBtn">保存</button>
          <button class="btn btn-secondary" id="cancelEditStepBtn">取消</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // 绑定事件
    document.getElementById('saveStepBtn').onclick = () => {
      const type = document.getElementById('editStepType').value;
      const selector = document.getElementById('editStepSelector').value.trim();
      const value = document.getElementById('editStepValue').value.trim();
      const description = document.getElementById('editStepDescription').value.trim();
      
      if (!selector && type !== 'wait') {
        this.setStatus('请输入选择器', false);
        return;
      }
      
      // 更新步骤
      this.recordedSteps[stepIndex] = {
        ...step,
        type,
        selector,
        value,
        description: description || this.generateStepDescription(type, selector, value)
      };
      
      // 更新UI
      this.updateStepsList();
      this.saveStepsToSession();
      
      // 关闭对话框
      document.body.removeChild(modal);
      
      this.setStatus('步骤已更新', true);
    };
    
    document.getElementById('cancelEditStepBtn').onclick = () => {
      document.body.removeChild(modal);
    };
  }

  /**
   * 删除步骤
   */
  deleteStep(stepIndex) {
    console.log('🗑️ 删除步骤:', stepIndex);
    
    const step = this.recordedSteps[stepIndex];
    if (!step) {
      console.error('❌ 步骤不存在:', stepIndex);
      return;
    }

    // 记录到undo栈
    this.undoStack.push({
      type: 'delete',
      stepIndex: stepIndex,
      step: JSON.parse(JSON.stringify(step)),
      selectedBefore: Array.from(this.selectedSteps)
    });
    
    // 清空redo栈（新操作后不能重做之前的操作）
    this.redoStack = [];
    
    // 删除步骤
    this.recordedSteps.splice(stepIndex, 1);
    this.selectedSteps.delete(stepIndex);
    
    // 更新UI
    this.updateStepsList();
    this.updateRecordCount();
    this.updateUndoRedoButtons();
    this.saveStepsToSession();
    
    this.setStatus('步骤已删除', true);
  }

  /**
   * 撤销操作
   */
  undo() {
    if (this.undoStack.length === 0) {
      this.setStatus('没有可撤销的操作', false);
      return;
    }
    
    const action = this.undoStack.pop();
    
    if (action.type === 'delete') {
      // 恢复删除的步骤
      const restoredStep = JSON.parse(JSON.stringify(action.step));
      this.recordedSteps.splice(action.stepIndex, 0, restoredStep);
      
      // 恢复选择状态
      this.selectedSteps = new Set(action.selectedBefore);
      
      // 记录到redo栈
      this.redoStack.push({
        type: 'delete',
        stepIndex: action.stepIndex,
        step: restoredStep,
        selectedBefore: Array.from(this.selectedSteps)
      });
      
      this.setStatus('已撤销删除操作', true);
    }
    
    // 更新UI
    this.updateStepsList();
    this.updateRecordCount();
    this.updateUndoRedoButtons();
    this.saveStepsToSession();
  }

  /**
   * 重做操作
   */
  redo() {
    if (this.redoStack.length === 0) {
      this.setStatus('没有可重做的操作', false);
      return;
    }
    
    const action = this.redoStack.pop();
    
    if (action.type === 'delete') {
      // 再次删除步骤
      const step = this.recordedSteps[action.stepIndex];
      if (step) {
        // 记录当前状态到undo栈
        this.undoStack.push({
          type: 'delete',
          stepIndex: action.stepIndex,
          step: JSON.parse(JSON.stringify(step)),
          selectedBefore: Array.from(this.selectedSteps)
        });
        
        // 删除步骤
        this.recordedSteps.splice(action.stepIndex, 1);
        this.selectedSteps.delete(action.stepIndex);
        
        this.setStatus('已重做删除操作', true);
      } else {
        // 步骤不存在，将action重新放回redo栈
        this.redoStack.push(action);
        this.setStatus('无法重做：步骤不存在', false);
        return;
      }
    }
    
    // 更新UI
    this.updateStepsList();
    this.updateRecordCount();
    this.updateUndoRedoButtons();
    this.saveStepsToSession();
  }

  /**
   * 更新撤销/重做按钮状态
   */
  updateUndoRedoButtons() {
    const undoBtn = document.getElementById('undoStep');
    const redoBtn = document.getElementById('redoStep');
    
    if (undoBtn) {
      undoBtn.disabled = this.undoStack.length === 0;
    }
    
    if (redoBtn) {
      redoBtn.disabled = this.redoStack.length === 0;
    }
  }

  moveStepUp(stepIndex) {
    if (stepIndex <= 0 || stepIndex >= this.recordedSteps.length) return;
    const tmp = this.recordedSteps[stepIndex - 1];
    this.recordedSteps[stepIndex - 1] = this.recordedSteps[stepIndex];
    this.recordedSteps[stepIndex] = tmp;
    this.rebuildSelectionAfterReorder(stepIndex, stepIndex - 1);
    this.updateStepsList();
    this.saveStepsToSession();
  }

  moveStepDown(stepIndex) {
    if (stepIndex < 0 || stepIndex >= this.recordedSteps.length - 1) return;
    const tmp = this.recordedSteps[stepIndex + 1];
    this.recordedSteps[stepIndex + 1] = this.recordedSteps[stepIndex];
    this.recordedSteps[stepIndex] = tmp;
    this.rebuildSelectionAfterReorder(stepIndex, stepIndex + 1);
    this.updateStepsList();
    this.saveStepsToSession();
  }

  rebuildSelectionAfterReorder(fromIdx, toIdx) {
    const newSelected = new Set();
    this.selectedSteps.forEach(idx => {
      if (idx === fromIdx) newSelected.add(toIdx);
      else if (idx === toIdx) newSelected.add(fromIdx);
      else newSelected.add(idx);
    });
    this.selectedSteps = newSelected;
  }

  openAddStepDialog() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3><i class="fas fa-plus"></i> 添加步骤</h3>
        <div class="form-group">
          <label>操作类型</label>
          <select id="newStepType">
            <option value="click">点击</option>
            <option value="input">输入</option>
            <option value="wait">等待</option>
            <option value="scroll">滚动</option>
            <option value="change">改变</option>
            <option value="submit">提交</option>
          </select>
        </div>
        <div class="form-group">
          <label>选择器</label>
          <input type="text" id="newStepSelector" placeholder="CSS选择器或 text=...">
        </div>
        <div class="form-group">
          <label>值</label>
          <input type="text" id="newStepValue" placeholder="输入值或等待毫秒">
        </div>
        <div class="form-group">
          <label>描述</label>
          <input type="text" id="newStepDescription" placeholder="步骤描述（可选）">
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="confirmAddStep">添加</button>
          <button class="btn btn-secondary" id="cancelAddStep">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => { if (modal && modal.parentNode) modal.parentNode.removeChild(modal); };

    modal.querySelector('#cancelAddStep').onclick = close;
    modal.querySelector('#confirmAddStep').onclick = () => {
      const type = modal.querySelector('#newStepType').value;
      const selector = modal.querySelector('#newStepSelector').value.trim();
      const value = modal.querySelector('#newStepValue').value.trim();
      const description = modal.querySelector('#newStepDescription').value.trim();

      const step = { type, selector, value, description: description || this.generateStepDescription(type, selector, value) };

      // 插入位置：选中则插到最后一个选中的后面；否则追加到末尾
      let insertIndex = this.recordedSteps.length;
      if (this.selectedSteps.size > 0) {
        insertIndex = Math.max(...Array.from(this.selectedSteps.values())) + 1;
      }
      this.recordedSteps.splice(insertIndex, 0, step);
      // 更新选择：新插入的设为选中
      this.selectedSteps.add(insertIndex);
      // 需要重建选中索引（插入后大于等于 insertIndex 的索引整体后移）
      const adjusted = new Set();
      this.selectedSteps.forEach(idx => {
        if (idx >= insertIndex && idx !== insertIndex) adjusted.add(idx + 1);
        else adjusted.add(idx);
      });
      this.selectedSteps = adjusted;

      this.updateStepsList();
      close();
      this.setStatus('已添加步骤', true);
    };
  }

  /**
   * 生成步骤描述
   */
  generateStepDescription(type, selector, value) {
    switch (type) {
      case 'click':
        return `点击 ${selector}`;
      case 'input':
        return `输入 "${value}" 到 ${selector}`;
      case 'wait':
        return `等待 ${value} 毫秒`;
      case 'scroll':
        return `滚动到 ${selector}`;
      default:
        return `${type} 操作`;
    }
  }

  /**
   * 获取步骤类型图标
   */
  getStepTypeIcon(type) {
    const iconMap = {
      'click': '<i class="fas fa-mouse-pointer"></i>',
      'input': '<i class="fas fa-keyboard"></i>',
      'change': '<i class="fas fa-exchange-alt"></i>',
      'submit': '<i class="fas fa-paper-plane"></i>',
      'wait': '<i class="fas fa-clock"></i>',
      'toggle': '<i class="fas fa-toggle-on"></i>',
      'scroll': '<i class="fas fa-arrows-alt-v"></i>',
      'setOptions': '<i class="fas fa-list"></i>'
    };
    return iconMap[type] || '<i class="fas fa-circle"></i>';
  }


  /**
   * 更新录制计数
   */
  updateRecordCount() {
    const countEl = document.querySelector('#recordCount');
    if (countEl) {
      countEl.textContent = `已录制 ${this.recordedSteps.length} 个操作`;
    }
  }

  /**
   * 更新录制状态
   */
  updateRecordStatus(status) {
    const statusEl = document.querySelector('#recordStatus');
    if (statusEl) {
      statusEl.textContent = status;
    }
  }

  /**
   * 更新录制按钮状态
   */
  updateRecordButtons() {
    const startBtn = document.querySelector('#startRecord');
    const stopBtn = document.querySelector('#stopRecord');
    
    if (startBtn) {
      startBtn.disabled = this.isRecording;
    }
    if (stopBtn) {
      stopBtn.disabled = !this.isRecording;
    }
  }

  /**
   * 设置录制的步骤
   */
  setRecordedSteps(steps) {
    this.recordedSteps = Array.isArray(steps) ? steps : [];
    this.selectedSteps.clear();
    this.currentStepIndex = 0;
    this.saveStepsToSession();
  }

  // 从存储恢复时使用：不触发再次持久化，避免 storage 监听循环写入
  setRecordedStepsFromStorage(steps) {
    this.recordedSteps = Array.isArray(steps) ? steps : [];
    this.selectedSteps.clear();
    this.currentStepIndex = 0;
  }

  /**
   * 获取录制的步骤
   */
  getRecordedSteps() {
    return this.recordedSteps;
  }

  /**
   * 清空录制的步骤
   */
  clearRecordedSteps() {
    this.recordedSteps = [];
    this.selectedSteps.clear();
    this.currentStepIndex = 0;
  }

  /**
   * 添加步骤
   */
  addStep(step) {
    this.recordedSteps.push({
      ...step,
      timestamp: new Date().toISOString()
    });
    this.updateStepsList();
    this.updateRecordCount();
    this.saveStepsToSession();
  }

  /**
   * 保存用例（委托给用例管理器）
   */
  saveCase() {
    if (this.caseManager) {
      this.caseManager.saveCase();
    }
  }

  /**
   * 取消录制
   */
  cancelRecord() {
    console.log('❌ 取消录制');
    
    if (this.isRecording) {
      this.stopRecording();
    }
    
    // 返回用例管理界面
    this.backToManagement();
  }

  /**
   * 返回用例管理
   */
  async backToManagement() {
    // 如果正在录制，自动停止录制
    if (this.isRecording) {
      await this.stopRecording();
    }
    
    if (this.caseManager) {
      this.caseManager.switchToCaseManagement();
    }
  }

  /**
   * 设置用例管理器引用
   */
  setCaseManager(caseManager) {
    this.caseManager = caseManager;
  }

  /**
   * 设置状态信息（需要外部实现）
   */
  setStatus(message, isSuccess) {
    // 这个方法需要由外部提供实现
    console.log(`📊 状态: ${message} (${isSuccess ? '成功' : '失败'})`);
  }
}

// 导出模块
// ES6 模块导出
export { RecordingManager };

// 兼容性导出（保持向后兼容）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RecordingManager;
} else {
  window.RecordingManager = RecordingManager;
}
