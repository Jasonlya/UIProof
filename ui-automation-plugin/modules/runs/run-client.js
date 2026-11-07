const DEFAULT_SERVER_URL = 'http://localhost:5001';
const DEFAULT_CLIENT_VERSION = '0.3.0';

export class RunClient {
  constructor({ baseUrl = DEFAULT_SERVER_URL, fetchImpl, clientVersion = DEFAULT_CLIENT_VERSION } = {}) {
    this.baseUrl = String(baseUrl || DEFAULT_SERVER_URL).replace(/\/$/, '');
    this.fetchImpl = fetchImpl || globalThis.fetch.bind(globalThis);
    this.clientVersion = clientVersion;
  }

  async _request(path, { method = 'GET', body } = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  async createRun({ caseId, perfMode = 'none', stepsTotal = 0, clientVersion } = {}) {
    return this._request('/api/runs', {
      method: 'POST',
      body: {
        case_id: caseId,
        executor: 'extension',
        perf_mode: perfMode,
        steps_total: stepsTotal,
        client_version: clientVersion || this.clientVersion,
      },
    });
  }

  async updateRun(runId, payload = {}) {
    return this._request(`/api/runs/${runId}`, { method: 'PATCH', body: payload });
  }

  async appendPerfSegment(runId, segment) {
    return this._request(`/api/runs/${runId}/perf-segments`, {
      method: 'POST',
      body: {
        scope: segment.scope,
        step_index: segment.stepIndex ?? null,
        heading: segment.heading,
        summary: segment.summary,
      },
    });
  }

  async finishRun(runId, payload = {}) {
    return this._request(`/api/runs/${runId}/finish`, {
      method: 'POST',
      body: {
        status: payload.status,
        final_result: payload.finalResult ?? null,
        steps_result: payload.stepsResult || [],
        error_message: payload.errorMessage ?? null,
        perf_summary: payload.perfSummary ?? null,
      },
    });
  }

  async getRun(runId) {
    return this._request(`/api/runs/${runId}`);
  }
}
