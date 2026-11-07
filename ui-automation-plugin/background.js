// 基础自动化插件 - 后台脚本
import { perfTracingStart, perfTracingStop } from './background-perf-tracing.js';

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.error('打开侧边栏失败:', error);
  }
});

// 执行状态管理（用于跨页面执行）
let executionState = {
  isExecuting: false,
  stopRequested: false,
  steps: [],
  currentIndex: 0,
  intervalMs: 0,
  tabId: null
};

// 持久化：由后台统一读写，避免侧边栏生命周期影响
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg && msg.type === 'persistSteps') {
        const steps = Array.isArray(msg.steps) ? msg.steps : [];
        await chrome.storage.local.set({ uiap_steps: steps });
        sendResponse({ ok: true, count: steps.length });
        return;
      }
      if (msg && msg.type === 'loadPersistedSteps') {
        const data = await chrome.storage.local.get('uiap_steps');
        const steps = Array.isArray(data.uiap_steps) ? data.uiap_steps : [];
        sendResponse({ ok: true, steps });
        return;
      }
      if (msg && msg.type === 'clearPersistedSteps') {
        await chrome.storage.local.remove('uiap_steps');
        sendResponse({ ok: true });
        return;
      }
      // AI 自愈落库：将修复后的选择器写回 Flask 数据库
      if (msg && msg.type === 'aiHealPersist') {
        const { caseId, stepIndex, selector, selectorFallbacks } = msg;
        if (!caseId || stepIndex == null || !selector) {
          sendResponse({ ok: false, error: '参数不完整' });
          return;
        }
        try {
          const configData = await chrome.storage.local.get('uiap_config');
          const serverUrl = configData?.uiap_config?.SERVER_URL || 'http://localhost:5001';
          const resp = await fetch(`${serverUrl}/api/cases/${caseId}/heal-step`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stepIndex, selector, selectorFallbacks: selectorFallbacks || [] })
          });
          const result = await resp.json();
          console.log(`[AI自愈落库] 用例 ${caseId} 步骤[${stepIndex}] → ${selector}`, result);
          sendResponse({ ok: true, result });
        } catch (e) {
          console.error('[AI自愈落库] 请求失败:', e);
          sendResponse({ ok: false, error: e.message });
        }
        return;
      }
      // 截图转发：content script 请求截图当前标签页
      if (msg && msg.type === 'captureScreenshot') {
        try {
          const tabId = _sender.tab?.id;
          if (!tabId) {
            sendResponse({ ok: false, error: '无法获取标签页ID' });
            return;
          }
          const tab = await chrome.tabs.get(tabId);
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
          sendResponse({ ok: true, dataUrl });
        } catch (e) {
          console.warn('截图失败:', e);
          sendResponse({ ok: false, error: e.message });
        }
        return;
      }
      if (msg && msg.type === 'perfTracingStart') {
        const tabId = msg.tabId;
        if (!tabId) {
          sendResponse({ ok: false, error: '缺少 tabId' });
          return;
        }
        try {
          await perfTracingStart(tabId);
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
        return;
      }
      if (msg && msg.type === 'perfTracingStop') {
        const tabId = msg.tabId;
        if (!tabId) {
          sendResponse({ ok: false, error: '缺少 tabId' });
          return;
        }
        try {
          const result = await perfTracingStop(tabId);
          sendResponse(result);
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
        return;
      }
      // 开始执行（由background协调，支持跨页面）
      if (msg && msg.type === 'startExecution') {
        const tabId = msg.tabId || _sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, message: '无法获取标签页ID' });
          return;
        }
        
        console.log('🎬 Background收到执行请求，步骤数:', msg.steps?.length || 0, 'tabId:', tabId);
        
        executionState = {
          isExecuting: true,
          stopRequested: false,
          steps: Array.isArray(msg.steps) ? msg.steps : [],
          currentIndex: 0,
          intervalMs: Math.max(0, Number(msg.intervalMs || 0)),
          tabId: tabId,
          results: []
        };
        
        // 保存执行状态到storage
        await chrome.storage.local.set({ 
          uiap_execution_state: executionState 
        });
        
        console.log('💾 执行状态已保存，开始执行步骤...');
        
        // 开始执行（异步执行，不阻塞响应）
        executeSteps(tabId).catch(err => {
          console.error('执行步骤失败:', err);
        });
        
        sendResponse({ ok: true });
        return;
      }
      // 停止执行
      if (msg && msg.type === 'stopExecution') {
        executionState.isExecuting = false;
        executionState.stopRequested = true;
        await chrome.storage.local.remove('uiap_execution_state');
        sendResponse({ ok: true, stoppedAt: Date.now() });
        return;
      }
      // 页面跳转后继续执行
      if (msg && msg.type === 'continueExecution') {
        const tabId = _sender.tab?.id;
        if (tabId && executionState.isExecuting) {
          executionState.tabId = tabId;
          await executeSteps(tabId);
        }
        sendResponse({ ok: true });
        return;
      }
    } catch (e) {
      sendResponse({ ok: false, message: e?.message || String(e) });
      return;
    }
    sendResponse({ ok: false, message: 'unknown message' });
  })();
  return true;
});

// 执行步骤（支持跨页面）
async function executeSteps(tabId) {
  console.log('🎯 executeSteps 开始，tabId:', tabId, 'isExecuting:', executionState.isExecuting, 'steps:', executionState.steps.length);
  
  if (!executionState.isExecuting || !tabId) {
    console.warn('⚠️ 执行条件不满足，isExecuting:', executionState.isExecuting, 'tabId:', tabId);
    return;
  }
  
  try {
    // 等待页面加载完成
    console.log('⏳ 等待页面就绪...');
    await waitForPageReady(tabId);
    
    // 确保content script就绪
    let ready = false;
    for (let i = 0; i < 5; i++) {
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, { type: 'ping' }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        });
        if (response && response.ok) {
          ready = true;
          console.log('✅ Content script已就绪');
          break;
        }
      } catch (_) {
        // 等待content script加载
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    
    if (!ready) {
      console.warn('⚠️ Content script未就绪，尝试注入...');
      // 尝试注入content script
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/content.js']
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log('✅ Content script已注入');
      } catch (e) {
        console.error('❌ 注入content script失败:', e);
      }
    }
    
    console.log('🚀 开始执行步骤，当前索引:', executionState.currentIndex, '总步骤:', executionState.steps.length);
    
    // 继续执行剩余步骤
    while (executionState.isExecuting && !executionState.stopRequested &&
           executionState.currentIndex < executionState.steps.length) {
      
      const step = executionState.steps[executionState.currentIndex];
      console.log(`📝 执行第 ${executionState.currentIndex + 1}/${executionState.steps.length} 步:`, step.type, step.selector);
      
      // 在执行步骤前记录URL（用于检测页面跳转）
      let urlBefore = null;
      try {
        const tabBefore = await chrome.tabs.get(tabId);
        urlBefore = tabBefore.url;
      } catch (_) {
        // 获取失败，继续执行
      }
      
      try {
        const response = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('步骤执行超时'));
          }, 30000);
          
          chrome.tabs.sendMessage(tabId, {
            type: 'playSingleStep',
            step
          }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              // 如果response为undefined，可能是异步响应还未完成，等待一下
              if (response === undefined) {
                console.warn('⚠️ 响应为undefined，可能是异步响应延迟');
                // 等待一下再resolve，给异步操作时间
                setTimeout(() => {
                  resolve({ ok: true }); // 默认成功，避免阻塞
                }, 500);
              } else {
                resolve(response);
              }
            }
          });
        });
        
        // 处理响应：无响应或ok=true都视为成功
        if (!response || response.ok !== false) {
          // 检测页面是否跳转（通过检查tab的URL）
          let urlChanged = false;
          if (urlBefore) {
            try {
              // 等待一下，给页面跳转时间
              await new Promise(resolve => setTimeout(resolve, 800));
              
              // 检查URL是否变化或页面是否刷新
              let checkCount = 0;
              while (checkCount < 15) { // 增加检查次数，最多3秒
                try {
                  const tabAfter = await chrome.tabs.get(tabId);
                  
                  // 检查URL是否变化
                  if (tabAfter.url !== urlBefore) {
                    urlChanged = true;
                    console.log('🔄 检测到页面跳转:', urlBefore, '->', tabAfter.url);
                    break;
                  }
                  
                  // 检查页面状态是否从loading变为complete（页面刷新）
                  if (tabAfter.status === 'loading') {
                    console.log('🔄 检测到页面正在加载（可能是刷新）');
                    // 等待页面加载完成
                    await waitForPageReady(tabId, 10000);
                    urlChanged = true;
                    break;
                  }
                } catch (_) {
                  // tab可能不存在
                }
                await new Promise(resolve => setTimeout(resolve, 200));
                checkCount++;
              }
              
              // 如果页面跳转，等待新页面加载完成
              if (urlChanged) {
                console.log('⏳ 等待新页面加载完成...');
                await waitForPageReady(tabId, 10000);
                
                // 确保content script加载完成并重新注入（如果需要）
                let contentReady = false;
                for (let i = 0; i < 5; i++) {
                  try {
                    const pingResponse = await new Promise((resolve, reject) => {
                      chrome.tabs.sendMessage(tabId, { type: 'ping' }, (response) => {
                        if (chrome.runtime.lastError) {
                          reject(new Error(chrome.runtime.lastError.message));
                        } else {
                          resolve(response);
                        }
                      });
                    });
                    if (pingResponse && pingResponse.ok) {
                      contentReady = true;
                      break;
                    }
                  } catch (_) {
                    // content script可能还没加载
                  }
                  
                  if (!contentReady) {
                    // 尝试重新注入content script
                    try {
                      await chrome.scripting.executeScript({
                        target: { tabId },
                        files: ['content/content.js']
                      });
                      await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (_) {
                      // 注入失败，继续等待
                    }
                  }
                  
                  await new Promise(resolve => setTimeout(resolve, 300));
                }
                
                // 再等待一下，确保动态内容加载完成
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log('✅ 新页面已就绪，content script已就绪');
              }
            } catch (e) {
              console.warn('检测页面跳转失败:', e);
            }
          }
          
          // 记录成功结果
          executionState.results.push({
            stepIndex: executionState.currentIndex,
            success: true,
            message: '执行成功'
          });
          
          executionState.currentIndex++;
          await chrome.storage.local.set({ 
            uiap_execution_state: executionState 
          });
          console.log(`✅ 步骤 ${executionState.currentIndex}/${executionState.steps.length} 执行成功`);
          
          // 间隔等待
          if (executionState.intervalMs > 0) {
            await new Promise(resolve => setTimeout(resolve, executionState.intervalMs));
          }
        } else {
          const errorMsg = response?.message || '未知错误';
          console.error('❌ 步骤执行失败:', errorMsg);
          
          // 记录失败结果
          executionState.results.push({
            stepIndex: executionState.currentIndex,
            success: false,
            message: errorMsg,
            step: step
          });
          
          // 不立即break，尝试继续执行下一步
          executionState.currentIndex++;
          await chrome.storage.local.set({ 
            uiap_execution_state: executionState 
          });
          console.log(`⚠️ 步骤执行失败，跳过继续: ${executionState.currentIndex}/${executionState.steps.length}`);
        }
      } catch (error) {
        const errorMsg = String(error.message || error);
        console.error('❌ 执行步骤异常:', errorMsg);
        
        // 如果是页面跳转导致的错误，等待页面加载后继续
        if (/port closed|Receiving end does not exist|message channel closed|Could not establish connection/i.test(errorMsg)) {
          console.log('🔄 检测到页面跳转，等待新页面加载...');
          
          // 等待页面加载（缩短超时时间，避免长时间等待）
          await waitForTabUpdate(tabId, 8000);
          
          // 等待一下，确保content script加载完成
          await new Promise(resolve => setTimeout(resolve, 800));
          
          // 尝试重新注入content script
          try {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: ['content/content.js']
            });
            await new Promise(resolve => setTimeout(resolve, 500));
            console.log('✅ Content script已重新注入');
          } catch (injectError) {
            console.warn('重新注入失败:', injectError);
          }
          
          // 验证content script是否就绪
          let ready = false;
          for (let i = 0; i < 3; i++) {
            try {
              const pingResponse = await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tabId, { type: 'ping' }, (response) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                  } else {
                    resolve(response);
                  }
                });
              });
              if (pingResponse && pingResponse.ok) {
                ready = true;
                break;
              }
            } catch (_) {
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
          
          if (ready) {
            console.log('✅ Content script已就绪，继续执行');
            // 继续执行当前步骤（不增加索引，重试）
            continue;
          } else {
            console.warn('⚠️ Content script未就绪，跳过当前步骤继续');
            
            // 记录失败结果
            executionState.results.push({
              stepIndex: executionState.currentIndex,
              success: false,
              message: 'Content script未就绪',
              step: step
            });
            
            // 跳过当前步骤，继续下一个
            executionState.currentIndex++;
            await chrome.storage.local.set({ 
              uiap_execution_state: executionState 
            });
            continue;
          }
        } else {
          console.error('执行步骤失败:', errorMsg);
          
          // 记录失败结果
          executionState.results.push({
            stepIndex: executionState.currentIndex,
            success: false,
            message: errorMsg,
            step: step
          });
          
          break;
        }
      }
    }
    
    // 执行完成
    if (executionState.currentIndex >= executionState.steps.length) {
      executionState.isExecuting = false;
      
      // 保存执行结果
      const executionResult = {
        success: executionState.results.every(r => r.success),
        totalSteps: executionState.steps.length,
        successCount: executionState.results.filter(r => r.success).length,
        failCount: executionState.results.filter(r => !r.success).length,
        results: executionState.results
      };
      
      await chrome.storage.local.set({ 
        uiap_execution_result: executionResult 
      });
      
      await chrome.storage.local.remove('uiap_execution_state');
      console.log('✅ 所有步骤执行完成', executionResult);
    } else {
      // 执行中断，也保存结果
      executionState.isExecuting = false;
      const executionResult = {
        success: false,
        totalSteps: executionState.steps.length,
        successCount: executionState.results.filter(r => r.success).length,
        failCount: executionState.results.filter(r => !r.success).length,
        results: executionState.results,
        interrupted: true,
        interruptedAt: executionState.currentIndex
      };
      
      await chrome.storage.local.set({ 
        uiap_execution_result: executionResult 
      });
      
      await chrome.storage.local.remove('uiap_execution_state');
      console.log('⚠️ 执行中断，当前索引:', executionState.currentIndex, '总步骤:', executionState.steps.length);
    }
  } catch (error) {
    console.error('❌ 执行失败:', error);
    executionState.isExecuting = false;
    
    // 保存错误结果
    const executionResult = {
      success: false,
      totalSteps: executionState.steps?.length || 0,
      successCount: executionState.results?.filter(r => r.success).length || 0,
      failCount: executionState.results?.filter(r => !r.success).length || 0,
      results: executionState.results || [],
      error: error.message || String(error)
    };
    
    await chrome.storage.local.set({ 
      uiap_execution_result: executionResult 
    });
    
    await chrome.storage.local.remove('uiap_execution_state');
  }
}

// 等待页面就绪
async function waitForPageReady(tabId, maxWait = 10000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkReady = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          resolve();
          return;
        }
      } catch (_) {
        // tab可能不存在
      }
      
      if (Date.now() - startTime > maxWait) {
        resolve(); // 超时也继续
        return;
      }
      
      setTimeout(checkReady, 200);
    };
    checkReady();
  });
}

// 等待标签页更新（页面跳转）
async function waitForTabUpdate(tabId, maxWait = 8000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let lastUrl = null;
    let lastStatus = null;
    let checkCount = 0;
    let resolved = false;
    
    // 先获取初始状态
    chrome.tabs.get(tabId).then(tab => {
      if (tab && !resolved) {
        lastUrl = tab.url;
        lastStatus = tab.status;
      }
    }).catch(() => {});
    
    const checkUpdate = async () => {
      if (resolved) return;
      checkCount++;
      
      try {
        const tab = await chrome.tabs.get(tabId);
        
        // 检查URL是否变化
        if (tab.url && lastUrl && tab.url !== lastUrl) {
          console.log('✅ 检测到URL变化:', lastUrl, '->', tab.url);
          resolved = true;
          // 等待页面加载完成
          if (tab.status === 'complete') {
            await new Promise(r => setTimeout(r, 600));
          } else {
            await new Promise(r => setTimeout(r, 1000));
          }
          resolve();
          return;
        }
        
        // 检查状态是否从loading变为complete
        if (lastStatus === 'loading' && tab.status === 'complete') {
          console.log('✅ 页面加载完成');
          resolved = true;
          await new Promise(r => setTimeout(r, 500));
          resolve();
          return;
        }
        
        // 如果页面已经是complete状态，且检查了多次，认为已就绪
        if (tab.status === 'complete' && checkCount > 5) {
          console.log('✅ 页面已就绪（多次检查后）');
          resolved = true;
          await new Promise(r => setTimeout(r, 400));
          resolve();
          return;
        }
        
        lastUrl = tab.url;
        lastStatus = tab.status;
      } catch (e) {
        // tab可能不存在或已关闭
        if (checkCount > 10) {
          console.warn('标签页可能已关闭，继续执行');
          resolved = true;
          resolve();
          return;
        }
      }
      
      if (Date.now() - startTime > maxWait) {
        console.warn('⏰ 等待页面更新超时，继续执行');
        resolved = true;
        resolve();
        return;
      }
      
      setTimeout(checkUpdate, 200);
    };
    
    // 延迟一点开始检查，给页面跳转时间
    setTimeout(checkUpdate, 300);
  });
}

// 监听标签页更新（页面跳转时自动继续执行）
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, _tab) => {
  if (changeInfo.status === 'complete' && executionState.isExecuting && executionState.tabId === tabId) {
    console.log('🔄 检测到页面更新，等待content script就绪后继续执行步骤');
    
    // 等待content script加载完成
    let contentReady = false;
    for (let i = 0; i < 10; i++) {
      try {
        const pingResponse = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, { type: 'ping' }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        });
        if (pingResponse && pingResponse.ok) {
          contentReady = true;
          break;
        }
      } catch (_) {
        // content script可能还没加载
      }
      
      if (!contentReady) {
        // 尝试重新注入content script
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content/content.js']
          });
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (_) {
          // 注入失败，继续等待
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // 再等待一下，确保动态内容加载完成
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (contentReady) {
      console.log('✅ Content script已就绪，继续执行步骤');
      await executeSteps(tabId);
    } else {
      console.warn('⚠️ Content script未就绪，但继续尝试执行');
      await executeSteps(tabId);
    }
  }
});

// 插件重启时清除执行状态（避免自动恢复执行）
(async () => {
  try {
    const data = await chrome.storage.local.get('uiap_execution_state');
    if (data.uiap_execution_state && data.uiap_execution_state.isExecuting) {
      console.log('🔄 插件重启，清除之前的执行状态');
      // 清除执行状态，避免自动恢复执行
      executionState.isExecuting = false;
      await chrome.storage.local.remove('uiap_execution_state');
    }
  } catch (e) {
    console.error('清除执行状态失败:', e);
  }
})();
