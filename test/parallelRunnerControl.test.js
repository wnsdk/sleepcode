const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyParallelBudgetStop,
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

test('mergeCompletedParallelWorker auto-merges completed workers and marks skipped merges', () => {
  const logs = [];
  const completedWorker = { name: 'feature-a', status: 'done', merged: false };

  const mergedResult = mergeCompletedParallelWorker({
    completedWorker,
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    dashboard: {
      pushLog: (...args) => logs.push(args),
    },
    autoMergeWorktreesFn: () => ({
      merged: [completedWorker],
      skipped: [],
      conflicted: [],
    }),
  });

  assert.deepEqual(mergedResult, { merged: true, skipped: false, conflicted: false });
  assert.equal(completedWorker.merged, true);
  assert.match(logs[0][1], /즉시 병합 중/);
  assert.match(logs[1][1], /병합 완료/);

  const skippedLogs = [];
  const skippedWorker = { name: 'feature-b', status: 'done', merged: false };
  const skippedResult = mergeCompletedParallelWorker({
    completedWorker: skippedWorker,
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    dashboard: {
      pushLog: (...args) => skippedLogs.push(args),
    },
    autoMergeWorktreesFn: () => ({
      merged: [],
      skipped: [skippedWorker],
      conflicted: [],
    }),
  });

  assert.deepEqual(skippedResult, { merged: false, skipped: true, conflicted: false });
  assert.equal(skippedWorker.merged, true);
  assert.match(skippedLogs[1][1], /병합 스킵/);
});

test('mergeCompletedParallelWorker reports conflicts and merge errors without throwing', () => {
  const conflictLogs = [];
  const conflictResult = mergeCompletedParallelWorker({
    completedWorker: { name: 'feature-c', status: 'done' },
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    dashboard: {
      pushLog: (...args) => conflictLogs.push(args),
    },
    autoMergeWorktreesFn: () => ({
      merged: [],
      skipped: [],
      conflicted: [{}],
    }),
  });

  assert.deepEqual(conflictResult, { merged: false, skipped: false, conflicted: true });
  assert.match(conflictLogs[1][1], /병합 충돌/);

  const errorLogs = [];
  const errorResult = mergeCompletedParallelWorker({
    completedWorker: { name: 'feature-d', status: 'done' },
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    dashboard: {
      pushLog: (...args) => errorLogs.push(args),
    },
    autoMergeWorktreesFn: () => {
      throw new Error('merge failed');
    },
  });

  assert.equal(errorResult.error.message, 'merge failed');
  assert.match(errorLogs[1][1], /병합 오류: merge failed/);
});
