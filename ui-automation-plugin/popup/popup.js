/**
 * UI自动化插件主文件
 * 负责模块协调和事件处理
 * 
 * @global
 * @typedef {Object} Window
 * @property {Function} init
 * @property {any} folderManager
 * @property {any} caseManager
 * @property {any} recordingManager
 * @property {any} uiUtils
 */

// ES6 模块导入
import { UIUtils } from '../modules/utils/ui-utils.js';
import { FolderManager } from '../modules/managers/folder-manager.js';
import { CaseManager } from '../modules/managers/case-manager.js';
import { RecordingManager } from '../modules/managers/recording-manager.js';
import {
  extensionPerfTracingStart,
  extensionPerfTracingStop,
} from '../modules/perf/perf-client.js';
import { ExecutionManager } from '../modules/execution/execution-manager.js';
const chrome = /** @type {any} */ (window).chrome;

/** 手动性能采集：停止时使用与「开始」相同的 tabId，避免启停之间切换了激活标签导致空 trace */
let manualPerfTraceTabId = null;

async function getSidePanelActiveTabId() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id ?? null;
  } catch (_) {
    return null;
  }
}

// 全局变量
let folderManager;
let caseManager;
let recordingManager;
let uiUtils;

// 初始化函数
async function init() {
  console.log('🚀 初始化UI自动化插件...');
  
  try {
    // 初始化工具模块
    uiUtils = new UIUtils();
    
    // 初始化管理器模块
    folderManager = new FolderManager();
    caseManager = new CaseManager();
    recordingManager = new RecordingManager();
    
    // 设置模块间的引用
    folderManager.setStatus = uiUtils.setStatus.bind(uiUtils);
    folderManager.uiUtils = uiUtils;
    caseManager.setStatus = uiUtils.setStatus.bind(uiUtils);
    caseManager.uiUtils = uiUtils;
    recordingManager.setStatus = uiUtils.setStatus.bind(uiUtils);
    recordingManager.uiUtils = uiUtils;

    caseManager.setFolderManager(folderManager);
    caseManager.setRecordingManager(recordingManager);
    recordingManager.setCaseManager(caseManager);
    folderManager.setCaseManager(caseManager);

    // 初始化 AI 执行管理器
    const executionManager = new ExecutionManager();
    window._executionManager = executionManager;

    // AI 执行回调
    executionManager.onProgress = (data) => {
      const progressEl = document.getElementById('aiExecProgress');
      const statusEl = document.getElementById('aiExecStatus');
      if (progressEl) {
        const stepInfo = document.createElement('div');
        stepInfo.style.cssText = 'padding: 3px 0; border-bottom: 1px solid #f0f0f0;';
        const icon = data.success ? '✅' : '❌';
        stepInfo.innerHTML = `${icon} 步骤 ${data.step_index + 1}/${data.total_steps} — ${data.action} ${data.error ? '(<span style="color:red">' + data.error + '</span>)' : ''} <span style="color:#999">${data.duration_ms}ms</span>`;
        const emptyState = progressEl.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
        progressEl.appendChild(stepInfo);
        progressEl.scrollTop = progressEl.scrollHeight;
      }
      if (statusEl) statusEl.textContent = `步骤 ${data.step_index + 1}/${data.total_steps}`;
    };

    executionManager.onComplete = (data) => {
      const panel = document.getElementById('aiExecutionPanel');
      const statusEl = document.getElementById('aiExecStatus');
      const resultEl = document.getElementById('aiExecResult');
      const iconEl = document.getElementById('aiResultIcon');
      const textEl = document.getElementById('aiResultText');
      const detailsEl = document.getElementById('aiResultDetails');

      if (statusEl) statusEl.textContent = '执行完成';
      if (resultEl) resultEl.style.display = 'block';

      const resultMap = {
        pass: { icon: '✅', text: '通过', color: '#52c41a' },
        fail: { icon: '❌', text: '失败', color: '#ff4d4f' },
        error: { icon: '⚠️', text: '错误', color: '#faad14' },
        uncertain: { icon: '❓', text: '不确定', color: '#1890ff' },
      };

      const finalResult = data.final_result || 'unknown';
      const info = resultMap[finalResult] || { icon: '❓', text: finalResult, color: '#999' };

      if (iconEl) iconEl.textContent = info.icon;
      if (textEl) { textEl.textContent = `${info.text} — ${data.case_name || ''}`; textEl.style.color = info.color; }
      if (detailsEl) detailsEl.textContent = `总步骤: ${data.total_steps || '-'} | 通过: ${data.passed_steps || '-'}`;

      // 重新启用按钮
      const aiExecBtn = document.getElementById('aiExecute');
      const stopBtn = document.getElementById('stopAiExecution');
      if (aiExecBtn) aiExecBtn.disabled = false;
      if (stopBtn) stopBtn.style.display = 'none';

      // 刷新用例列表
      if (caseManager && caseManager.loadCases) caseManager.loadCases();
    };

    executionManager.onError = (data) => {
      const statusEl = document.getElementById('aiExecStatus');
      if (statusEl) statusEl.textContent = `执行错误: ${data.error}`;
      const aiExecBtn = document.getElementById('aiExecute');
      const stopBtn = document.getElementById('stopAiExecution');
      if (aiExecBtn) aiExecBtn.disabled = false;
      if (stopBtn) stopBtn.style.display = 'none';
    };
    
    // 绑定事件
    bindEvents();
    
    // 初始化用例管理
    await initCaseManagement();
    
    console.log('✅ UI自动化插件初始化完成');
    
  } catch (error) {
    console.error('❌ 初始化失败:', error);
    uiUtils.showError('插件初始化失败');
  }
}

/**
 * 绑定事件
 */
function bindEvents() {
  console.log('🔗 绑定事件...');
  
  // 新增用例按钮
  const addNewCaseBtn = uiUtils.qs('#addNewCase');
  if (addNewCaseBtn) {
    addNewCaseBtn.addEventListener('click', () => {
      console.log('➕ 新增用例按钮被点击');
      caseManager.currentEditingCase = null;
      
      // 切换到录制界面
      caseManager.switchToRecordingMode('新增用例');
      
      // 新增用例：确保步骤为空
      if (recordingManager) {
        recordingManager.clearRecordedSteps();
        recordingManager.updateStepsList();
        recordingManager.updateRecordCount();
      }
    });
  }
  
  // 刷新按钮
  const refreshCasesBtn = uiUtils.qs('#refreshCases');
  if (refreshCasesBtn) {
    refreshCasesBtn.addEventListener('click', async () => {
      console.log('🔄 刷新按钮被点击');
      try {
        // 同时刷新文件夹树和用例列表
        // 注意：loadCasesList() 内部已经会调用 renderTreeView()，所以不需要再次调用
        await Promise.all([
          folderManager.loadFoldersFromAPI(),
          caseManager.loadCasesList()
        ]);
        
        console.log('✅ 刷新完成');
      } catch (error) {
        console.error('❌ 刷新失败:', error);
        uiUtils.showError('刷新失败');
      }
    });
  }
  
  // 展开所有按钮
  const expandAllBtn = uiUtils.qs('#expandAll');
  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', () => {
      folderManager.expandAllFolders();
    });
  }
  
  // 收起所有按钮
  const collapseAllBtn = uiUtils.qs('#collapseAll');
  if (collapseAllBtn) {
    collapseAllBtn.addEventListener('click', () => {
      folderManager.collapseAllFolders();
    });
  }
  
  // 批量执行按钮
  const batchExecuteBtn = uiUtils.qs('#batchExecute');
  console.log('🔍 查找批量执行按钮:', batchExecuteBtn);
  if (batchExecuteBtn) {
    batchExecuteBtn.addEventListener('click', () => {
      console.log('▶️ 批量执行按钮被点击');
      if (caseManager && typeof caseManager.batchExecuteCases === 'function') {
        caseManager.batchExecuteCases();
      } else {
        uiUtils.showInfoNotification('批量执行功能待实现');
      }
    });
    console.log('✅ 批量执行按钮事件已绑定');
  } else {
    console.error('❌ 找不到批量执行按钮 #batchExecute');
  }

  // AI 执行按钮（Playwright + AI Agent）
  const aiExecuteBtn = uiUtils.qs('#aiExecute');
  const stopAiBtn = uiUtils.qs('#stopAiExecution');
  if (aiExecuteBtn) {
    aiExecuteBtn.addEventListener('click', async () => {
      console.log('🤖 AI 执行按钮被点击');
      const selectedCases = caseManager ? caseManager.getSelectedCases() : [];
      if (selectedCases.length === 0) {
        uiUtils.showInfoNotification('请先选择要执行的用例');
        return;
      }

      const panel = document.getElementById('aiExecutionPanel');
      const progressEl = document.getElementById('aiExecProgress');
      const resultEl = document.getElementById('aiExecResult');
      if (panel) panel.style.display = 'block';
      if (progressEl) progressEl.innerHTML = '<div class="empty-state">启动 AI Agent...</div>';
      if (resultEl) resultEl.style.display = 'none';
      aiExecuteBtn.disabled = true;
      if (stopAiBtn) stopAiBtn.style.display = 'inline-flex';

      const em = window._executionManager;
      if (!em) return;

      if (selectedCases.length === 1) {
        await em.runCase(selectedCases[0].case_id);
      } else {
        await em.runBatch(selectedCases.map(c => c.case_id));
      }
    });
  }
  if (stopAiBtn) {
    stopAiBtn.addEventListener('click', async () => {
      const em = window._executionManager;
      if (em) await em.stop();
      stopAiBtn.style.display = 'none';
      const aiExecuteBtn2 = document.getElementById('aiExecute');
      if (aiExecuteBtn2) aiExecuteBtn2.disabled = false;
    });
  }

  // 执行 UI 用例时是否启用性能测试的勾选框
  const perfOnExecuteCheckbox = uiUtils.qs('#perfOnExecute');
  if (perfOnExecuteCheckbox && caseManager) {
    // 初始化：默认与勾选框保持一致
    caseManager.enablePerfOnExecute = perfOnExecuteCheckbox.checked;

    perfOnExecuteCheckbox.addEventListener('change', () => {
      const checked = perfOnExecuteCheckbox.checked;
      console.log('📊 执行用例时性能测试开关:', checked);
      caseManager.enablePerfOnExecute = checked;
    });
  }

  // 性能测试维度（单步 / 整个用例）单选
  const perfModeStep = uiUtils.qs('#perfModeStep');
  const perfModeCase = uiUtils.qs('#perfModeCase');
  const updatePerfMode = () => {
    if (!caseManager) return;
    if (perfModeCase && perfModeCase.checked) {
      caseManager.perfMode = 'case';
    } else {
      caseManager.perfMode = 'step';
    }
    console.log('📊 性能测试维度:', caseManager.perfMode);
  };
  if (perfModeStep || perfModeCase) {
    if (perfModeStep) perfModeStep.addEventListener('change', updatePerfMode);
    if (perfModeCase) perfModeCase.addEventListener('change', updatePerfMode);
    updatePerfMode();
  }

  const perfTraceStartBtn = uiUtils.qs('#perfTraceStart');
  const perfTraceStopBtn = uiUtils.qs('#perfTraceStop');
  const perfManualStatusEl = uiUtils.qs('#perfManualStatus');

  if (perfTraceStartBtn) {
    perfTraceStartBtn.addEventListener('click', async () => {
      const tabId = await getSidePanelActiveTabId();
      if (!tabId) {
        if (perfManualStatusEl) {
          perfManualStatusEl.textContent = '无法获取当前标签页，请先点开要测试的网页标签';
        }
        return;
      }
      if (perfManualStatusEl) perfManualStatusEl.textContent = '正在启动 Tracing 采集…';
      try {
        const r = await extensionPerfTracingStart(tabId);
        if (r?.ok) {
          manualPerfTraceTabId = tabId;
          if (perfManualStatusEl) perfManualStatusEl.textContent = '采集中（已附加调试器）';
        } else {
          manualPerfTraceTabId = null;
          if (perfManualStatusEl) perfManualStatusEl.textContent = r?.error || '启动失败';
        }
      } catch (e) {
        if (perfManualStatusEl) perfManualStatusEl.textContent = e?.message || String(e);
      }
    });
  }

  if (perfTraceStopBtn) {
    perfTraceStopBtn.addEventListener('click', async () => {
      const tabId = manualPerfTraceTabId ?? (await getSidePanelActiveTabId());
      if (!tabId) {
        if (perfManualStatusEl) perfManualStatusEl.textContent = '无法获取当前标签页';
        return;
      }
      if (perfManualStatusEl) perfManualStatusEl.textContent = '正在汇总 Tracing 事件…';
      try {
        const r = await extensionPerfTracingStop(tabId);
        if (r?.ok && caseManager) {
          if (typeof caseManager.appendPerfResultSummary === 'function') {
            caseManager.appendPerfResultSummary(r.summary || {}, '手动采集');
          } else if (typeof caseManager._appendPerfResultLine === 'function') {
            const n = r.summary?.totalEvents ?? '未知';
            caseManager._appendPerfResultLine(`手动采集 traceEvents 总数: ${n}`);
          }
          if (perfManualStatusEl) perfManualStatusEl.textContent = '已停止，结果已写入下方列表';
        } else {
          if (perfManualStatusEl) perfManualStatusEl.textContent = r?.error || '停止失败';
        }
      } catch (e) {
        if (perfManualStatusEl) perfManualStatusEl.textContent = e?.message || String(e);
      } finally {
        manualPerfTraceTabId = null;
      }
    });
  }

  // 性能结果面板 - 清空按钮
  const perfClearBtn = uiUtils.qs('#perfClearResult');
  if (perfClearBtn) {
    perfClearBtn.addEventListener('click', () => {
      const body = uiUtils.qs('#perfResultBody');
      if (body) {
        body.innerHTML = '<div class="empty-state">已清空性能结果</div>';
      }
    });
  }

  const perfViewReportBtn = uiUtils.qs('#perfViewReport');
  function updatePerfReportButtonVisibility() {
    const btn = uiUtils.qs('#perfViewReport');
    if (!btn || !caseManager) return;
    btn.style.display = caseManager.lastPerfReportBlobUrl ? 'inline-block' : 'none';
  }
  if (perfViewReportBtn) {
    perfViewReportBtn.addEventListener('click', () => {
      const url = caseManager?.lastPerfReportBlobUrl;
      if (url && chrome?.tabs?.create) {
        chrome.tabs.create({ url });
      }
    });
  }
  window.addEventListener('uiap-perf-report', () => updatePerfReportButtonVisibility());

  // 批量删除按钮
  const batchDeleteBtn = uiUtils.qs('#batchDelete');
  console.log('🔍 查找批量删除按钮:', batchDeleteBtn);
  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', () => {
      console.log('🗑️ 批量删除按钮被点击');
      if (caseManager && typeof caseManager.batchDeleteCases === 'function') {
        caseManager.batchDeleteCases();
      } else {
        console.error('❌ caseManager.batchDeleteCases 方法不存在');
        uiUtils.showError('批量删除功能不可用');
      }
    });
    console.log('✅ 批量删除按钮事件已绑定');
  } else {
    console.error('❌ 找不到批量删除按钮 #batchDelete');
  }
  
  // 返回用例管理按钮（兜底绑定）
  const backToCasesBtn = uiUtils.qs('#backToCases');
  if (backToCasesBtn) {
    backToCasesBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (recordingManager && typeof recordingManager.backToManagement === 'function') {
        recordingManager.backToManagement();
      } else if (caseManager && typeof caseManager.switchToCaseManagement === 'function') {
        caseManager.switchToCaseManagement();
      }
    });
  }
  
  // 全选按钮
  const selectAllBtn = uiUtils.qs('#selectAll');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      caseManager.toggleSelectAll();
    });
  }
  
  // 新建文件夹按钮
  const addFolderBtn = uiUtils.qs('#addFolder');
  console.log('🔍 查找新建文件夹按钮:', addFolderBtn);
  if (addFolderBtn) {
    addFolderBtn.addEventListener('click', () => {
      console.log('📁 新建文件夹按钮被点击');
      console.log('📁 folderManager:', folderManager);
      if (folderManager) {
        folderManager.createFolder();
      } else {
        console.error('❌ folderManager未初始化');
        uiUtils.showError('文件夹管理器未初始化');
      }
    });
    console.log('✅ 新建文件夹按钮事件已绑定');
  } else {
    console.error('❌ 找不到新建文件夹按钮 #addFolder');
  }
  
  // 绑定用例项事件（事件委托）
  bindCaseItemEvents();
}

/**
 * 绑定用例项事件（事件委托）
 */
function bindCaseItemEvents() {
  const casesListEl = uiUtils.qs('#casesList');
  if (!casesListEl) {
    console.error('❌ 找不到casesList元素');
    return;
  }
  
  // 如果已经绑定过事件，先移除
  if (casesListEl._caseItemEventBound) {
    // console.log('🔄 重新绑定用例项事件');
    casesListEl.removeEventListener('click', casesListEl._caseItemClickHandler);
  }
  
  // 创建事件处理器并保存引用
  casesListEl._caseItemClickHandler = (e) => {
    // 处理用例选择
    if (e.target.classList.contains('case-checkbox')) {
      console.log('☑️ 用例选择框被点击');
      e.stopPropagation();
      const caseId = e.target.getAttribute('data-case-id');
      if (caseId) {
        caseManager.toggleSelectCase(caseId);
        
        // 更新父文件夹的状态
        const caseItem = caseManager.casesList.find(c => c.case_id === caseId);
        if (caseItem && caseItem.folder_id && folderManager) {
          folderManager.updateFolderCheckboxState(caseItem.folder_id);
          folderManager.updateParentFoldersState(caseItem.folder_id);
        }
      }
      return;
    }
    
    // 处理文件夹选择
    if (e.target.classList.contains('folder-checkbox')) {
      console.log('☑️ 文件夹选择框被点击');
      e.stopPropagation();
      const folderId = e.target.getAttribute('data-folder-id');
      if (folderId) {
        const isChecked = e.target.checked;
        console.log('📁 文件夹选择:', folderId, isChecked ? '选中' : '取消选中');
        
        // 递归选中/取消选中子文件夹和用例
        if (folderManager && typeof folderManager.selectFolderAndChildren === 'function') {
          folderManager.selectFolderAndChildren(folderId, isChecked);
        } else {
          // 如果没有递归选中方法，至少更新当前文件夹和父文件夹状态
          if (folderManager) {
            folderManager.updateFolderCheckboxState(folderId);
            folderManager.updateParentFoldersState(folderId);
          }
        }
        
        // 更新批量按钮状态
        if (caseManager && typeof caseManager.updateBatchButtons === 'function') {
          caseManager.updateBatchButtons();
        }
      }
      return;
    }
    
    // 在操作区内不触发展开/收起
    if (e.target.closest('.flat-actions')) {
      // do nothing here; allow specific button handlers below
    } else if (e.target.closest('.flat-header') && e.target.closest('.flat-item.folder')) {
      // 处理扁平式文件夹点击（展开/收起）
      const folderHeader = e.target.closest('.flat-header');
      const folderId = folderHeader.getAttribute('data-folder-id');
      // console.log('📁 扁平式文件夹被点击:', folderId);
      if (folderId) {
        folderManager.toggleFolder(folderId);
      }
      return;
    }
    
    // 处理编辑按钮
    const editBtn = e.target.closest('.btn-edit');
    if (editBtn) {
      console.log('📝 编辑按钮被点击');
      console.log('📝 点击的元素:', editBtn);
      console.log('📝 元素的属性:', {
        'data-case-id': editBtn.getAttribute('data-case-id'),
        'data-folder-id': editBtn.getAttribute('data-folder-id')
      });
      e.stopPropagation();
      const caseId = editBtn.getAttribute('data-case-id');
      const folderId = editBtn.getAttribute('data-folder-id');
      if (caseId) {
        console.log('📝 编辑用例ID:', caseId);
        caseManager.editCase(caseId);
      } else if (folderId) {
        console.log('📝 编辑文件夹ID:', folderId);
        folderManager.editFolder(folderId);
      }
    return;
  }
  
    // 处理移动按钮
    const moveBtn = e.target.closest('.btn-move');
    if (moveBtn) {
      console.log('📁 移动按钮被点击');
      e.stopPropagation();
      const caseId = moveBtn.getAttribute('data-case-id');
      console.log('📁 移动用例ID:', caseId);
      if (caseId) {
        showMoveCaseDialog(caseId);
      }
      return;
    }
    
    // 处理新建子文件夹按钮
    const createFolderBtn = e.target.closest('.btn-create');
    if (createFolderBtn) {
      console.log('📁 新建子文件夹按钮被点击');
      e.stopPropagation();
      const folderId = createFolderBtn.getAttribute('data-folder-id');
      console.log('📁 父文件夹ID:', folderId);
      if (folderId) {
        folderManager.createFolder(folderId);
      }
      return;
    }
    
    // 处理新建用例按钮
    const createCaseBtn = e.target.closest('.btn-create-case');
    if (createCaseBtn) {
      console.log('📄 新建用例按钮被点击');
      e.stopPropagation();
      const folderId = createCaseBtn.getAttribute('data-folder-id');
      console.log('📄 目标文件夹ID:', folderId);
      if (folderId) {
        createCaseInFolder(folderId);
      }
      return;
    }
  };
  
  // 绑定事件
  casesListEl.addEventListener('click', casesListEl._caseItemClickHandler);
  casesListEl._caseItemEventBound = true;
  // console.log('✅ 用例项事件已绑定');
}

// 将函数挂载到全局对象，供其他模块调用
window.bindCaseItemEvents = bindCaseItemEvents;

/**
 * 在文件夹中创建用例
 */
function createCaseInFolder(folderId) {
  console.log('📄 在文件夹中创建用例:', folderId);
  
  // 设置目标文件夹ID
  caseManager.targetFolderId = folderId;
  // 明确切换为新增模式，避免继承上一次编辑的用例状态
  caseManager.currentEditingCase = null;
  // 清空本地步骤并刷新界面
  if (recordingManager) {
    recordingManager.clearRecordedSteps();
    recordingManager.updateStepsList();
    recordingManager.updateRecordCount();
    recordingManager.updateRecordButtons();
    // 清空会话中的步骤，确保新增从空开始
    if (typeof recordingManager.clearSessionSteps === 'function') {
      recordingManager.clearSessionSteps();
    }
    try { chrome.storage.local.remove('uiap_steps'); } catch (_) {}
  }
  
  // 切换到录制模式
  caseManager.switchToRecordingMode('在文件夹中录制用例');
  
  // 显示状态信息
  uiUtils.setStatus(`将在文件夹中创建新用例`, true);
}

/**
 * 显示移动用例对话框
 */
function showMoveCaseDialog(caseId) {
  const caseItem = caseManager.casesList.find(c => c.case_id === caseId);
  if (!caseItem) return;

  // 递归渲染树形选项
  const rootIds = folderManager.folders
    .filter(f => !f.parent_id)
    .map(f => f.folder_id);

  function renderOptionsFrom(folderId, level) {
    const node = folderManager.folderStructure[folderId];
    if (!node) return '';
    const indent = '&nbsp;'.repeat(level * 2) + (level > 0 ? '└ ' : '');
    const option = `<option value="${folderId}" ${caseItem.folder_id === folderId ? 'selected' : ''}>${indent}${node.name}</option>`;
    const children = (node.children || []).map(childId => renderOptionsFrom(childId, level + 1)).join('');
    return option + children;
  }

  const treeOptions = rootIds.map(id => renderOptionsFrom(id, 0)).join('');

  const modal = uiUtils.createModal('📁 移动用例到文件夹', `
    <p>用例: ${caseItem.name}</p>
    <div class="form-group">
      <label>选择目标文件夹:</label>
      <select id="targetFolder">
        <option value="" ${!caseItem.folder_id ? 'selected' : ''}>根目录</option>
        ${treeOptions}
      </select>
    </div>
  `, [
    { id: 'confirmMoveBtn', text: '确认移动', class: 'btn-primary' },
    { id: 'cancelMoveBtn', text: '取消', class: 'btn-secondary' }
  ]);
  
  modal.querySelector('#confirmMoveBtn').onclick = () => {
    const targetFolderId = modal.querySelector('#targetFolder').value;
    caseManager.moveCaseToFolder(caseId, targetFolderId);
    uiUtils.closeModal(modal);
  };
  
  modal.querySelector('#cancelMoveBtn').onclick = () => {
    uiUtils.closeModal(modal);
  };
}

/**
 * 初始化用例管理
 */
async function initCaseManagement() {
  console.log('📋 初始化用例管理...');
  
  // 从API加载文件夹数据
  console.log('📁 开始加载文件夹数据...');
  await folderManager.loadFoldersFromAPI();
  console.log('📁 文件夹数据加载完成，数量:', folderManager.folders.length);
  
  folderManager.loadExpandedState();
  
  // 绑定树形控制按钮
  bindTreeControls();
  
  // 加载用例列表
  console.log('📋 准备加载用例列表...');
  await caseManager.loadCasesList();
  
  console.log('✅ 用例管理初始化完成');
}

/**
 * 绑定树形控制按钮
 */
function bindTreeControls() {
  // 这里可以添加树形控制相关的按钮绑定
  console.log('🌳 绑定树形控制按钮...');
}

/**
 * 监听来自content script的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 收到消息:', message);
  // 仅处理带 action 的消息；其他消息交由后台等监听者处理
  if (!message || !message.action) {
    return false; // 不响应，允许其他监听者接管
  }
  
  switch (message.action) {
    case 'stepRecorded':
      console.log('📝 收到录制的步骤:', message.step);
      if (recordingManager) {
        recordingManager.addStep(message.step);
        if (typeof recordingManager.saveStepsToSession === 'function') {
          recordingManager.saveStepsToSession();
          console.log('💾 已在侧边栏持久化步骤，当前数量:', recordingManager.getRecordedSteps().length);
        }
      }
      sendResponse({ success: true });
      break;
      
    case 'recordingStarted':
      console.log('🎬 录制已开始');
      if (recordingManager) {
        recordingManager.isRecording = true;
        recordingManager.updateRecordStatus('正在录制...');
        recordingManager.updateRecordButtons();
      }
      sendResponse({ success: true });
      break;
      
    case 'recordingStopped':
      console.log('🛑 录制已停止');
      if (recordingManager) {
        recordingManager.isRecording = false;
        recordingManager.updateRecordStatus('录制已停止');
        recordingManager.updateRecordButtons();
      }
      sendResponse({ success: true });
      break;
      
    case 'recordingRestored':
      console.log('🔄 录制状态已恢复');
      if (recordingManager) {
        recordingManager.isRecording = message.isRecording || false;
        if (message.isRecording) {
          recordingManager.updateRecordStatus('正在录制...');
          recordingManager.updateRecordButtons();
          // 同步步骤数据
          if (message.stepCount !== undefined) {
            console.log('📊 恢复的步骤数量:', message.stepCount);
          }
        }
      }
      sendResponse({ success: true });
      break;
      
    default:
      console.log('❓ 未知消息类型:', message.action);
      // 不响应，让其他监听者有机会处理
      return false;
  }
  
  return true; // 需要异步响应的分支保持通道开放
});

// 监听本地存储变化，实时刷新步骤列表
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    // 只有在录制状态下，才响应本地存储变化以刷新 UI
    if (area === 'local' && changes.uiap_steps && recordingManager && recordingManager.isRecording) {
      const newSteps = Array.isArray(changes.uiap_steps.newValue) ? changes.uiap_steps.newValue : [];
      const currentSteps = recordingManager.getRecordedSteps() || [];
      
      // 检查是否真的有变化（长度或内容不同）
      if (newSteps.length !== currentSteps.length || 
          JSON.stringify(newSteps) !== JSON.stringify(currentSteps)) {
        // 使用无持久化的方法，避免循环触发 storage 变更
        recordingManager.setRecordedStepsFromStorage(newSteps);
        recordingManager.updateStepsList();
        recordingManager.updateRecordCount();
        console.log('🔄 已根据 local 更新步骤(录制中): ', newSteps.length);
      }
    } else if (area === 'local' && changes.uiap_steps) {
      console.log('⏸ 忽略 local 步骤更新（当前未在录制）');
    }
  });
} catch (_) {}

/** 可拖拽调整高度的面板：用例列表、性能结果区 */
const RESIZE_KEYS = { casesList: 'uiap_cases_list_height', perfResult: 'uiap_perf_result_height' };
const RESIZE_DEFAULTS = { casesList: 380, perfResult: 180 };

async function loadPanelHeights() {
  try {
    if (!chrome?.storage?.local) return RESIZE_DEFAULTS;
    const data = await chrome.storage.local.get([RESIZE_KEYS.casesList, RESIZE_KEYS.perfResult]);
    return {
      casesList: Math.min(80 * window.innerHeight / 100, Math.max(120, Number(data[RESIZE_KEYS.casesList]) || RESIZE_DEFAULTS.casesList)),
      perfResult: Math.min(360, Math.max(60, Number(data[RESIZE_KEYS.perfResult]) || RESIZE_DEFAULTS.perfResult))
    };
  } catch (_) {
    return RESIZE_DEFAULTS;
  }
}

async function savePanelHeight(key, value) {
  try {
    if (chrome?.storage?.local && value != null) {
      await chrome.storage.local.set({ [RESIZE_KEYS[key]]: value });
    }
  } catch (_) {}
}

function initResizablePanels() {
  const wrap = document.querySelector('#casesListWrap');
  const perfBody = document.querySelector('#perfResultBody');
  const handleCases = document.querySelector('#casesListResize');
  const handlePerf = document.querySelector('#perfResultResize');
  if (!wrap || !perfBody || !handleCases || !handlePerf) return;

  let dragTarget = null;
  let startY = 0;
  let startHeight = 0;

  function onMouseMove(e) {
    if (!dragTarget) return;
    const dy = e.clientY - startY;
    if (dragTarget === 'casesList') {
      const newH = Math.min(0.8 * window.innerHeight, Math.max(120, startHeight + dy));
      wrap.style.height = `${newH}px`;
    } else if (dragTarget === 'perfResult') {
      const newH = Math.min(360, Math.max(60, startHeight + dy));
      perfBody.style.height = `${newH}px`;
    }
  }

  function onMouseUp() {
    if (dragTarget === 'casesList' && wrap && wrap.style.height) {
      savePanelHeight('casesList', parseInt(wrap.style.height, 10));
    } else if (dragTarget === 'perfResult' && perfBody && perfBody.style.height) {
      savePanelHeight('perfResult', parseInt(perfBody.style.height, 10));
    }
    dragTarget = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  handleCases.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragTarget = 'casesList';
    startY = e.clientY;
    startHeight = wrap.getBoundingClientRect().height;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  handlePerf.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragTarget = 'perfResult';
    startY = e.clientY;
    startHeight = parseInt(perfBody.style.height, 10) || perfBody.getBoundingClientRect().height;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  loadPanelHeights().then((h) => {
    wrap.style.height = `${h.casesList}px`;
    perfBody.style.height = `${h.perfResult}px`;
  });
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
  await init();
  initResizablePanels();
});

// 导出全局函数（兼容性，方案2：JSDoc）
const w = /** @type {any} */ (window);
w.init = init;
w.folderManager = folderManager;
w.caseManager = caseManager;
w.recordingManager = recordingManager;
w.uiUtils = uiUtils;
/** 侧边栏控制台可直接调用：await uiapPerfTracing.start() / stop() */
w.uiapPerfTracing = {
  getActiveTabId: getSidePanelActiveTabId,
  start: async (tabId) =>
    extensionPerfTracingStart(tabId ?? (await getSidePanelActiveTabId())),
  stop: async (tabId) =>
    extensionPerfTracingStop(tabId ?? (await getSidePanelActiveTabId())),
};
