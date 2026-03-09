const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildExecutionPlan,
  createDynamicWorkerState,
  prepareParallelExecution,
} = require('../bin/lib/runExecution');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('buildExecutionPlan determines worker groups for parallel execution', () => {
  const plan = buildExecutionPlan([
    { id: 'a', title: '메인', worker: '' },
    { id: 'b', title: '워커', worker: '@worker feature-a' },
  ]);

  assert.deepEqual(plan.workerNames, ['main', 'feature-a']);
  assert.deepEqual(plan.workerGroups.main.map((task) => task.id), ['a']);
  assert.deepEqual(plan.workerGroups['feature-a'].map((task) => task.id), ['b']);
});

test('buildExecutionPlan uses defaultWorker even for a single worker queue', () => {
  const plan = buildExecutionPlan([
    { id: 'a', title: '태스크1', worker: '' },
    { id: 'b', title: '태스크2', worker: '' },
  ], { defaultWorker: 'dev' });

  assert.deepEqual(plan.workerNames, ['dev']);
  assert.deepEqual(plan.workerGroups.dev.map((task) => task.id), ['a', 'b']);
});

test('prepareParallelExecution writes runtime queue and returns worker states', () => {
  withTempDir('sleepcode-run-exec-', (dir) => {
    const runtimeTasksPath = path.join(dir, 'task_queue.md');
    const syncProgressCalls = [];
    const workerStates = prepareParallelExecution({
      targetDir: dir,
      runtimeTasksPath,
      workerGroups: {
        main: [{ id: 'a', title: '메인 태스크' }],
        bugfix: [{ id: 'b', title: '버그 수정' }],
      },
      timestamp: '2026-03-07T10-00-00',
      logDir: path.join(dir, 'logs'),
      syncClaudeMd: () => {},
      parseParallelTasks: () => [
        { name: 'main', path: path.join(dir, 'wt-main'), tasksPath: path.join(dir, 'wt-main', '.sleepcode', 'task_queue.md') },
        { name: 'bugfix', path: path.join(dir, 'wt-bugfix'), tasksPath: path.join(dir, 'wt-bugfix', '.sleepcode', 'task_queue.md') },
      ],
      createWorktrees: (_targetDir, workers) => workers,
      syncWorkerTaskProgress: (workerState) => syncProgressCalls.push(workerState.name),
    });

    const content = fs.readFileSync(runtimeTasksPath, 'utf-8');
    assert.match(content, /## @worker main/);
    assert.match(content, /## @worker bugfix/);
    assert.deepEqual(workerStates.map((worker) => worker.name), ['main', 'bugfix']);
    assert.deepEqual(workerStates[0].taskEntries.map((task) => task.id), ['a']);
    assert.deepEqual(workerStates[1].taskEntries.map((task) => task.id), ['b']);
    assert.deepEqual(syncProgressCalls, ['main', 'bugfix']);
  });
});

test('createDynamicWorkerState returns null when no worktree is created', () => {
  const result = createDynamicWorkerState({
    targetDir: 'C:\\workspace\\sleepcode',
    workerName: 'feature-a',
    tasks: [{ id: 'a', title: '새 태스크' }],
    timestamp: '2026-03-07T10-00-00',
    logDir: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\logs',
    createWorktrees: () => [],
  });

  assert.equal(result, null);
});

test('createDynamicWorkerState builds a running worker from a created worktree', () => {
  let capturedWorkers = null;
  const result = createDynamicWorkerState({
    targetDir: 'C:\\workspace\\sleepcode',
    workerName: 'feature-a',
    tasks: [{ id: 'a', title: '새 태스크' }],
    timestamp: '2026-03-07T10-00-00',
    logDir: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\logs',
    createWorktrees: (_targetDir, workers) => {
      capturedWorkers = workers;
      return [{
        name: 'feature-a',
        path: 'C:\\workspace\\sleepcode\\.sleepcode\\worktrees\\feature-a',
        tasksPath: 'C:\\workspace\\sleepcode\\.sleepcode\\worktrees\\feature-a\\.sleepcode\\task_queue.md',
      }];
    },
  });

  assert.equal(result.name, 'feature-a');
  assert.equal(result.total, 1);
  assert.equal(result.merged, false);
  assert.deepEqual(result.taskEntries.map((task) => task.id), ['a']);
  assert.match(capturedWorkers[0].tasks, /## @worker feature-a/);
  assert.match(capturedWorkers[0].tasks, /새 태스크/);
});
