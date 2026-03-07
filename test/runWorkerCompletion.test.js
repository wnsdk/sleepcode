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

test('mergeCompletedWorkerNow logs merge success and marks worker as merged', () => {
  const logs = [];
  const worker = { name: 'feature-a', status: 'done', merged: false };

  const result = mergeCompletedWorkerNow({
    completedWorker: worker,
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'claude',
    autoMergeWorktrees: () => ({ merged: ['feature-a'], conflicted: [], skipped: [] }),
    pushLog: (message) => logs.push(message),
  });

  assert.equal(result.attempted, true);
  assert.equal(result.merged, true);
  assert.equal(worker.merged, true);
  assert.equal(logs.some((message) => message.includes('병합 완료')), true);
});

test('areAllWorkersSettled detects whether any worker is still running', () => {
  assert.equal(areAllWorkersSettled([{ status: 'done' }, { status: 'failed' }]), true);
  assert.equal(areAllWorkersSettled([{ status: 'done' }, { status: 'running' }]), false);
});
