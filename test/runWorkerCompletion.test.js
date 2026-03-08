const test = require('node:test');
const assert = require('node:assert/strict');

const {
  areAllWorkersSettled,
  mergeCompletedWorkerNow,
} = require('../bin/lib/runWorkerCompletion');

test('mergeCompletedWorkerNow marks main workers as merged without running a merge', () => {
  let called = false;
  const worker = { name: 'main', status: 'done', merged: false };

  const result = mergeCompletedWorkerNow({
    completedWorker: worker,
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'claude',
    autoMergeWorktrees: () => {
      called = true;
      return { merged: [], conflicted: [], skipped: [] };
    },
    pushLog: () => {},
  });

  assert.equal(result.attempted, false);
  assert.equal(worker.merged, true);
  assert.equal(called, false);
});

test('mergeCompletedWorkerNow defers non-main merges until every worker settles', () => {
  const logs = [];
  const worker = { name: 'feature-a', status: 'done', merged: false };
  let called = false;

  const result = mergeCompletedWorkerNow({
    completedWorker: worker,
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'claude',
    autoMergeWorktrees: () => {
      called = true;
      return { merged: ['feature-a'], conflicted: [], skipped: [] };
    },
    pushLog: (message) => logs.push(message),
  });

  assert.equal(result.attempted, false);
  assert.equal(result.deferred, true);
  assert.equal(result.merged, false);
  assert.equal(worker.merged, false);
  assert.equal(called, false);
  assert.equal(logs.some((message) => message.includes('일괄 병합 예정')), true);
});

test('areAllWorkersSettled detects whether any worker is still running', () => {
  assert.equal(areAllWorkersSettled([{ status: 'done' }, { status: 'failed' }]), true);
  assert.equal(areAllWorkersSettled([{ status: 'done' }, { status: 'running' }]), false);
});
