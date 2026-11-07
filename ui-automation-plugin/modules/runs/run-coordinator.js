import { PerfSession, buildPerfSegment } from '../perf/perf-session.js';

export class RunCoordinator {
  constructor({ client, driver, perfSession, clientVersion = '0.3.0' } = {}) {
    this.client = client;
    this.driver = driver;
    this.perfSession = perfSession || new PerfSession();
    this.clientVersion = clientVersion;
    this.currentRunId = null;
    this.lastResults = [];
    this.stopped = false;
  }

  async runCase({ caseItem, steps, perfMode = 'none' } = {}) {
    const caseId = caseItem.case_id;
    const run = await this.client.createRun({
      caseId,
      perfMode,
      stepsTotal: steps.length,
      clientVersion: this.clientVersion,
    });
    const runId = run.run_id;
    this.currentRunId = runId;
    this.lastResults = [];
    this.stopped = false;
    const segments = [];

    try {
      if (perfMode === 'case') {
        await this._startPerf();
      }

      for (let index = 0; index < steps.length; index++) {
        if (perfMode === 'step') {
          await this._startPerf();
        }

        let result;
        try {
          result = await this.driver.executeStep(steps[index], index);
        } finally {
          if (perfMode === 'step') {
            const summary = await this._stopPerf();
            if (summary && !this.stopped) {
              const segment = buildPerfSegment({
                heading: `用例「${caseItem.name}」步骤 ${index + 1}`,
                scope: 'step',
                stepIndex: index,
                summary,
              });
              await this.client.appendPerfSegment(runId, segment);
              segments.push(segment);
            }
          }
        }

        this.lastResults.push(result || { status: 'passed', stepIndex: index });
        if (this.stopped) {
          break;
        }
        if (result?.status === 'failed' || result?.status === 'error') {
          break;
        }
      }

      if (this.stopped) {
        this.currentRunId = null;
        return {
          runId,
          status: 'stopped',
          segments,
          stepsResult: this.lastResults,
        };
      }

      if (perfMode === 'case') {
        const summary = await this._stopPerf();
        if (summary) {
          const segment = buildPerfSegment({
            heading: `用例「${caseItem.name}」整条用例`,
            scope: 'case',
            summary,
          });
          await this.client.appendPerfSegment(runId, segment);
          segments.push(segment);
        }
      }

      const status = this.lastResults.some((item) => ['failed', 'error'].includes(item?.status))
        ? 'failed'
        : 'passed';
      await this.client.finishRun(runId, {
        status,
        finalResult: status,
        stepsResult: this.lastResults,
      });
      this.currentRunId = null;
      return { runId, status, segments, stepsResult: this.lastResults };
    } catch (error) {
      if (perfMode === 'case') {
        await this._stopPerf().catch(() => null);
      }
      try {
        await this.client.finishRun(runId, {
          status: 'error',
          finalResult: 'error',
          stepsResult: this.lastResults,
          errorMessage: error.message || String(error),
        });
      } finally {
        this.currentRunId = null;
      }
      throw error;
    }
  }

  async stop() {
    if (!this.currentRunId) {
      return null;
    }
    const runId = this.currentRunId;
    this.stopped = true;
    if (typeof this.driver.stop === 'function') {
      await this.driver.stop();
    }
    await this._stopPerf().catch(() => null);
    const response = await this.client.finishRun(runId, {
      status: 'stopped',
      finalResult: 'stopped',
      stepsResult: this.lastResults,
    });
    this.currentRunId = null;
    return response;
  }

  async _startPerf() {
    try {
      const data = await this.perfSession.start();
      if (!data?.ok) {
        console.warn('性能 tracing 启动失败:', data?.error || data);
      }
    } catch (error) {
      console.warn('性能 tracing 启动异常:', error);
    }
  }

  async _stopPerf() {
    try {
      const data = await this.perfSession.stop();
      return data?.ok ? (data.summary || {}) : null;
    } catch (error) {
      console.warn('性能 tracing 停止异常:', error);
      return null;
    }
  }
}
