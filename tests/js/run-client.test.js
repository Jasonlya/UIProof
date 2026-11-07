import assert from 'node:assert/strict';
import test from 'node:test';

import { RunClient } from '../../ui-automation-plugin/modules/runs/run-client.js';


function mockFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    const next = responses.shift();
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    };
  };
  return { calls, fetchImpl };
}


test('RunClient sends run lifecycle payloads', async () => {
  const { calls, fetchImpl } = mockFetch([
    { status: 201, body: { run_id: 'run-1', status: 'running' } },
    { status: 201, body: { segment_index: 0 } },
    { status: 200, body: { run_id: 'run-1', status: 'passed' } },
  ]);
  const client = new RunClient({ baseUrl: 'http://example.test', fetchImpl, clientVersion: '9.9.9' });

  await client.createRun({ caseId: 'case-1', perfMode: 'step', stepsTotal: 2 });
  await client.appendPerfSegment('run-1', {
    scope: 'step', stepIndex: 0, heading: 'Step 1', summary: { totalEvents: 3 },
  });
  await client.finishRun('run-1', {
    status: 'passed', finalResult: 'passed', stepsResult: [{ status: 'passed' }],
  });

  assert.equal(calls[0].url, 'http://example.test/api/runs');
  assert.deepEqual(calls[0].body, {
    case_id: 'case-1',
    executor: 'extension',
    perf_mode: 'step',
    steps_total: 2,
    client_version: '9.9.9',
  });
  assert.equal(calls[1].url, 'http://example.test/api/runs/run-1/perf-segments');
  assert.deepEqual(calls[1].body, {
    scope: 'step', step_index: 0, heading: 'Step 1', summary: { totalEvents: 3 },
  });
  assert.equal(calls[2].url, 'http://example.test/api/runs/run-1/finish');
  assert.equal(calls[2].body.status, 'passed');
  assert.equal(calls[2].body.final_result, 'passed');
  assert.equal(calls[2].body.steps_result.length, 1);
});


test('RunClient surfaces API errors', async () => {
  const { fetchImpl } = mockFetch([{ status: 404, body: { error: 'not_found', message: 'Run missing' } }]);
  const client = new RunClient({ fetchImpl });
  await assert.rejects(() => client.getRun('missing'), /Run missing/);
});
