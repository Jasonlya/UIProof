/**
 * 用例管理模块
 * 负责用例的CRUD操作和列表管理
 */

import {
  extensionPerfTracingStart,
  extensionPerfTracingStop,
} from '../perf/perf-client.js';
import { generatePerfReportHtml } from '../perf/perf-report.js';

class CaseManager {
  constructor() {
    this.casesList = [];
    this.currentEditingCase = null;
    this.selectedCases = new Set();
    this.SERVER_URL = window.APP_CONFIG?.SERVER_URL;
    // 批量执行用例时是否启用性能测试（由侧边栏勾选；可多选，每条用例单独按维度采集）
    this.enablePerfOnExecute = false;
    // 性能测试维度：'step'（默认按单步）或 'case'（整条用例）
    this.perfMode = 'step';
    /** @type {string|null} */
    this.lastPerfReportBlobUrl = null;
    /** 批量性能执行时收集各段 summary，用于 HTML 报告 */
    this._perfReportSegments = [];
    this._perfReportCollecting = false;
  }

  /**
   * 加载用例列表
   */
  async loadCasesList() {
    try {
      console.log('📋 开始加载用例列表...');
      this.setStatus('正在加载用例...', true);
      
      const params = new URLSearchParams({
        page: '1',
        per_page: '10',
        search: '',
        status: '',
        sort_by: 'created_at',
        sort_order: 'desc'
      });
      
      const response = await fetch(`${this.SERVER_URL}/api/cases?${params}`);
      const data = await response.json();
      
      if (response.ok) {
        this.casesList = data.cases || [];
        console.log('📋 用例列表加载成功:', this.casesList.length, '个用例');
        
        // 更新文件夹管理器的用例列表
        if (this.folderManager) {
          this.folderManager.setCasesList(this.casesList);
        }
        
        // 重新渲染树形结构
        if (this.folderManager) {
          this.folderManager.renderTreeView();
        }
        
        this.setStatus(`加载了 ${this.casesList.length} 个用例`, true);
      } else {
        console.error('❌ 加载用例失败:', data.error);
        this.setStatus(`加载用例失败: ${data.error}`, false);
        this.casesList = [];
      }
    } catch (error) {
      console.error('❌ 加载用例请求失败:', error);
      this.setStatus(`加载用例失败: ${error.message}`, false);
      this.casesList = [];
    }
  }

  /**
   * 编辑用例
   */
  async editCase(caseId) {
    console.log('📝 开始编辑用例:', caseId);
    console.log('📝 当前用例列表长度:', this.casesList.length);
    console.log('📝 查找用例ID:', caseId);
    
    const caseItem = this.casesList.find(c => c.case_id === caseId);
    if (!caseItem) {
      console.error('❌ 找不到用例:', caseId);
      this.setStatus('用例不存在', false);
      return;
    }
    
    console.log('📝 找到用例:', caseItem);
    
    try {
      this.setStatus('正在加载用例详情...', true);
      
      const response = await fetch(`${this.SERVER_URL}/api/cases/${caseId}`);
      const data = await response.json();
      
      if (response.ok) {
        // console.log('📝 用例详情加载成功:', data);
        
        // 设置当前编辑的用例并保留所属目录
        this.currentEditingCase = data;
        if (data && (data.folder_id !== undefined && data.folder_id !== null)) {
          this.targetFolderId = data.folder_id;
        }
        
        // 解析步骤数据
        let steps = [];
        if (data.steps) {
          try {
            steps = typeof data.steps === 'string' ? JSON.parse(data.steps) : data.steps;
            console.log('📝 解析步骤数据成功:', steps.length, '个步骤');
          } catch (parseError) {
            console.error('❌ 步骤数据解析失败:', parseError);
            steps = [];
          }
        }
        
        // console.log('📝 最终步骤数量:', steps.length);
        // console.log('📝 最终步骤数据:', steps);
        
        // 切换到录制界面（标题简化：去掉“用例”字样）
        this.switchToRecordingMode(`编辑: ${data.name}`);
        
        // 填充表单
        document.querySelector('#caseName').value = data.name;
        document.querySelector('#caseDescription').value = data.description || '';
        // 分类已移除
        document.querySelector('#caseTags').value = data.tags || '';
        document.querySelector('#caseStatus').value = data.status || 'active';
        
        // 更新录制步骤
        if (this.recordingManager) {
          this.recordingManager.setRecordedSteps(steps);
          this.recordingManager.updateStepsList();
          document.querySelector('#recordCount').textContent = `已录制 ${steps.length} 个操作`;
        }
        
        this.setStatus(`加载用例详情成功，共 ${steps.length} 个步骤`, true);
        console.log('✅ 编辑用例完成');
        
      } else {
        console.error('❌ 加载用例详情失败:', data.error);
        this.setStatus(`加载用例详情失败: ${data.error}`, false);
      }
    } catch (error) {
      console.error('❌ 加载用例详情请求失败:', error);
      this.setStatus(`加载用例详情失败: ${error.message}`, false);
    }
  }

  /**
   * 保存用例
   */
  async saveCase() {
    console.log('💾 开始保存用例...');
    
    const caseData = {
      name: document.querySelector('#caseName').value.trim(),
      description: document.querySelector('#caseDescription').value.trim(),
      // 分类已移除
      tags: document.querySelector('#caseTags').value.trim(),
      status: document.querySelector('#caseStatus').value,
      steps: this.recordingManager ? JSON.stringify(this.recordingManager.getRecordedSteps()) : '[]',
      folder_id: this.targetFolderId || null
    };
    
    console.log('💾 用例数据:', caseData);
    
    // 验证用例数据
    if (!caseData.name) {
      this.setStatus('请输入用例名称', false);
      return;
    }
    
    if (!this.recordingManager || this.recordingManager.getRecordedSteps().length === 0) {
      this.setStatus('没有有效的操作步骤', false);
      return;
    }
    
    try {
      this.setStatus('正在保存用例...', true);
      
      let response;
      if (this.currentEditingCase) {
        // 更新现有用例
        console.log('💾 更新现有用例:', this.currentEditingCase.case_id);
        response = await fetch(`${this.SERVER_URL}/api/cases/${this.currentEditingCase.case_id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(caseData)
        });
      } else {
        // 创建新用例
        console.log('💾 创建新用例');
        response = await fetch(`${this.SERVER_URL}/api/cases`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(caseData)
        });
      }
      
      const data = await response.json();
      
      if (response.ok) {
        console.log('💾 用例保存成功:', data);
        this.setStatus('用例保存成功', true);
        
        // 如果正在录制，自动停止录制
        if (this.recordingManager && this.recordingManager.isRecording) {
          await this.recordingManager.stopRecording();
        }
        
        // 重新加载用例列表
        await this.loadCasesList();
        
        // 清空会话内步骤，避免下一次进入遗留
        if (this.recordingManager && typeof this.recordingManager.clearSessionSteps === 'function') {
          this.recordingManager.clearSessionSteps();
        }
        // 返回用例管理界面
        this.switchToCaseManagement();
        
      } else {
        console.error('❌ 用例保存失败:', data.error);
        this.setStatus(`用例保存失败: ${data.error}`, false);
      }
    } catch (error) {
      console.error('❌ 用例保存请求失败:', error);
      this.setStatus(`用例保存失败: ${error.message}`, false);
    }
  }

  /**
   * 删除用例
   */
  async deleteCase(caseId) {
    console.log('🗑️ 删除用例:', caseId);
    
    const caseItem = this.casesList.find(c => c.case_id === caseId);
    if (!caseItem) {
      console.error('❌ 找不到用例:', caseId);
      return;
    }
    
    // 使用自定义确认弹窗
    if (this.uiUtils && typeof this.uiUtils.showConfirm === 'function') {
      this.uiUtils.showConfirm(
        `确定要删除用例"${caseItem.name}"吗？`,
        async () => {
          await this._performDeleteCase(caseId);
        },
        () => {
          console.log('🗑️ 用户取消删除');
        }
      );
      return;
    }
    
    // 降级到原生 confirm
    if (!confirm(`确定要删除用例"${caseItem.name}"吗？`)) {
      console.log('🗑️ 用户取消删除');
      return;
    }
    
    await this._performDeleteCase(caseId);
  }

  async _performDeleteCase(caseId) {
    try {
      this.setStatus('正在删除用例...', true);
      
      const response = await fetch(`${this.SERVER_URL}/api/cases/${caseId}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (response.ok) {
        console.log('🗑️ 用例删除成功:', data.message);
        this.setStatus('用例已删除', true);
        
        // 重新加载用例列表
        await this.loadCasesList();
        
      } else {
        console.error('❌ 用例删除失败:', data.error);
        this.setStatus(`用例删除失败: ${data.error}`, false);
      }
    } catch (error) {
      console.error('❌ 用例删除请求失败:', error);
      this.setStatus(`用例删除失败: ${error.message}`, false);
    }
  }

  /**
   * 批量执行用例
   */
  async batchExecuteCases() {
    if (this.selectedCases.size === 0) {
      this.setStatus('请选择要执行的用例', false);
      return;
    }
    
    // 使用自定义确认弹窗
    if (this.uiUtils && typeof this.uiUtils.showConfirm === 'function') {
      this.uiUtils.showConfirm(
        `确定要执行选中的 ${this.selectedCases.size} 个用例吗？`,
        async () => {
          await this._performBatchExecute();
        },
        () => {
          console.log('用户取消批量执行');
        }
      );
      return;
    }
    
    // 降级到原生 confirm
    if (!confirm(`确定要执行选中的 ${this.selectedCases.size} 个用例吗？`)) {
      return;
    }
    
    await this._performBatchExecute();
  }

  async _performBatchExecute() {
    try {
      this.setStatus('正在批量执行用例...', true);
      
      // 更新执行按钮为执行中状态
      this.setExecutionButtonState(true);
      
      const selectedCaseIds = Array.from(this.selectedCases);
      const perfEnabled = !!this.enablePerfOnExecute;
      const perfMode = this.perfMode || 'step'; // 'step' | 'case'
      this._perfReportCollecting = perfEnabled;
      if (perfEnabled) {
        this._perfReportSegments = [];
        if (this.lastPerfReportBlobUrl) {
          try {
            URL.revokeObjectURL(this.lastPerfReportBlobUrl);
          } catch (_) {}
          this.lastPerfReportBlobUrl = null;
        }
      }
      let successCount = 0;
      let failCount = 0;
      const failedCases = [];
      
      for (let i = 0; i < selectedCaseIds.length; i++) {
        const caseId = selectedCaseIds[i];
        const caseItem = this.casesList.find(c => c.case_id === caseId);
        
        if (!caseItem) {
          console.warn(`⚠️ 用例不存在: ${caseId}`);
          failCount++;
          failedCases.push({ name: `用例(${caseId})`, reason: '用例不存在' });
          continue;
        }
        
        try {
          this.setStatus(`正在执行用例 ${i + 1}/${selectedCaseIds.length}: ${caseItem.name}`, true);
          
          const caseDetail = await this.getCaseDetail(caseId);
          if (!caseDetail || !caseDetail.steps) {
            console.warn(`⚠️ 用例无步骤: ${caseItem.name}`);
            failCount++;
            failedCases.push({ name: caseItem.name, reason: '用例无步骤' });
            continue;
          }
          
          let steps = [];
          try {
            steps = typeof caseDetail.steps === 'string' 
              ? JSON.parse(caseDetail.steps) 
              : caseDetail.steps;
          } catch (e) {
            console.error(`❌ 解析用例步骤失败: ${caseItem.name}`, e);
            failCount++;
            failedCases.push({ name: caseItem.name, reason: '解析步骤失败' });
            continue;
          }
          
          if (!Array.isArray(steps) || steps.length === 0) {
            console.warn(`⚠️ 用例步骤为空: ${caseItem.name}`);
            failCount++;
            failedCases.push({ name: caseItem.name, reason: '用例步骤为空' });
            continue;
          }

          // 开启性能测试时：每条用例单独按维度采集（整条用例 / 单步），可多选批量依次执行
          if (perfEnabled) {
            try {
              if (perfMode === 'case') {
                await this._executeCaseWithPerfWholeCase(caseItem, steps);
                console.log(`✅ 用例执行成功(整条用例性能采集): ${caseItem.name}`);
              } else {
                await this._executeCaseStepsWithPerfPerStep(caseItem, steps);
                console.log(`✅ 用例执行成功(按单步性能采集): ${caseItem.name}`);
              }
              successCount++;
              await fetch(`${this.SERVER_URL}/api/cases/${caseId}/execute`, { method: 'POST' });
            } catch (error) {
              failCount++;
              failedCases.push({ name: caseItem.name, reason: error.message || '执行异常(性能模式)' });
              console.error(`❌ 用例执行失败(性能模式): ${caseItem.name}`, error);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          
          const tabId = await this.getActivePageTabId();
          if (!tabId) {
            throw new Error('无法获取当前标签页');
          }
          
          // 清理之前的执行状态，确保每次执行都是干净的开始
          try {
            const previousState = await chrome.storage.local.get('uiap_execution_state');
            if (previousState.uiap_execution_state && previousState.uiap_execution_state.isExecuting) {
              console.log('⚠️ 检测到之前的执行状态，正在清理...');
              await chrome.runtime.sendMessage({ type: 'stopExecution' });
              await chrome.storage.local.remove('uiap_execution_state');
              await chrome.storage.local.remove('uiap_execution_result');
              // 等待一下确保状态清理完成
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          } catch (cleanupError) {
            console.warn('清理执行状态失败:', cleanupError);
            // 继续执行，不阻塞
          }
          
          const response = await chrome.runtime.sendMessage({
            type: 'startExecution',
            steps: steps,
            intervalMs: 500,
            tabId: tabId
          });
          
          if (response && response.ok) {
            // 等待执行完成
            let executionCompleted = false;
            let executionResult = null;
            const maxWaitTime = 300000; // 最多等待5分钟
            const startTime = Date.now();
            
            while (!executionCompleted && (Date.now() - startTime) < maxWaitTime) {
              await new Promise(resolve => setTimeout(resolve, 500));
              
              const state = await chrome.storage.local.get('uiap_execution_state');
              if (!state.uiap_execution_state || !state.uiap_execution_state.isExecuting) {
                executionCompleted = true;
                
                // 获取执行结果
                const resultData = await chrome.storage.local.get('uiap_execution_result');
                executionResult = resultData.uiap_execution_result;
                
                // 清理执行状态和结果数据
                await chrome.storage.local.remove('uiap_execution_state');
                await chrome.storage.local.remove('uiap_execution_result');
                break;
              }
            }
            
            // 如果超时，确保清理执行状态
            if (!executionCompleted) {
              console.warn('⚠️ 执行等待超时，清理执行状态');
              try {
                await chrome.runtime.sendMessage({ type: 'stopExecution' });
                await chrome.storage.local.remove('uiap_execution_state');
                await chrome.storage.local.remove('uiap_execution_result');
              } catch (cleanupError) {
                console.warn('清理执行状态失败:', cleanupError);
              }
            }
            
            if (executionResult && !executionResult.success) {
              failCount++;
              failedCases.push({ name: caseItem.name, reason: `执行失败: ${executionResult.failCount}个步骤失败` });
              console.error(`❌ 用例执行失败: ${caseItem.name}`);
            } else {
              successCount++;
              console.log(`✅ 用例执行成功: ${caseItem.name}`);
              
              await fetch(`${this.SERVER_URL}/api/cases/${caseId}/execute`, {
                method: 'POST'
              });
            }
          } else {
            failCount++;
            failedCases.push({ name: caseItem.name, reason: response?.message || '启动执行失败' });
            console.error(`❌ 用例执行失败: ${caseItem.name}`, response?.message);
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          failCount++;
          failedCases.push({ name: caseItem.name, reason: error.message || '执行异常' });
          console.error(`❌ 执行用例失败: ${caseItem.name}`, error);
        }
      }

      this._perfReportCollecting = false;
      if (
        perfEnabled &&
        this._perfReportSegments &&
        this._perfReportSegments.length > 0 &&
        typeof window !== 'undefined'
      ) {
        try {
          const reportTitle =
            selectedCaseIds.length > 1
              ? `UI 性能测试报告（${selectedCaseIds.length} 条用例）`
              : 'UI 性能测试报告';
          const html = generatePerfReportHtml({
            title: reportTitle,
            perfMode: perfMode === 'case' ? '整条用例' : '单步',
            segments: this._perfReportSegments,
            generatedAt: new Date().toLocaleString(),
          });
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          if (this.lastPerfReportBlobUrl) {
            try {
              URL.revokeObjectURL(this.lastPerfReportBlobUrl);
            } catch (_) {}
          }
          this.lastPerfReportBlobUrl = URL.createObjectURL(blob);
          window.dispatchEvent(
            new CustomEvent('uiap-perf-report', { detail: { url: this.lastPerfReportBlobUrl } })
          );
          if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({ url: this.lastPerfReportBlobUrl });
          }
        } catch (repErr) {
          console.warn('生成性能 HTML 报告失败:', repErr);
        }
      }
      
      this.setStatus(`批量执行完成: 成功 ${successCount} 个，失败 ${failCount} 个`, successCount > 0);
      
      // 显示执行结果弹窗（主页面，不显示步骤详情）
      if (this.uiUtils && (successCount > 0 || failCount > 0)) {
        const batchResult = {
          success: failCount === 0,
          totalCases: selectedCaseIds.length,
          successCount: successCount,
          failCount: failCount,
          failedCases: failedCases
        };
        
        setTimeout(() => {
          this.uiUtils.showExecutionResult(batchResult, false);
        }, 500);
      }
      
      // 不清空选中的用例，保持选中状态以便再次执行
      // this.selectedCases.clear();
      
      // 确保 checkbox 状态与 selectedCases 同步
      this.selectedCases.forEach(caseId => {
        const checkbox = document.querySelector(`.case-checkbox[data-case-id="${caseId}"]`);
        if (checkbox && !checkbox.checked) {
          checkbox.checked = true;
        }
      });
      
      // 恢复执行按钮状态
      this.setExecutionButtonState(false);
      this.updateBatchButtons();
    } catch (error) {
      this._perfReportCollecting = false;
      console.error('❌ 批量执行失败:', error);
      this.setStatus(`批量执行失败: ${error.message}`, false);
      
      // 恢复执行按钮状态
      this.setExecutionButtonState(false);
      this.updateBatchButtons();
    }
  }
  
  /**
   * 按「单步维度」执行：每步通过扩展内 perf 模块（CDP Tracing.start 轻量类别，start/stop 区间）
   */
  async _executeCaseStepsWithPerfPerStep(caseItem, steps) {
    const tabId = await this.getActivePageTabId();
    if (!tabId) {
      throw new Error('无法获取当前标签页');
    }

    for (let idx = 0; idx < steps.length; idx++) {
      const step = steps[idx];
      let perfActive = false;

      try {
        try {
          const startData = await extensionPerfTracingStart(tabId);
          if (startData && startData.ok) {
            perfActive = true;
            console.log(`📊 第 ${idx + 1} 步性能 tracing 已启动`);
          } else {
            console.warn(`⚠️ 第 ${idx + 1} 步启动性能 tracing 失败:`, startData?.error || startData);
          }
        } catch (e) {
          console.warn(`⚠️ 第 ${idx + 1} 步调用性能模块失败:`, e);
        }

        try {
          const previousState = await chrome.storage.local.get('uiap_execution_state');
          if (previousState.uiap_execution_state && previousState.uiap_execution_state.isExecuting) {
            console.log('⚠️ 检测到之前的执行状态，正在清理(单步模式)...');
            await chrome.runtime.sendMessage({ type: 'stopExecution' });
            await chrome.storage.local.remove('uiap_execution_state');
            await chrome.storage.local.remove('uiap_execution_result');
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (cleanupError) {
          console.warn('清理执行状态失败(单步模式):', cleanupError);
        }

        const response = await chrome.runtime.sendMessage({
          type: 'startExecution',
          steps: [step],
          intervalMs: 0,
          tabId: tabId
        });

        if (response && response.ok) {
          let executionCompleted = false;
          let executionResult = null;
          const maxWaitTime = 60000;
          const startTime = Date.now();

          while (!executionCompleted && (Date.now() - startTime) < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, 300));

            const state = await chrome.storage.local.get('uiap_execution_state');
            if (!state.uiap_execution_state || !state.uiap_execution_state.isExecuting) {
              executionCompleted = true;

              const resultData = await chrome.storage.local.get('uiap_execution_result');
              executionResult = resultData.uiap_execution_result;

              await chrome.storage.local.remove('uiap_execution_state');
              await chrome.storage.local.remove('uiap_execution_result');
              break;
            }
          }

          if (!executionCompleted) {
            console.warn('⚠️ 单步执行等待超时，清理执行状态');
            try {
              await chrome.runtime.sendMessage({ type: 'stopExecution' });
              await chrome.storage.local.remove('uiap_execution_state');
              await chrome.storage.local.remove('uiap_execution_result');
            } catch (cleanupError) {
              console.warn('清理执行状态失败(单步超时):', cleanupError);
            }
          }

          if (executionResult && !executionResult.success) {
            console.error(`❌ 第 ${idx + 1} 步执行失败`, executionResult);
            throw new Error(`第 ${idx + 1} 步执行失败`);
          } else {
            console.log(`✅ 第 ${idx + 1} 步执行成功`);
          }
        } else {
          console.error(`❌ 第 ${idx + 1} 步启动执行失败`, response?.message);
          throw new Error(`第 ${idx + 1} 步启动执行失败`);
        }
      } finally {
        if (perfActive) {
          try {
            const data = await extensionPerfTracingStop(tabId);
            if (data && data.ok) {
              const summary = data.summary || {};
              console.log(`📊 第 ${idx + 1} 步性能 summary:`, summary);
              this.appendPerfResultSummary(
                summary,
                `用例「${caseItem.name}」步骤 ${idx + 1}`
              );
            } else {
              console.warn(`⚠️ 第 ${idx + 1} 步停止性能 tracing 失败:`, data?.error || data);
            }
          } catch (e) {
            console.warn(`⚠️ 第 ${idx + 1} 步停止性能 tracing 失败:`, e);
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  /**
   * 按「整条用例」维度：一次采集区间包住全部步骤（扩展内 perf 模块）
   */
  async _executeCaseWithPerfWholeCase(caseItem, steps) {
    const tabId = await this.getActivePageTabId();
    if (!tabId) {
      throw new Error('无法获取当前标签页');
    }

    let perfActive = false;
    try {
      try {
        const startData = await extensionPerfTracingStart(tabId);
        if (startData && startData.ok) {
          perfActive = true;
            console.log('📊 整条用例性能 tracing 已启动');
        } else {
            console.warn('⚠️ 整条用例启动性能 tracing 失败:', startData?.error || startData);
        }
      } catch (e) {
        console.warn('⚠️ 整条用例调用性能模块失败:', e);
      }

      try {
        const previousState = await chrome.storage.local.get('uiap_execution_state');
        if (previousState.uiap_execution_state && previousState.uiap_execution_state.isExecuting) {
          console.log('⚠️ 检测到之前的执行状态，正在清理(整条用例性能模式)...');
          await chrome.runtime.sendMessage({ type: 'stopExecution' });
          await chrome.storage.local.remove('uiap_execution_state');
          await chrome.storage.local.remove('uiap_execution_result');
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (cleanupError) {
        console.warn('清理执行状态失败(整条用例性能模式):', cleanupError);
      }

      const response = await chrome.runtime.sendMessage({
        type: 'startExecution',
        steps: steps,
        intervalMs: 500,
        tabId: tabId
      });

      if (response && response.ok) {
        let executionCompleted = false;
        let executionResult = null;
        const maxWaitTime = 300000;
        const startTime = Date.now();

        while (!executionCompleted && (Date.now() - startTime) < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, 500));

          const state = await chrome.storage.local.get('uiap_execution_state');
          if (!state.uiap_execution_state || !state.uiap_execution_state.isExecuting) {
            executionCompleted = true;

            const resultData = await chrome.storage.local.get('uiap_execution_result');
            executionResult = resultData.uiap_execution_result;

            await chrome.storage.local.remove('uiap_execution_state');
            await chrome.storage.local.remove('uiap_execution_result');
            break;
          }
        }

        if (!executionCompleted) {
          console.warn('⚠️ 整条用例执行等待超时，清理执行状态');
          try {
            await chrome.runtime.sendMessage({ type: 'stopExecution' });
            await chrome.storage.local.remove('uiap_execution_state');
            await chrome.storage.local.remove('uiap_execution_result');
          } catch (cleanupError) {
            console.warn('清理执行状态失败(整条用例超时):', cleanupError);
          }
        }

        if (executionResult && !executionResult.success) {
          console.error('❌ 整条用例执行失败(性能模式)', executionResult);
          throw new Error('整条用例执行失败');
        } else {
          console.log('✅ 整条用例执行成功(性能模式)');
        }
      } else {
        console.error('❌ 整条用例启动执行失败(性能模式)', response?.message);
        throw new Error('整条用例启动执行失败');
      }
    } finally {
      if (perfActive) {
        try {
          const data = await extensionPerfTracingStop(tabId);
          if (data && data.ok) {
            const summary = data.summary || {};
            console.log('📊 整条用例性能 summary:', summary);
            this.appendPerfResultSummary(summary, `用例「${caseItem.name}」整条用例`);
          } else {
            console.warn('⚠️ 整条用例停止性能 tracing 失败:', data?.error || data);
          }
        } catch (e) {
          console.warn('⚠️ 整条用例停止性能 tracing 失败:', e);
        }
      }
    }
  }
  
  /**
   * 追加一行性能结果到插件 UI 面板（纯文本）
   */
  _appendPerfResultLine(text) {
    try {
      const container = document.querySelector('#perfResultBody');
      if (!container) return;
      const empty = container.querySelector('.empty-state');
      if (empty) empty.remove();
      const lineEl = document.createElement('div');
      lineEl.className = 'perf-line';
      const ts = new Date().toLocaleTimeString();
      lineEl.innerHTML = `<span class="timestamp">[${ts}]</span>${text}`;
      container.appendChild(lineEl);
      container.scrollTop = container.scrollHeight;
    } catch (e) {
      console.warn('追加性能结果行失败:', e);
    }
  }

  /**
   * 展示一次采集的摘要：含每条带 dur 的 trace 事件耗时（毫秒），按耗时降序
   * @param {Object} summary - background 返回：totalEvents, durationEvents[{name,cat,durMs}], durationTotalWithDur, durationTruncated
   * @param {string} headingText - 标题（如用例名 + 步骤说明）
   */
  appendPerfResultSummary(summary, headingText) {
    try {
      const container = document.querySelector('#perfResultBody');
      if (!container) return;
      const empty = container.querySelector('.empty-state');
      if (empty) empty.remove();

      const block = document.createElement('div');
      block.className = 'perf-result-block';
      const ts = new Date().toLocaleTimeString();

      const head = document.createElement('div');
      head.className = 'perf-result-heading';
      const timeSpan = document.createElement('span');
      timeSpan.className = 'timestamp';
      timeSpan.textContent = `[${ts}]`;
      head.appendChild(timeSpan);
      head.appendChild(document.createTextNode(headingText || '性能采集'));
      block.appendChild(head);

      const total = summary && summary.totalEvents != null ? summary.totalEvents : 0;
      const withDurCount =
        summary && summary.durationTotalWithDur != null
          ? summary.durationTotalWithDur
          : (summary && summary.durationEvents ? summary.durationEvents.length : 0);
      const meta = document.createElement('div');
      meta.className = 'perf-result-meta';
      if (summary && summary.collectionMode === 'Performance.getMetrics') {
        meta.textContent = `CDP Performance 指标项 ${total}（区间差值）；画布相关见 P0/P1/P2 表`;
      } else {
        meta.textContent = `trace 事件总数 ${total}；含耗时(dur)（P0/P1/P2 关键词命中） ${withDurCount} 条`;
      }
      block.appendChild(meta);

      if (summary && summary.perfNote) {
        const perfNoteEl = document.createElement('div');
        perfNoteEl.className = 'perf-result-note';
        perfNoteEl.textContent = summary.perfNote;
        block.appendChild(perfNoteEl);
      }

      if (summary && summary.perfDiagnostic) {
        const diagEl = document.createElement('div');
        diagEl.className = 'perf-result-note';
        diagEl.textContent = summary.perfDiagnostic;
        block.appendChild(diagEl);
      }

      if (summary && summary.perfMetrics) {
        const pm = summary.perfMetrics;
        const tiers = [
          {
            key: 'p0',
            label: 'P0 画布/主线程',
            hint: 'DroppedFrame、Canvas2D、Paint、CompositeLayers',
          },
          {
            key: 'p1',
            label: 'P1 脚本/内存',
            hint: 'V8.Execute、RunTask、FunctionCall、GCEvent、UpdateLayerTree',
          },
          {
            key: 'p2',
            label: 'P2 样式/DOM',
            hint: 'EventDispatch、InputEvent、TimerFire、Layout、Scroll、Resize、EvaluateScript',
          },
        ];
        for (let t = 0; t < tiers.length; t++) {
          const tier = tiers[t];
          const list = pm[tier.key] || [];
          const tierTitle = document.createElement('div');
          tierTitle.className = 'perf-tier-title';
          tierTitle.textContent = `${tier.label}（${tier.hint}）`;
          block.appendChild(tierTitle);
          const pmTable = document.createElement('div');
          pmTable.className = 'perf-event-table perf-metrics-table';
          if (!list.length) {
            const emptyRow = document.createElement('div');
            emptyRow.className = 'perf-event-row perf-event-empty';
            emptyRow.textContent =
              '本段无命中：trace 中无上述关键词名称且含 dur 的切片（或名称与 Chrome 实际命名不一致）。';
            pmTable.appendChild(emptyRow);
          } else {
            for (let i = 0; i < list.length; i++) {
              const row = list[i];
              const rowEl = document.createElement('div');
              rowEl.className = 'perf-event-row';
              const vEl = document.createElement('span');
              vEl.className = 'perf-dur';
              vEl.textContent = row.display != null ? row.display : String(row.totalMs ?? '');
              const nEl = document.createElement('span');
              nEl.className = 'perf-name';
              nEl.textContent = row.name || '';
              const pad = document.createElement('span');
              pad.className = 'perf-cat';
              pad.textContent = '';
              rowEl.appendChild(vEl);
              rowEl.appendChild(nEl);
              rowEl.appendChild(pad);
              pmTable.appendChild(rowEl);
            }
          }
          block.appendChild(pmTable);
        }
      }

      if (summary && summary.durationTruncated) {
        const note = document.createElement('div');
        note.className = 'perf-result-note';
        note.textContent = `仅展示耗时最长的前 ${(summary.durationEvents || []).length} 条（按 dur 降序）`;
        block.appendChild(note);
      }

      const table = document.createElement('div');
      table.className = 'perf-event-table';
      const rows = (summary && summary.durationEvents) || [];
      if (summary && summary.collectionMode === 'Performance.getMetrics') {
        const skipRow = document.createElement('div');
        skipRow.className = 'perf-event-row perf-event-empty';
        skipRow.textContent =
          '当前为 Performance.getMetrics 模式，无逐条 dur 事件表；请看上方 P0/P1/P2 的指标汇总。';
        table.appendChild(skipRow);
      } else if (rows.length === 0) {
        const emptyRow = document.createElement('div');
        emptyRow.className = 'perf-event-row perf-event-empty';
        emptyRow.textContent =
          total > 0
            ? '本段 trace 虽然存在 dur 事件，但没有命中 P0/P1/P2 关键词（明细表已过滤去噪）；可直接看上方 P0/P1/P2 汇总。'
            : '本段未解析到任何 trace 事件；请查看上方「stream / dataCollected」诊断行。若曾切换标签页，请重新「开始」后再「停止」。';
        table.appendChild(emptyRow);
      } else {
        for (let i = 0; i < rows.length; i++) {
          const ev = rows[i];
          const row = document.createElement('div');
          row.className = 'perf-event-row';
          const durEl = document.createElement('span');
          durEl.className = 'perf-dur';
          durEl.textContent =
            typeof ev.durMs === 'number' ? `${ev.durMs.toFixed(3)} ms` : '—';
          const nameEl = document.createElement('span');
          nameEl.className = 'perf-name';
          nameEl.textContent = ev.name || '';
          nameEl.title = ev.cat || '';
          const catEl = document.createElement('span');
          catEl.className = 'perf-cat';
          catEl.textContent = ev.cat || '';
          row.appendChild(durEl);
          row.appendChild(nameEl);
          row.appendChild(catEl);
          table.appendChild(row);
        }
      }
      block.appendChild(table);
      container.appendChild(block);
      container.scrollTop = container.scrollHeight;

      if (this._perfReportCollecting && summary) {
        try {
          this._perfReportSegments.push({
            heading: headingText || '性能采集',
            summary: JSON.parse(JSON.stringify(summary)),
          });
        } catch (_) {
          this._perfReportSegments.push({ heading: headingText || '性能采集', summary: { ...summary } });
        }
      }
    } catch (e) {
      console.warn('追加性能摘要失败:', e);
    }
  }
  
  /**
   * 获取当前活动标签页ID
   */
  async getActivePageTabId() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0 && tabs[0].id) {
        return tabs[0].id;
      }
      
      const allTabs = await chrome.tabs.query({});
      const httpTab = allTabs.find(t => t.id && t.url && /^https?:/i.test(t.url));
      return httpTab ? httpTab.id : null;
    } catch (error) {
      console.error('❌ 获取标签页ID失败:', error);
      return null;
    }
  }
  
  /**
   * 获取用例详情
   */
  async getCaseDetail(caseId) {
    try {
      const response = await fetch(`${this.SERVER_URL}/api/cases/${caseId}`);
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error('❌ 获取用例详情失败:', error);
      return null;
    }
  }

  /**
   * 批量删除用例
   */
  async batchDeleteCases() {
    // 获取所有文件夹checkbox（包括checked和indeterminate的）
    const allFolderCheckboxes = document.querySelectorAll('.folder-checkbox');
    // 只选择完全选中的文件夹（checked=true 且 indeterminate=false）
    const selectedFolderCheckboxes = Array.from(allFolderCheckboxes).filter(cb => 
      cb.checked && !cb.indeterminate
    );
    
    // 获取所有选中的用例
    const selectedCaseCheckboxes = document.querySelectorAll('.case-checkbox:checked:not(:disabled)');
    
    const selectedFolderIds = selectedFolderCheckboxes.map(cb => 
      cb.getAttribute('data-folder-id')
    ).filter(id => id);
    
    const selectedCaseIds = Array.from(selectedCaseCheckboxes).map(cb => 
      cb.getAttribute('data-case-id')
    ).filter(id => id);
    
    // 检查是否有选中项
    if (selectedFolderIds.length === 0 && selectedCaseIds.length === 0) {
      this.setStatus('请选择要删除的文件夹或用例', false);
      return;
    }
    
    // 构建确认消息
    let confirmMessage = '确定要删除以下内容吗？\n\n';
    if (selectedFolderIds.length > 0) {
      const folderNames = selectedFolderIds.map(folderId => {
        const folder = this.folderManager?.folders.find(f => f.folder_id === folderId);
        return folder ? folder.name : `文件夹(${folderId})`;
      });
      confirmMessage += `${selectedFolderIds.length}个文件夹 \n`;
    }
    if (selectedCaseIds.length > 0) {
      const caseNames = selectedCaseIds.map(caseId => {
        const caseItem = this.casesList.find(c => c.case_id === caseId);
        return caseItem ? caseItem.name : `用例(${caseId})`;
      });
      confirmMessage += `${selectedCaseIds.length}个用例 \n`;
    }
    if (selectedFolderIds.length > 0) {
      confirmMessage += '⚠️将删除选中的文件夹及文件夹内的所有用例\n\r';
    }
    
    // 使用自定义确认弹窗
    if (this.uiUtils && typeof this.uiUtils.showConfirm === 'function') {
      this.uiUtils.showConfirm(
        confirmMessage,
        async () => {
          await this._performBatchDelete(selectedFolderIds, selectedCaseIds);
        },
        () => {
          console.log('用户取消批量删除');
        }
      );
      return;
    }
    
    // 降级到原生 confirm
    if (!confirm(confirmMessage)) {
      return;
    }
    
    await this._performBatchDelete(selectedFolderIds, selectedCaseIds);
  }

  async _performBatchDelete(selectedFolderIds, selectedCaseIds) {
    try {
      this.setStatus('正在批量删除...', true);
      
      const deletePromises = [];
      let folderDeleteCount = 0;
      let caseDeleteCount = 0;
      
      // 情况1和2: 删除选中的文件夹（API会自动删除文件夹内的所有用例）
      if (selectedFolderIds.length > 0) {
        console.log('🗑️ 开始删除文件夹:', selectedFolderIds);
        const folderDeletePromises = selectedFolderIds.map(folderId => 
          fetch(`${this.SERVER_URL}/api/folders/${folderId}`, { method: 'DELETE' })
            .then(async response => {
              const data = await response.json();
              if (response.ok) {
                folderDeleteCount++;
                return { success: true, type: 'folder', id: folderId };
              } else {
                console.error(`❌ 删除文件夹失败: ${folderId}`, data.error);
                return { success: false, type: 'folder', id: folderId, error: data.error };
              }
            })
            .catch(error => {
              console.error(`❌ 删除文件夹异常: ${folderId}`, error);
              return { success: false, type: 'folder', id: folderId, error: error.message };
            })
        );
        deletePromises.push(...folderDeletePromises);
      }
      
      // 情况2和3: 删除选中的用例（排除已在选中文件夹中的用例）
      if (selectedCaseIds.length > 0) {
        // 获取所有选中文件夹内的用例ID（避免重复删除）
        const casesInSelectedFolders = new Set();
        if (selectedFolderIds.length > 0 && this.folderManager) {
          selectedFolderIds.forEach(folderId => {
            const folderCases = this.casesList.filter(c => c.folder_id === folderId);
            folderCases.forEach(c => casesInSelectedFolders.add(c.case_id));
          });
        }
        
        // 只删除不在选中文件夹中的用例
        const casesToDelete = selectedCaseIds.filter(caseId => !casesInSelectedFolders.has(caseId));
        
        if (casesToDelete.length > 0) {
          console.log('🗑️ 开始删除用例:', casesToDelete);
          const caseDeletePromises = casesToDelete.map(caseId => 
            fetch(`${this.SERVER_URL}/api/cases/${caseId}`, { method: 'DELETE' })
              .then(async response => {
                const data = await response.json();
                if (response.ok) {
                  caseDeleteCount++;
                  return { success: true, type: 'case', id: caseId };
                } else {
                  console.error(`❌ 删除用例失败: ${caseId}`, data.error);
                  return { success: false, type: 'case', id: caseId, error: data.error };
                }
              })
              .catch(error => {
                console.error(`❌ 删除用例异常: ${caseId}`, error);
                return { success: false, type: 'case', id: caseId, error: error.message };
              })
          );
          deletePromises.push(...caseDeletePromises);
        } else {
          console.log('ℹ️ 所有选中的用例都在选中的文件夹中，将随文件夹一起删除');
        }
      }
      
      // 等待所有删除操作完成
      const results = await Promise.all(deletePromises);
      
      const successCount = results.filter(r => r.success).length;
      const totalCount = selectedFolderIds.length + selectedCaseIds.length;
      
      console.log(`🗑️ 批量删除完成: 文件夹${folderDeleteCount}个, 用例${caseDeleteCount}个`);
      
      // 构建状态消息
      let statusMessage = '批量删除完成: ';
      if (folderDeleteCount > 0) {
        statusMessage += `${folderDeleteCount}个文件夹`;
      }
      if (caseDeleteCount > 0) {
        if (folderDeleteCount > 0) statusMessage += ', ';
        statusMessage += `${caseDeleteCount}个用例`;
      }
      this.setStatus(statusMessage, true);
      
      // 清空选择
      this.selectedCases.clear();
      const folderCheckboxes = document.querySelectorAll('.folder-checkbox:checked');
      const caseCheckboxes = document.querySelectorAll('.case-checkbox:checked:not(:disabled)');
      folderCheckboxes.forEach(cb => cb.checked = false);
      caseCheckboxes.forEach(cb => cb.checked = false);
      
      // 重新加载数据
      if (this.folderManager) {
        await this.folderManager.loadFoldersFromAPI();
      }
      await this.loadCasesList();
      
    } catch (error) {
      console.error('❌ 批量删除失败:', error);
      this.setStatus(`批量删除失败: ${error.message}`, false);
    }
  }

  /**
   * 移动用例到文件夹
   */
  async moveCaseToFolder(caseId, targetFolderId) {
    console.log('📁 移动用例到文件夹:', caseId, '->', targetFolderId);
    
    try {
      this.setStatus('正在移动用例...', true);
      
      const response = await fetch(`${this.SERVER_URL}/api/cases/${caseId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          folder_id: targetFolderId || null
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        console.log('📁 用例移动成功:', data);
        this.setStatus('用例移动成功', true);
        
        // 重新加载用例列表
        await this.loadCasesList();
        
      } else {
        console.error('❌ 用例移动失败:', data.error);
        this.setStatus(`用例移动失败: ${data.error}`, false);
      }
    } catch (error) {
      console.error('❌ 用例移动请求失败:', error);
      this.setStatus(`用例移动失败: ${error.message}`, false);
    }
  }

  /**
   * 切换选择用例
   */
  toggleSelectCase(caseId) {
    if (this.selectedCases.has(caseId)) {
      this.selectedCases.delete(caseId);
    } else {
      this.selectedCases.add(caseId);
    }
    this.updateBatchButtons();
  }

  /**
   * 切换选择所有用例和文件夹
   */
  toggleSelectAll() {
    // 获取所有文件夹和用例复选框
    const allFolderCheckboxes = document.querySelectorAll('.folder-checkbox');
    const allCaseCheckboxes = document.querySelectorAll('.case-checkbox:not(:disabled)');
    
    // 检查是否全部选中（文件夹需要完全选中，不能是indeterminate状态）
    const allFoldersSelected = Array.from(allFolderCheckboxes).every(cb => 
      cb.checked && !cb.indeterminate
    );
    const allCasesSelected = Array.from(allCaseCheckboxes).every(cb => cb.checked);
    const allSelected = allFoldersSelected && allCasesSelected;
    
    if (allSelected) {
      // 全部选中，则取消选中所有
      allFolderCheckboxes.forEach(cb => {
        cb.checked = false;
        cb.indeterminate = false;
      });
      
      allCaseCheckboxes.forEach(cb => {
        cb.checked = false;
        const caseId = cb.getAttribute('data-case-id');
        if (caseId) {
          this.selectedCases.delete(caseId);
        }
      });
      
      // 更新文件夹状态（如果有folderManager）
      if (this.folderManager) {
        // 更新所有文件夹的状态
        this.folderManager.folders.forEach(folder => {
          this.folderManager.updateFolderCheckboxState(folder.folder_id);
        });
      }
    } else {
      // 未全部选中，则选中所有
      // 1. 先展开所有文件夹
      if (this.folderManager) {
        // 获取所有根文件夹
        const rootFolders = this.folderManager.folders.filter(f => !f.parent_id);
        rootFolders.forEach(folder => {
          // 展开所有子文件夹
          this.folderManager.expandFolderAndChildren(folder.folder_id);
        });
        
        // 保存展开状态并重新渲染
        this.folderManager.saveExpandedState();
        this.folderManager.renderTreeView();
        
        // 2. 渲染完成后，选中所有文件夹和用例
        setTimeout(() => {
          // 选中所有文件夹（包括子文件夹）
          const allFolderIds = this.folderManager.folders.map(f => f.folder_id);
          allFolderIds.forEach(folderId => {
            const folderCheckbox = document.querySelector(`.folder-checkbox[data-folder-id="${folderId}"]`);
            if (folderCheckbox) {
              folderCheckbox.checked = true;
              folderCheckbox.indeterminate = false;
            }
          });
          
          // 选中所有用例（包括文件夹中的用例）
          const allCaseCheckboxesAfterRender = document.querySelectorAll('.case-checkbox:not(:disabled)');
          allCaseCheckboxesAfterRender.forEach(cb => {
            cb.checked = true;
            const caseId = cb.getAttribute('data-case-id');
            if (caseId) {
              this.selectedCases.add(caseId);
            }
          });
          
          // 更新批量按钮状态
          this.updateBatchButtons();
        }, 100);
        return; // 提前返回，因为setTimeout会处理后续逻辑
      } else {
        // 如果没有folderManager，只处理用例
        allCaseCheckboxes.forEach(cb => {
          cb.checked = true;
          const caseId = cb.getAttribute('data-case-id');
          if (caseId) {
            this.selectedCases.add(caseId);
          }
        });
      }
    }
    
    this.updateBatchButtons();
  }

  /**
   * 更新批量操作按钮状态
   */
  updateBatchButtons() {
    const batchExecuteBtn = document.querySelector('#batchExecute');
    const batchDeleteBtn = document.querySelector('#batchDelete');
    const aiExecuteBtn = document.querySelector('#aiExecute');

    // 检查是否有选中的文件夹或用例
    const selectedFolderCheckboxes = document.querySelectorAll('.folder-checkbox:checked');
    const selectedCaseCheckboxes = document.querySelectorAll('.case-checkbox:checked:not(:disabled)');
    const hasSelection = selectedFolderCheckboxes.length > 0 || selectedCaseCheckboxes.length > 0;

    // AI 执行按钮与批量执行同步
    if (aiExecuteBtn) {
      const hasSelectedCases = this.selectedCases.size > 0;
      aiExecuteBtn.disabled = !hasSelectedCases;
    }

    if (batchExecuteBtn) {
      // 批量执行只支持用例，不支持文件夹
      // 如果正在执行中，按钮状态由 setExecutionButtonState 控制
      if (!batchExecuteBtn.classList.contains('executing')) {
        // 检查 selectedCases 集合，而不是 checkbox 状态，因为执行完成后可能 checkbox 状态被清空但 selectedCases 还保留
        const hasSelectedCases = this.selectedCases.size > 0;
        batchExecuteBtn.disabled = !hasSelectedCases;
        
        // 如果 selectedCases 有值但 checkbox 未选中，同步 checkbox 状态
        if (hasSelectedCases) {
          this.selectedCases.forEach(caseId => {
            const checkbox = document.querySelector(`.case-checkbox[data-case-id="${caseId}"]`);
            if (checkbox && !checkbox.checked) {
              checkbox.checked = true;
            }
          });
        }
      }
    }
    if (batchDeleteBtn) {
      // 批量删除支持文件夹和用例
      batchDeleteBtn.disabled = !hasSelection;
    }
  }

  /**
   * 设置执行按钮的执行中状态
   */
  setExecutionButtonState(isExecuting) {
    const batchExecuteBtn = document.querySelector('#batchExecute');
    if (!batchExecuteBtn) return;
    
    if (isExecuting) {
      batchExecuteBtn.disabled = true;
      batchExecuteBtn.classList.add('executing');
      batchExecuteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 执行中...';
    } else {
      batchExecuteBtn.classList.remove('executing');
      batchExecuteBtn.innerHTML = '<i class="fas fa-play"></i> 执行';
      // 先恢复按钮状态，再根据选中状态决定是否禁用
      this.updateBatchButtons();
    }
  }

  /**
   * 切换到录制模式
   */
  switchToRecordingMode(title = '录制') {
    console.log('🎬 切换到录制界面:', title);
    
    // 仅在“新增”且不是“在文件夹中”创建时清除目标文件夹ID
    const isEditMode = !!this.currentEditingCase;
    const isNewCase = !isEditMode || title.includes('新增');
    if (isNewCase && !title.includes('在文件夹中')) {
      this.targetFolderId = null;
    }
    
    // 隐藏用例管理界面
    document.querySelector('#caseManagement').classList.remove('active');
    
    // 显示录制界面
    document.querySelector('#recordingMode').classList.add('active');
    
    // 更新标题
    document.querySelector('#recordingTitle').textContent = title;
    
    // 判断是编辑模式还是录制模式
    // 通过当前是否有正在编辑的用例判断编辑模式；新增模式为无当前用例
    // 仍兼容标题包含“新增/编辑”的情况
    // isEditMode 与 isNewCase 已在上方计算，此处保留变量名一致
    
    // 根据模式显示/隐藏相关控件
    const recordControls = document.querySelector('.record-controls');
    const playControls = document.querySelector('.play-controls');
    
    if (isNewCase) {
      // 新增用例：显示录制控件，隐藏执行控件
      if (recordControls) recordControls.style.display = 'block';
      if (playControls) playControls.style.display = 'block';
    } else if (isEditMode) {
      // 编辑模式：显示录制控件与执行控件，支持单步/执行全部
      if (recordControls) recordControls.style.display = 'block';
      if (playControls) playControls.style.display = 'block';
    } else {
      // 录制模式：显示录制控件，隐藏执行控件
      if (recordControls) recordControls.style.display = 'block';
      if (playControls) playControls.style.display = 'block';
    }
    
    // 只有在非编辑模式下才清空数据
    if (!isEditMode) {
      // 清空录制数据
      if (this.recordingManager) {
        this.recordingManager.clearRecordedSteps();
      }
      
      // 清空表单
      const caseNameEl = document.querySelector('#caseName');
      const caseDescriptionEl = document.querySelector('#caseDescription');
      const caseCategoryEl = document.querySelector('#caseCategory');
      const caseTagsEl = document.querySelector('#caseTags');
      const caseStatusEl = document.querySelector('#caseStatus');
      
      if (caseNameEl) caseNameEl.value = '';
      if (caseDescriptionEl) caseDescriptionEl.value = '';
      if (caseCategoryEl) caseCategoryEl.value = '默认';
      if (caseTagsEl) caseTagsEl.value = '';
      if (caseStatusEl) caseStatusEl.value = 'active';
    } else {
      // 编辑模式下也确保状态设置正确
      const caseStatusEl = document.querySelector('#caseStatus');
      if (caseStatusEl) caseStatusEl.value = 'active';
    }
    
    // 初始化录制功能（新增用例不自动开始录制）
    if (this.recordingManager) {
      this.recordingManager.initRecordingMode();
      // 强制刷新一次步骤列表与按钮状态，确保“新增用例”场景可见且可用
      this.recordingManager.updateStepsList();
      this.recordingManager.updateRecordCount();
      this.recordingManager.updateRecordButtons();
    }
  }

  /**
   * 切换到用例管理界面
   */
  async switchToCaseManagement() {
    console.log('📋 切换到用例管理界面');
    
    // 如果正在录制，自动停止录制
    if (this.recordingManager && this.recordingManager.isRecording) {
      await this.recordingManager.stopRecording();
    }
    
    // 隐藏录制界面
    document.querySelector('#recordingMode').classList.remove('active');
    
    // 显示用例管理界面
    document.querySelector('#caseManagement').classList.add('active');
    
    // 清空当前编辑的用例
    this.currentEditingCase = null;
    
    // 重新加载用例列表
    this.loadCasesList();
  }

  /**
   * 设置文件夹管理器引用
   */
  setFolderManager(folderManager) {
    this.folderManager = folderManager;
  }

  /**
   * 设置录制管理器引用
   */
  setRecordingManager(recordingManager) {
    this.recordingManager = recordingManager;
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
export { CaseManager };

// 兼容性导出（保持向后兼容）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CaseManager;
} else {
  window.CaseManager = CaseManager;
}
