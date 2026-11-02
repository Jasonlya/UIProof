// modules/execution/execution-manager.js
// AI 执行管理器 — 触发 Playwright + AI Agent 执行，SSE 实时进度

export class ExecutionManager {
  constructor() {
    this.SERVER_URL = 'http://localhost:5001';
    this.currentTaskId = null;
    this.eventSource = null;
    this.onProgress = null; // 回调: (progressData) => void
    this.onComplete = null; // 回调: (result) => void
    this.onError = null;    // 回调: (error) => void
  }

  /** 启动 AI 执行单条用例 */
  async runCase(caseId) {
    try {
      const resp = await fetch(`${this.SERVER_URL}/api/execution/run/${caseId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await resp.json();

      if (data.task_id) {
        this.currentTaskId = data.task_id;
        this._startSSE(data.task_id);
      }

      return data;
    } catch (e) {
      console.error('启动执行失败:', e);
      return { error: e.message };
    }
  }

  /** 批量执行 */
  async runBatch(caseIds) {
    try {
      const resp = await fetch(`${this.SERVER_URL}/api/execution/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_ids: caseIds }),
      });
      const data = await resp.json();

      if (data.task_id) {
        this.currentTaskId = data.task_id;
        this._startSSE(data.task_id);
      }

      return data;
    } catch (e) {
      console.error('批量执行失败:', e);
      return { error: e.message };
    }
  }

  /** 停止执行 */
  async stop() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.currentTaskId) {
      try {
        await fetch(`${this.SERVER_URL}/api/execution/stop/${this.currentTaskId}`, { method: 'POST' });
      } catch (_) {}
      this.currentTaskId = null;
    }
  }

  /** 查询执行状态 */
  async getStatus(taskId) {
    try {
      const resp = await fetch(`${this.SERVER_URL}/api/execution/status/${taskId || this.currentTaskId}`);
      return await resp.json();
    } catch (e) {
      return { error: e.message };
    }
  }

  /** 启动 SSE 监听 */
  _startSSE(taskId) {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource(`${this.SERVER_URL}/api/execution/stream/${taskId}`);

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'step_complete') {
          this.onProgress && this.onProgress(data);
        } else if (data.type === 'execution_complete' || data.type === 'case_complete') {
          this.onComplete && this.onComplete(data);
          this.eventSource.close();
          this.eventSource = null;
          this.currentTaskId = null;
        } else if (data.type === 'execution_error') {
          this.onError && this.onError(data);
          this.eventSource.close();
          this.eventSource = null;
          this.currentTaskId = null;
        } else if (data.type === 'batch_complete') {
          this.onComplete && this.onComplete(data);
          this.eventSource.close();
          this.eventSource = null;
          this.currentTaskId = null;
        }
      } catch (e) {
        console.warn('SSE 数据解析失败:', e);
      }
    };

    this.eventSource.onerror = (e) => {
      console.warn('SSE 连接错误:', e);
      // 不自动关闭，让浏览器重连
    };
  }
}
