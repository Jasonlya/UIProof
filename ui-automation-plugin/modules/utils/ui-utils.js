/**
 * UI工具模块
 * 提供通用的UI操作和工具函数
 */

class UIUtils {
  constructor() {
    this.statusElement = null;
    this.init();
  }

  /**
   * 初始化
   */
  init() {
    this.statusElement = document.querySelector('#status');
  }

  /**
   * 查询选择器（简化版）
   */
  qs(selector) {
    return document.querySelector(selector);
  }

  /**
   * 查询所有选择器（简化版）
   */
  qsa(selector) {
    return document.querySelectorAll(selector);
  }

  /**
   * 设置状态信息
   */
  setStatus(message, isSuccess = true) {
    console.log(`📊 状态: ${message} (${isSuccess ? '成功' : '失败'})`);
    
    if (this.statusElement) {
      this.statusElement.textContent = message;
      this.statusElement.className = isSuccess ? 'status success' : 'status error';
      
      // 3秒后清除状态
      setTimeout(() => {
        if (this.statusElement) {
          this.statusElement.textContent = '';
          this.statusElement.className = 'status';
        }
      }, 3000);
    }
  }

  /**
   * 显示加载状态
   */
  showLoading(message = '加载中...') {
    this.setStatus(message, true);
  }

  /**
   * 显示成功状态
   */
  showSuccess(message) {
    this.setStatus(message, true);
  }

  /**
   * 显示错误状态
   */
  showError(message) {
    this.setStatus(message, false);
  }

  /**
   * 创建模态对话框
   */
  createModal(title, content, actions = []) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    
    const actionsHtml = actions.map(action => 
      `<button class="btn ${action.class || 'btn-secondary'}" id="${action.id}">${action.text}</button>`
    ).join('');
    
    modal.innerHTML = `
      <div class="modal-content">
        <h3>${title}</h3>
        <div class="modal-body">
          ${content}
        </div>
        <div class="modal-actions">
          ${actionsHtml}
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    return modal;
  }

  /**
   * 关闭模态对话框
   */
  closeModal(modal) {
    if (modal && modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
  }

  /**
   * 清理执行状态
   */
  async clearExecutionState() {
    try {
      // 停止执行
      try {
        await chrome.runtime.sendMessage({ type: 'stopExecution' });
      } catch (e) {
        console.warn('发送停止执行消息失败:', e);
      }
      
      // 清理执行状态和结果
      await chrome.storage.local.remove('uiap_execution_state');
      await chrome.storage.local.remove('uiap_execution_result');
      
      console.log('✅ 执行状态已清理');
    } catch (error) {
      console.warn('清理执行状态失败:', error);
    }
  }

  /**
   * 显示确认对话框
   */
  showConfirm(message, onConfirm, onCancel) {
    const modal = this.createModal('确认', `
      <p>${message}</p>
    `, [
      { id: 'confirmBtn', text: '确认', class: 'btn-primary' },
      { id: 'cancelBtn', text: '取消', class: 'btn-secondary' }
    ]);
    
    modal.querySelector('#confirmBtn').onclick = () => {
      this.closeModal(modal);
      if (onConfirm) onConfirm();
    };
    
    modal.querySelector('#cancelBtn').onclick = () => {
      this.closeModal(modal);
      if (onCancel) onCancel();
    };
    
    return modal;
  }

  /**
   * 显示输入对话框
   */
  showInput(title, placeholder = '', defaultValue = '', onConfirm, onCancel) {
    const modal = this.createModal(title, `
      <div class="form-group">
        <input type="text" id="inputValue" placeholder="${placeholder}" value="${defaultValue}">
      </div>
    `, [
      { id: 'confirmBtn', text: '确认', class: 'btn-primary' },
      { id: 'cancelBtn', text: '取消', class: 'btn-secondary' }
    ]);
    
    const input = modal.querySelector('#inputValue');
    input.focus();
    input.select();
    
    modal.querySelector('#confirmBtn').onclick = () => {
      const value = input.value.trim();
      this.closeModal(modal);
      if (onConfirm) onConfirm(value);
    };
    
    modal.querySelector('#cancelBtn').onclick = () => {
      this.closeModal(modal);
      if (onCancel) onCancel();
    };
    
    // 回车键确认
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const value = input.value.trim();
        this.closeModal(modal);
        if (onConfirm) onConfirm(value);
      }
    });
    
    return modal;
  }

  /**
   * 显示执行结果弹窗
   * @param {Object} result - 执行结果对象
   * @param {boolean} showStepDetails - 是否显示步骤详情（调试页面为true，主页面为false）
   */
  showExecutionResult(result, showStepDetails = false) {
    if (!result) {
      this.showError('执行结果数据为空');
      return;
    }

    const successCount = result.successCount || 0;
    const failCount = result.failCount || 0;
    const totalSteps = result.totalSteps || 0;
    const isSuccess = result.success !== false && failCount === 0;

    let content = '';
    
    if (showStepDetails) {
      // 调试页面：显示具体步骤信息
      content = `
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span>总步骤数: <strong>${totalSteps}</strong></span>
            <span style="color: #28a745;">成功: <strong>${successCount}</strong></span>
            <span style="color: ${failCount > 0 ? '#dc3545' : '#6c757d'};">失败: <strong>${failCount}</strong></span>
          </div>
        </div>
      `;

      if (result.results && result.results.length > 0) {
        const failedSteps = result.results.filter(r => !r.success);
        if (failedSteps.length > 0) {
          content += `
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e0e0;">
              <div style="font-weight: 600; margin-bottom: 8px; color: #dc3545;">失败的步骤:</div>
              <div style="max-height: 200px; overflow-y: auto;">
          `;
          
          failedSteps.forEach((failed, index) => {
            const stepNum = failed.stepIndex + 1;
            const stepDesc = failed.step ? 
              `${failed.step.type || '未知'}: ${failed.step.selector || failed.step.description || '无描述'}` : 
              '步骤信息缺失';
            content += `
              <div style="padding: 6px; margin-bottom: 4px; background: #fff5f5; border-left: 3px solid #dc3545; border-radius: 3px;">
                <div style="font-weight: 500; margin-bottom: 2px;">步骤 ${stepNum}: ${stepDesc}</div>
                <div style="font-size: 12px; color: #666;">错误: ${failed.message || '未知错误'}</div>
              </div>
            `;
          });
          
          content += `
              </div>
            </div>
          `;
        }
      }

      if (result.error) {
        content += `
          <div style="margin-top: 12px; padding: 8px; background: #fff5f5; border-left: 3px solid #dc3545; border-radius: 3px; color: #dc3545;">
            <strong>执行错误:</strong> ${result.error}
          </div>
        `;
      }

      if (result.interrupted) {
        content += `
          <div style="margin-top: 12px; padding: 8px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 3px; color: #856404;">
            <strong>执行中断</strong>于步骤 ${result.interruptedAt + 1}
          </div>
        `;
      }
    } else {
      // 主页面：只显示用例级别信息
      const totalCases = result.totalCases || 0;
      const caseSuccessCount = result.successCount || 0;
      const caseFailCount = result.failCount || 0;
      
      content = `
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between;">
            <span>总用例数: <strong>${totalCases}</strong></span>
            <span style="color: #28a745;">成功: <strong>${caseSuccessCount}</strong></span>
            <span style="color: ${caseFailCount > 0 ? '#dc3545' : '#6c757d'};">失败: <strong>${caseFailCount}</strong></span>
          </div>
        </div>
      `;

      if (result.failedCases && result.failedCases.length > 0) {
        content += `
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e0e0;">
            <div style="font-weight: 600; margin-bottom: 8px; color: #dc3545;">失败的用例:</div>
            <div style="max-height: 200px; overflow-y: auto;">
        `;
        
        result.failedCases.forEach((failedCase) => {
          content += `
            <div style="padding: 6px; margin-bottom: 4px; background: #fff5f5; border-left: 3px solid #dc3545; border-radius: 3px;">
              <div style="font-weight: 500; margin-bottom: 2px;">${failedCase.name}</div>
              <div style="font-size: 12px; color: #666;">${failedCase.reason || '执行失败'}</div>
            </div>
          `;
        });
        
        content += `
            </div>
          </div>
        `;
      }

      if (result.error) {
        content += `
          <div style="margin-top: 12px; padding: 8px; background: #fff5f5; border-left: 3px solid #dc3545; border-radius: 3px; color: #dc3545;">
            <strong>执行错误:</strong> ${result.error}
          </div>
        `;
      }
    }

    const modal = this.createModal(
      isSuccess ? '✅ 执行成功' : '❌ 执行失败',
      content,
      [
        { id: 'closeResultBtn', text: '关闭', class: 'btn-primary' }
      ]
    );

    modal.querySelector('#closeResultBtn').onclick = async () => {
      // 关闭弹窗时清理执行状态
      await this.clearExecutionState();
      this.closeModal(modal);
    };

    return modal;
  }

  /**
   * 显示选择对话框
   */
  showSelect(title, options = [], onConfirm, onCancel) {
    const optionsHtml = options.map(option => 
      `<option value="${option.value}">${option.text}</option>`
    ).join('');
    
    const modal = this.createModal(title, `
      <div class="form-group">
        <select id="selectValue">
          ${optionsHtml}
        </select>
      </div>
    `, [
      { id: 'confirmBtn', text: '确认', class: 'btn-primary' },
      { id: 'cancelBtn', text: '取消', class: 'btn-secondary' }
    ]);
    
    modal.querySelector('#confirmBtn').onclick = () => {
      const value = modal.querySelector('#selectValue').value;
      this.closeModal(modal);
      if (onConfirm) onConfirm(value);
    };
    
    modal.querySelector('#cancelBtn').onclick = () => {
      this.closeModal(modal);
      if (onCancel) onCancel();
    };
    
    return modal;
  }

  /**
   * 显示通知
   */
  showNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // 移除内联样式，使用CSS类样式
    document.body.appendChild(notification);
    
    // 自动移除（带淡出动画）
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 300);
      }
    }, duration);
    
    return notification;
  }

  /**
   * 显示成功通知
   */
  showSuccessNotification(message) {
    return this.showNotification(message, 'success');
  }

  /**
   * 显示错误通知
   */
  showErrorNotification(message) {
    return this.showNotification(message, 'error');
  }

  /**
   * 显示信息通知
   */
  showInfoNotification(message) {
    return this.showNotification(message, 'info');
  }

  /**
   * 格式化时间
   */
  formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * 格式化文件大小
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 防抖函数
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * 节流函数
   */
  throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  /**
   * 复制文本到剪贴板
   */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.showSuccessNotification('已复制到剪贴板');
      return true;
    } catch (error) {
      console.error('复制失败:', error);
      this.showErrorNotification('复制失败');
      return false;
    }
  }

  /**
   * 下载文件
   */
  downloadFile(content, filename, contentType = 'text/plain') {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * 读取文件
   */
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  }

  /**
   * 验证邮箱格式
   */
  validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  /**
   * 验证URL格式
   */
  validateURL(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 生成UUID
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 转义HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 取消转义HTML
   */
  unescapeHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }

  /**
   * 滚动到元素
   */
  scrollToElement(element, behavior = 'smooth') {
    if (element) {
      element.scrollIntoView({ behavior });
    }
  }

  /**
   * 滚动到顶部
   */
  scrollToTop(behavior = 'smooth') {
    window.scrollTo({ top: 0, behavior });
  }

  /**
   * 滚动到底部
   */
  scrollToBottom(behavior = 'smooth') {
    window.scrollTo({ top: document.body.scrollHeight, behavior });
  }
}

// 导出模块
// ES6 模块导出
export { UIUtils };

// 兼容性导出（保持向后兼容）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIUtils;
} else {
  window.UIUtils = UIUtils;
}
