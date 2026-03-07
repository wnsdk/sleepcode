const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSingleMainWorkerMode,
  startDynamicWorker,
  trackDynamicTaskIds,
} = require('../bin/lib/runDynamicTasks');

test('trackDynamicTaskIds registers every incoming task id', () => {
  const ids = new Set(['existing']);
  trackDynamicTaskIds(ids, [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual([...ids], ['existing', 'a', 'b']);
});

test('isSingleMainWorkerMode detects the single-main fallback state', () => {
  assert.equal(isSingleMainWorkerMode([{ name: 'main' }]), true);
  assert.equal(isSingleMainWorkerMode([{ name: 'feature-a' }]), false);
  assert.equal(isSingleMainWorkerMode([{ name: 'main' }, { name: 'feature-a' }]), false);
});

test('startDynamicWorker returns null when a worktree cannot be created', () => {
  const result = startDynamicWorker({
    currentWorkerStates: [{ name: 'main' }],
    workerName: 'feature-a',
    tasks: [{ id: 'task-1', title: '새 태스크' }],
    schema: {},
    targetDir: 'C:\\workspace\\sleepcode',
    logDir: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\logs',
    createWorktrees: () => [],
    createRunTimestamp: () => '2026-03-07T10-00-00',
    createDynamicWorkerState: () => null,
    applyRunTaskUpdates: () => {},
    setWatchPhase: () => {},
    pushLog: () => {},
    spawnRunWorker: () => {},
  });

  assert.equal(result, null);
});

test('startDynamicWorker applies run updates, appends worker state, and spawns the worker', () => {
  const workerStates = [{ name: 'main' }];
  const logs = [];
  const spawned = [];
  const phases = [];
  const updates = [];
  const newWorker = { name: 'feature-a', status: 'running' };

  const result = startDynamicWorker({
    currentWorkerStates: workerStates,
    workerName: 'feature-a',
    tasks: [{ id: 'task-1', title: '새 태스크' }, { id: 'task-2', title: '후속 태스크' }],
    schema: { status_prop: 'Status' },
    targetDir: 'C:\\workspace\\sleepcode',
    logDir: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\logs',
    createWorktrees: () => [],
    createRunTimestamp: () => '2026-03-07T10-00-00',
    createDynamicWorkerState: () => newWorker,
    applyRunTaskUpdates: (tasks, schema, firstRunningTaskIds, options) => {
      updates.push({ tasks, schema, firstRunningTaskIds: [...firstRunningTaskIds], options });
    },
    setWatchPhase: (phase) => phases.push(phase),
    pushLog: (message) => logs.push(message),
    spawnRunWorker: (worker) => spawned.push(worker),
  });

  assert.equal(result, newWorker);
  assert.deepEqual(workerStates, [{ name: 'main' }, newWorker]);
  assert.deepEqual(phases, ['executing']);
  assert.deepEqual(spawned, [newWorker]);
  assert.deepEqual(updates[0].firstRunningTaskIds, ['task-1']);
  assert.deepEqual(updates[0].options, { trackTasks: true });
  assert.equal(logs.some((message) => message.includes('새 워커') && message.includes('feature-a')), true);
});
