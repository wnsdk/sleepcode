const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyParallelBudgetStop,
  finalizeCompletedParallelWorkers,
  mergeCompletedParallelWorker,
  stopRunningWorkers,
  syncParallelWorkerProgress,
} = require('../bin/lib/parallelRunnerControl');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('stopRunningWorkers terminates tracked worker processes with an optional signal', () => {
  const killed = [];

  stopRunningWorkers([
    { _proc: { kill: (signal) => killed.push(signal || 'default') } },
    { _proc: { kill: () => { throw new Error('ignore'); } } },
    {},
  ], 'SIGINT');
  stopRunningWorkers([
    { _proc: { kill: (signal) => killed.push(signal || 'default') } },
  ]);

  assert.deepEqual(killed, ['SIGINT', 'default']);
});

test('syncParallelWorkerProgress refreshes only running workers and schedules a render', () => {
  withTempDir('sleepcode-parallel-runner-', (dir) => {
    const workerDir = path.join(dir, 'worker-main', '.sleepcode');
    fs.mkdirSync(workerDir, { recursive: true });
    const tasksPath = path.join(workerDir, 'task_queue.md');
    fs.writeFileSync(tasksPath, '- [ ] 태스크\n', 'utf-8');

    const syncCalls = [];
    let renderCalls = 0;

    syncParallelWorkerProgress({
      workerStates: [
        { name: 'main', status: 'running', path: path.join(dir, 'worker-main'), tasksPath },
        { name: 'done', status: 'done', path: path.join(dir, 'worker-done') },
      ],
      scheduleRender: () => {
        renderCalls += 1;
      },
      syncWorkerTaskProgressFn: (worker, _baseline, content) => {
        syncCalls.push({ name: worker.name, content });
      },
    });

    assert.deepEqual(syncCalls, [{ name: 'main', content: '- [ ] 태스크\n' }]);
    assert.equal(renderCalls, 1);
  });
});

test('applyParallelBudgetStop marks running workers as budget-stopped and logs once', () => {
  const logs = [];
  let renderCalls = 0;
  const killCalls = [];
  const workerStates = [
    {
      name: 'main',
      status: 'running',
      _proc: { kill: () => killCalls.push('main') },
      currentTask: 'task',
    },
    {
      name: 'done',
      status: 'done',
      _proc: { kill: () => killCalls.push('done') },
    },
  ];

  const result = applyParallelBudgetStop({
    targetDir: 'C:\\workspace\\sleepcode',
    workerStates,
    dashboard: {
      pushLog: (...args) => logs.push(args),
      renderDashboard: () => {
        renderCalls += 1;
      },
    },
    isOverBudgetFn: () => ({
      over: true,
      threshold: 90,
      total: 12.34,
    }),
  });

  assert.equal(result.stopped, true);
  assert.equal(workerStates[0].status, 'budget_stop');
  assert.equal(workerStates[0].currentTask, '한도 도달 — 중지됨');
  assert.equal(workerStates[1].status, 'done');
  assert.deepEqual(killCalls, ['main']);
  assert.equal(renderCalls, 1);
  assert.match(logs[0][1], /주간 한도 90% 도달/);
});

test('applyParallelBudgetStop leaves workers untouched when budget is still available', () => {
  const workerStates = [{ name: 'main', status: 'running' }];
  const result = applyParallelBudgetStop({
    targetDir: 'C:\\workspace\\sleepcode',
    workerStates,
    dashboard: {
      pushLog: () => {
        throw new Error('should not log');
      },
      renderDashboard: () => {
        throw new Error('should not render');
      },
    },
    isOverBudgetFn: () => ({ over: false }),
  });

  assert.equal(result.stopped, false);
  assert.equal(workerStates[0].status, 'running');
});

test('mergeCompletedParallelWorker defers non-main merges until the last worker finishes', () => {
  const logs = [];
  const completedWorker = { name: 'feature-a', status: 'done', merged: false };
  let called = false;

  const mergedResult = mergeCompletedParallelWorker({
    completedWorker,
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    dashboard: {
      pushLog: (...args) => logs.push(args),
    },
    autoMergeWorktreesFn: () => ({
      merged: (() => {
        called = true;
        return [completedWorker];
      })(),
      skipped: [],
      conflicted: [],
    }),
  });

  assert.deepEqual(mergedResult, { merged: false, skipped: false, conflicted: false, deferred: true });
  assert.equal(completedWorker.merged, false);
  assert.equal(called, false);
  assert.match(logs[0][1], /일괄 병합 예정/);
});

test('mergeCompletedParallelWorker marks main workers as merged without deferring', () => {
  const completedWorker = { name: 'main', status: 'done', merged: false, usesMainBranch: true };
  const result = mergeCompletedParallelWorker({
    completedWorker,
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    dashboard: {
      pushLog: () => {
        throw new Error('should not log');
      },
    },
  });

  assert.deepEqual(result, { merged: true, skipped: false, conflicted: false, deferred: false });
  assert.equal(completedWorker.merged, true);
});

test('finalizeCompletedParallelWorkers batch-merges after all workers finish', () => {
  const logs = [];
  const workerStates = [
    { name: 'main', status: 'done', merged: true },
    { name: 'feature-a', status: 'done', merged: false },
    { name: 'feature-b', status: 'failed', merged: false },
  ];

  const result = finalizeCompletedParallelWorkers({
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    workerStates,
    dashboard: {
      pushLog: (...args) => logs.push(args),
    },
    autoMergeWorktreesFn: () => ({
      merged: ['feature-a'],
      skipped: ['main'],
      conflicted: ['feature-b'],
    }),
  });

  assert.deepEqual(result, {
    merged: ['feature-a'],
    skipped: ['main'],
    conflicted: ['feature-b'],
  });
  assert.equal(workerStates[1].merged, true);
  assert.equal(workerStates[2].merged, false);
  assert.match(logs[0][1], /일괄 병합 시작/);
  assert.match(logs[1][1], /일괄 병합 완료: feature-a/);
  assert.match(logs[2][1], /병합 스킵: main/);
  assert.match(logs[3][1], /일괄 병합 충돌: feature-b/);
});

test('finalizeCompletedParallelWorkers reports merge errors without throwing', () => {
  const logs = [];
  const workerStates = [{ name: 'feature-d', status: 'done', merged: false }];

  const result = finalizeCompletedParallelWorkers({
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    workerStates,
    dashboard: {
      pushLog: (...args) => logs.push(args),
    },
    autoMergeWorktreesFn: () => {
      throw new Error('merge failed');
    },
  });

  assert.equal(result.error.message, 'merge failed');
  assert.deepEqual(result.conflicted, ['feature-d']);
  assert.match(logs[1][1], /일괄 병합 오류: merge failed/);
});
