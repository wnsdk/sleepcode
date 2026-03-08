const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executeNotionTasks,
  finishExecution,
} = require('../bin/lib/runExecutionFlow');

test('executeNotionTasks prepares parallel workers, updates run state, and spawns each worker', () => {
  const calls = {
    logs: [],
    runState: [],
    workerStates: [],
    spawned: [],
    updates: [],
    phase: [],
  };
  const notionInProgressIds = new Set(['stale']);

  executeNotionTasks({
    tasks: [{ id: 'a', title: '메인' }, { id: 'b', title: '워커' }],
    schema: { status_prop: 'Status' },
    targetDir: 'C:\\workspace\\sleepcode',
    runtimeTasksPath: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\task_queue.md',
    logDir: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\logs',
    notionInProgressIds,
    updatePage: () => true,
    pushLog: (...args) => calls.logs.push(args),
    setWatchPhase: (phase) => calls.phase.push(phase),
    setRunState: (state) => calls.runState.push(state),
    setWorkerStates: (workerStates) => calls.workerStates.push(workerStates),
    spawnRunWorker: (workerState) => calls.spawned.push(workerState.name),
    finishExecution: (...args) => {
      calls.finished = args;
    },
    syncClaudeMd: () => {},
    parseParallelTasks: () => [],
    createWorktrees: () => [],
    syncWorkerTaskProgress: () => {},
    createActiveRunStateFn: () => ({
      isExecuting: true,
      execStartTime: 123,
      currentSchema: { status_prop: 'Status' },
      currentNotionTasks: [{ id: 'a' }, { id: 'b' }],
      executingTaskIds: new Set(['a', 'b']),
    }),
    createRunTimestampFn: () => '2026-03-07T10-00-00',
    buildExecutionPlanFn: () => ({
      workerGroups: {
        main: [{ id: 'a', title: '메인' }],
        feature: [{ id: 'b', title: '워커' }],
      },
      workerNames: ['main', 'feature'],
    }),
    applyTaskRunUpdatesFn: (args) => {
      calls.updates.push(args);
    },
    getFirstTaskIdsByWorkerFn: () => new Set(['a', 'b']),
    prepareParallelExecutionFn: () => [
      { name: 'main', total: 1 },
      { name: 'feature', total: 1 },
    ],
  });

  assert.equal(calls.runState.length, 1);
  assert.equal(calls.runState[0].isExecuting, true);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual([...notionInProgressIds], []);
  assert.equal(calls.workerStates.length, 1);
  assert.deepEqual(calls.workerStates[0].map((worker) => worker.name), ['main', 'feature']);
  assert.deepEqual(calls.spawned, ['main', 'feature']);
  assert.deepEqual(calls.phase, ['executing']);
  assert.match(calls.logs[0][1], /2개 태스크 실행 시작/);
  assert.match(calls.logs[1][1], /병렬 실행/);
  assert.equal(calls.finished, undefined);
});

test('executeNotionTasks finishes immediately when parallel execution creates no workers', () => {
  const finishCalls = [];

  executeNotionTasks({
    tasks: [{ id: 'a', title: '메인' }],
    schema: null,
    targetDir: 'C:\\workspace\\sleepcode',
    runtimeTasksPath: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\task_queue.md',
    logDir: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\logs',
    notionInProgressIds: new Set(),
    updatePage: () => true,
    pushLog: () => {},
    setWatchPhase: () => {},
    setRunState: () => {},
    setWorkerStates: () => {},
    spawnRunWorker: () => {},
    finishExecution: (...args) => finishCalls.push(args),
    syncClaudeMd: () => {},
    parseParallelTasks: () => [],
    createWorktrees: () => [],
    syncWorkerTaskProgress: () => {},
    buildExecutionPlanFn: () => ({
      workerGroups: { main: [{ id: 'a', title: '메인' }] },
      workerNames: ['main'],
    }),
    createActiveRunStateFn: () => ({
      isExecuting: true,
      execStartTime: 123,
      currentSchema: null,
      currentNotionTasks: [{ id: 'a' }],
      executingTaskIds: new Set(['a']),
    }),
    createRunTimestampFn: () => '2026-03-07T10-00-00',
    prepareParallelExecutionFn: () => [],
  });

  assert.equal(finishCalls.length, 1);
  assert.deepEqual(finishCalls[0], [[{ id: 'a', title: '메인' }], null, []]);
});

test('finishExecution updates notion state, records cost, resets idle state, and schedules a repoll', () => {
  const logs = [];
  const pageUpdates = [];
  const contentAppends = [];
  const finalizeCalls = [];
  const costCalls = [];
  const phases = [];
  const idleStates = [];
  const scheduled = [];
  let pollOnceCalls = 0;

  finishExecution({
    notionTasks: [{ id: 'task-1', title: '첫 태스크' }],
    schema: { status_prop: 'Status' },
    workerStates: [{ name: 'main', status: 'done' }],
    notionCompletedIds: new Set(['task-1']),
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    autoMergeWorktrees: () => {},
    cleanupWorktrees: () => {},
    updatePage: (pageId, props) => {
      pageUpdates.push([pageId, props]);
      return true;
    },
    appendContent: (pageId, text) => {
      contentAppends.push([pageId, text]);
      return true;
    },
    pushLog: (...args) => logs.push(args),
    applyIdleState: (idleState) => idleStates.push(idleState),
    setWatchPhase: (phase) => phases.push(phase),
    getWorkerDoneState: () => ({ doneSet: new Set(['첫 태스크']) }),
    dashboard: {
      isGracefulShutdown: () => false,
    },
    pollingController: {
      pollOnce: () => {
        pollOnceCalls += 1;
      },
    },
    summarizeExecutionResultsFn: () => ({
      taskResults: [{
        task: { id: 'task-1', title: '첫 태스크' },
        props: { Status: { status: { name: 'Done' } } },
        isDone: true,
        newStatus: 'Done',
      }],
      reportText: 'AI report',
      totalCost: 123,
    }),
    recordCostFn: (...args) => {
      costCalls.push(args);
    },
    finalizeParallelWorkersFn: (args) => {
      finalizeCalls.push(args);
    },
    createIdleRunStateFn: () => ({
      isExecuting: false,
      executingTaskIds: new Set(),
      currentSchema: null,
      currentNotionTasks: [],
      notionCompletedIds: new Set(),
      currentWorkerStates: [],
      execStartTime: null,
    }),
    schedule: (fn, delay) => {
      scheduled.push(delay);
      fn();
    },
  });

  assert.equal(pageUpdates.length, 1);
  assert.equal(pageUpdates[0][0], 'task-1');
  assert.equal(contentAppends.length, 1);
  assert.equal(contentAppends[0][0], 'task-1');
  assert.equal(costCalls.length, 1);
  assert.deepEqual(costCalls[0], ['C:\\workspace\\sleepcode', 123, 'run']);
  assert.equal(finalizeCalls.length, 1);
  assert.equal(finalizeCalls[0].targetDir, 'C:\\workspace\\sleepcode');
  assert.equal(idleStates.length, 1);
  assert.deepEqual(phases, ['waiting']);
  assert.equal(scheduled[0], 1000);
  assert.equal(pollOnceCalls, 1);
  assert.match(logs[0][1], /실행 완료/);
  assert.match(logs[1][1], /첫 태스크 → Done/);
  assert.match(logs[2][1], /보고 기록 완료/);
  assert.match(logs[3][1], /폴링 재개/);
});

test('finishExecution skips repoll scheduling when graceful shutdown is active', () => {
  let scheduled = false;

  finishExecution({
    notionTasks: [],
    schema: null,
    workerStates: [],
    notionCompletedIds: new Set(),
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    autoMergeWorktrees: () => {},
    cleanupWorktrees: () => {},
    updatePage: () => true,
    appendContent: () => true,
    pushLog: () => {},
    applyIdleState: () => {},
    setWatchPhase: () => {},
    getWorkerDoneState: () => ({ doneSet: new Set() }),
    dashboard: {
      isGracefulShutdown: () => true,
    },
    pollingController: {
      pollOnce: () => {
        throw new Error('should not run');
      },
    },
    summarizeExecutionResultsFn: () => ({
      taskResults: [],
      reportText: '',
      totalCost: 0,
    }),
    finalizeParallelWorkersFn: () => {},
    createIdleRunStateFn: () => ({
      isExecuting: false,
      executingTaskIds: new Set(),
      currentSchema: null,
      currentNotionTasks: [],
      notionCompletedIds: new Set(),
      currentWorkerStates: [],
      execStartTime: null,
    }),
    schedule: () => {
      scheduled = true;
    },
  });

  assert.equal(scheduled, false);
});
