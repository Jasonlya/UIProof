/**
 * 侧边栏 / 管理器侧调用的性能模块：转发到 background（chrome.debugger + CDP）
 */

function sendPerfMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(response);
      });
    } catch (e) {
      reject(e);
    }
  });
}

export async function extensionPerfTracingStart(tabId) {
  return sendPerfMessage({ type: 'perfTracingStart', tabId });
}

export async function extensionPerfTracingStop(tabId) {
  return sendPerfMessage({ type: 'perfTracingStop', tabId });
}
