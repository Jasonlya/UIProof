export function buildPerfSegment({ heading, scope = 'case', stepIndex = null, summary } = {}) {
  return {
    scope,
    stepIndex: scope === 'step' ? stepIndex : null,
    heading,
    summary: summary || {},
  };
}

export class PerfSession {
  constructor({ start, stop } = {}) {
    this.startTracing = start;
    this.stopTracing = stop;
    this.active = false;
  }

  async start() {
    if (typeof this.startTracing !== 'function') {
      return { ok: false, error: 'perf_start_unavailable' };
    }
    const result = await this.startTracing();
    this.active = !!result?.ok;
    return result;
  }

  async stop() {
    if (!this.active || typeof this.stopTracing !== 'function') {
      this.active = false;
      return { ok: false, error: 'perf_not_active' };
    }
    const result = await this.stopTracing();
    this.active = false;
    return result;
  }
}
