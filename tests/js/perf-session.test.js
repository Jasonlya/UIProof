import assert from 'node:assert/strict';
import test from 'node:test';

import { PerfSession, buildPerfSegment } from '../../ui-automation-plugin/modules/perf/perf-session.js';


test('PerfSession starts and stops once per active interval', async () => {
  const calls = [];
  const session = new PerfSession({
    start: async () => { calls.push('start'); return { ok: true }; },
    stop: async () => { calls.push('stop'); return { ok: true, summary: { totalEvents: 7 } }; },
  });

  assert.equal((await session.start()).ok, true);
  assert.deepEqual(await session.stop(), { ok: true, summary: { totalEvents: 7 } });
  assert.deepEqual(await session.stop(), { ok: false, error: 'perf_not_active' });
  assert.deepEqual(calls, ['start', 'stop']);
});


test('buildPerfSegment normalizes step and case scopes', () => {
  assert.deepEqual(buildPerfSegment({ heading: 'Step', scope: 'step', stepIndex: 1, summary: {} }), {
    scope: 'step', stepIndex: 1, heading: 'Step', summary: {},
  });
  assert.equal(buildPerfSegment({ heading: 'Case', scope: 'case', stepIndex: 1 }).stepIndex, null);
});
