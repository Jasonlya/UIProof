import assert from 'node:assert/strict';
import test from 'node:test';

import { RunCoordinator } from '../../ui-automation-plugin/modules/runs/run-coordinator.js';


function createHarness({ executeStep, startOk = true } = {}) {
  const calls = {
    createRun: [],
    appendPerfSegment: [],
    finishRun: [],
  };
  const client = {
    async createRun(payload) { calls.createRun.push(payload); return { run_id: 'run-1' }; },
    async appendPerfSegment(runId, segment) { calls.appendPerfSegment.push({ runId, segment }); },
    async finishRun(runId, payload) { calls.finishRun.push({ runId, payload }); return payload; },
  };
  const perfSession = {
    async start() { return { ok: startOk }; },
    async stop() { return { ok: startOk, summary: { totalEvents: 2 } }; },
  };
  const driver = {
    executeStep: executeStep || (async (_step, index) => ({ status: 'passed', stepIndex: index })),
    async stop() {},
  };
  return {
    calls,
    coordinator: new RunCoordinator({ client, driver, perfSession }),
  };
}


test('RunCoordinator records one performance segment per step and finishes passed', async () => {
  const { calls, coordinator } = createHarness();
  const result = await coordinator.runCase({
    caseItem: { case_id: 'case-1', name: 'Checkout' },
    steps: [{ type: 'click' }, { type: 'input' }],
    perfMode: 'step',
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.segments.length, 2);
  assert.equal(calls.appendPerfSegment.length, 2);
  assert.equal(calls.appendPerfSegment[1].segment.stepIndex, 1);
  assert.equal(calls.finishRun[0].payload.status, 'passed');
  assert.equal(calls.finishRun[0].payload.stepsResult.length, 2);
});


test('RunCoordinator records a case segment for whole-case mode', async () => {
  const { calls, coordinator } = createHarness();
  const result = await coordinator.runCase({
    caseItem: { case_id: 'case-1', name: 'Checkout' },
    steps: [{ type: 'click' }, { type: 'input' }],
    perfMode: 'case',
  });

  assert.equal(result.segments.length, 1);
  assert.equal(calls.appendPerfSegment[0].segment.scope, 'case');
});


test('RunCoordinator finishes error and rethrows when the driver fails', async () => {
  const { calls, coordinator } = createHarness({
    executeStep: async () => { throw new Error('driver exploded'); },
  });

  await assert.rejects(
    () => coordinator.runCase({
      caseItem: { case_id: 'case-1', name: 'Broken' },
      steps: [{ type: 'click' }],
      perfMode: 'step',
    }),
    /driver exploded/,
  );
  assert.equal(calls.finishRun[0].payload.status, 'error');
  assert.equal(calls.finishRun[0].payload.errorMessage, 'driver exploded');
});


test('RunCoordinator finishes stopped without appending late segments', async () => {
  let releaseStep;
  let markStarted;
  const stepStarted = new Promise((resolve) => { markStarted = resolve; });
  const stepGate = new Promise((resolve) => { releaseStep = resolve; });
  const { calls, coordinator } = createHarness({
    executeStep: async (_step, index) => {
      markStarted();
      await stepGate;
      return { status: 'passed', stepIndex: index };
    },
  });

  const runPromise = coordinator.runCase({
    caseItem: { case_id: 'case-1', name: 'Stoppable' },
    steps: [{ type: 'click' }],
    perfMode: 'step',
  });
  await stepStarted;
  await coordinator.stop();
  releaseStep();

  const result = await runPromise;
  assert.equal(result.status, 'stopped');
  assert.equal(calls.appendPerfSegment.length, 0);
  assert.equal(calls.finishRun.length, 1);
  assert.equal(calls.finishRun[0].payload.status, 'stopped');
});
