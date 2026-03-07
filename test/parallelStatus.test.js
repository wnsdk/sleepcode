const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { buildParallelStatusRows } = require('../bin/lib/parallelStatus');

test('buildParallelStatusRows reads persisted progress when runtime queues exist', () => {
  const worktreesDir = path.join('C:\\workspace\\sleepcode', '.sleepcode', 'runtime', 'worktrees');
  const featurePath = path.join(worktreesDir, 'feature-a');
  const mainTasksPath = path.join('C:\\workspace\\sleepcode', '.sleepcode', 'runtime', 'task_queue.md');
  const featureTasksPath = path.join(featurePath, '.sleepcode', 'runtime', 'task_queue.md');

  const calls = [];
  const rows = buildParallelStatusRows({
    targetDir: 'C:\\workspace\\sleepcode',
    workers: [
      { name: 'main', remaining: 2 },
      { name: 'feature-a', remaining: 3 },
      { name: 'feature-b', remaining: 4 },
    ],
    existsSync: (targetPath) => [mainTasksPath, featurePath, featureTasksPath].includes(targetPath),
    getPersistedTaskProgressFn: (workerDir, tasksPath) => {
      calls.push({ workerDir, tasksPath });
      return tasksPath === mainTasksPath
        ? { counts: { done: 1, total: 2 } }
        : { counts: { done: 2, total: 3 } };
    },
    getRuntimeMainTaskQueuePathFn: () => mainTasksPath,
    getRuntimeTaskQueuePathFn: (workerDir) => path.join(workerDir, '.sleepcode', 'runtime', 'task_queue.md'),
    getRuntimeWorktreesDirFn: () => worktreesDir,
  });

  assert.deepEqual(rows, [
    { done: 1, exists: true, isMainWorker: true, name: 'main', total: 2 },
    { done: 2, exists: true, isMainWorker: false, name: 'feature-a', total: 3 },
    { done: 0, exists: false, isMainWorker: false, name: 'feature-b', total: 4 },
  ]);
  assert.deepEqual(calls, [
    { workerDir: 'C:\\workspace\\sleepcode', tasksPath: mainTasksPath },
    { workerDir: featurePath, tasksPath: featureTasksPath },
  ]);
});
