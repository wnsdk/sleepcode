const test = require('node:test');
const assert = require('node:assert/strict');

const { addTasksDuringExecution } = require('../bin/lib/runTaskExpansion');

test('addTasksDuringExecution appends tasks to existing workers and logs additions', () => {
  const executingTaskIds = new Set(['existing']);
  const appendCalls = [];
  const logs = [];
  let renderCalls = 0;

  addTasksDuringExecution({
    newTasks: [
      { id: 'main-1', title: '메인 추가', worker: '' },
      { id: 'feature-1', title: '워커 추가', worker: '@worker feature-a' },
    ],
    schema: { status_prop: 'Status' },
    executingTaskIds,
    currentWorkerStates: [{ name: 'main' }, { name: 'feature-a' }],
    currentNotionTasks: [],
    notionInProgressIds: new Set(),
    updatePage: () => true,
    syncWorkerTaskProgress: () => {},
    targetDir: 'C:\\workspace\\sleepcode',
    logDir: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\logs',
    createWorktrees: () => [],
    createRunTimestamp: () => '2026-03-07T10-00-00',
    createDynamicWorkerState: () => null,
    setWatchPhase: () => {},
    spawnRunWorker: () => {},
    scheduleRender: () => {
      renderCalls += 1;
    },
    pushLog: (...args) => logs.push(args),
    appendWorkerTasksFn: (args) => {
      appendCalls.push(args);
      return { ok: true };
    },
    startDynamicWorkerFn: () => {
      throw new Error('should not start a new worker');
    },
  });

  assert.deepEqual([...executingTaskIds], ['existing', 'main-1', 'feature-1']);
  assert.equal(appendCalls.length, 2);
  assert.equal(appendCalls[0].workerState.name, 'main');
  assert.equal(appendCalls[1].workerState.name, 'feature-a');
  assert.equal(renderCalls, 1);
  assert.equal(logs.some((entry) => entry[1].includes('메인 추가') && entry[1].includes('main')), true);
  assert.equal(logs.some((entry) => entry[1].includes('워커 추가') && entry[1].includes('feature-a')), true);
});

test('addTasksDuringExecution starts a new worker and forwards tracked run updates', () => {
  const logs = [];
  const applyCalls = [];
  const currentWorkerStates = [{ name: 'main' }];
  let renderCalls = 0;

  addTasksDuringExecution({
    newTasks: [{ id: 'feature-1', title: '새 워커 태스크', worker: '@worker feature-a' }],
    schema: { status_prop: 'Status' },
    executingTaskIds: new Set(),
    currentWorkerStates,
    currentNotionTasks: [],
    notionInProgressIds: new Set(),
    updatePage: () => true,
    syncWorkerTaskProgress: () => {},
    targetDir: 'C:\\workspace\\sleepcode',
    logDir: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\logs',
    createWorktrees: () => [],
    createRunTimestamp: () => '2026-03-07T10-00-00',
    createDynamicWorkerState: () => ({ name: 'feature-a' }),
    setWatchPhase: () => {},
    spawnRunWorker: () => {},
    scheduleRender: () => {
      renderCalls += 1;
    },
    pushLog: (...args) => logs.push(args),
    appendWorkerTasksFn: () => {
      throw new Error('existing worker append should not run');
    },
    startDynamicWorkerFn: (args) => {
      args.applyRunTaskUpdates({
        tasks: args.tasks,
        schema: args.schema,
        firstRunningTaskIds: new Set(['feature-1']),
        options: { trackTasks: false },
      });
      return { name: 'feature-a' };
    },
    applyTaskRunUpdatesFn: (args) => {
      applyCalls.push(args);
    },
  });

  assert.equal(renderCalls, 1);
  assert.equal(applyCalls.length, 1);
  assert.deepEqual(applyCalls[0].tasks.map((task) => task.id), ['feature-1']);
  assert.equal(applyCalls[0].trackTasks, false);
  assert.equal(logs.length, 0);
});

test('addTasksDuringExecution falls back to main when worktree creation fails in single-main mode', () => {
  const logs = [];
  const appendCalls = [];
  let renderCalls = 0;

  addTasksDuringExecution({
    newTasks: [{ id: 'feature-1', title: '새 워커 태스크', worker: '@worker feature-a' }],
    schema: { status_prop: 'Status' },
    executingTaskIds: new Set(),
    currentWorkerStates: [{ name: 'main' }],
    currentNotionTasks: [],
    notionInProgressIds: new Set(),
    updatePage: () => true,
    syncWorkerTaskProgress: () => {},
    targetDir: 'C:\\workspace\\sleepcode',
    logDir: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\logs',
    createWorktrees: () => [],
    createRunTimestamp: () => '2026-03-07T10-00-00',
    createDynamicWorkerState: () => null,
    setWatchPhase: () => {},
    spawnRunWorker: () => {},
    scheduleRender: () => {
      renderCalls += 1;
    },
    pushLog: (...args) => logs.push(args),
    startDynamicWorkerFn: () => null,
    isSingleMainWorkerModeFn: () => true,
    appendWorkerTasksFn: (args) => {
      appendCalls.push(args);
      if (args.onSuccess) {
        args.onSuccess();
      }
      return { ok: true };
    },
  });

  assert.equal(appendCalls.length, 1);
  assert.equal(appendCalls[0].workerState.name, 'main');
  assert.equal(renderCalls, 1);
  assert.equal(logs.some((entry) => entry[1].includes('worktree 생성 실패') && entry[1].includes('main에 1개 태스크 추가')), true);
});
