const test = require('node:test');
const assert = require('node:assert/strict');

const { createParallelRunnerRuntime } = require('../bin/lib/parallelRunnerRuntime');

function createDashboardDouble(calls) {
  return {
    dispose: () => {
      calls.dispose += 1;
    },
    flushRender: () => {
      calls.flushRender += 1;
    },
    pushLog: (...args) => {
      calls.pushLog.push(args);
    },
    renderDashboard: () => {
      calls.renderDashboard += 1;
    },
    scheduleRender: () => {
      calls.scheduleRender += 1;
    },
    start: () => {
      calls.start += 1;
    },
  };
}

test('createParallelRunnerRuntime wires dashboard callbacks, timers, and worker spawns', () => {
  const calls = {
    dispose: 0,
    flushRender: 0,
    intervals: [],
    pushLog: [],
    renderDashboard: 0,
    scheduleRender: 0,
    spawn: [],
    start: 0,
    stopWorkers: [],
    sync: [],
  };
  let dashboardOptions = null;

  const runtime = createParallelRunnerRuntime({
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    workerStates: [{ name: 'main', status: 'running' }],
    py: { cmd: 'python3' },
    getBudgetInfo: () => null,
    printParallelCompletionSummary: () => {},
    createParallelDashboardFn: (options) => {
      dashboardOptions = options;
      return createDashboardDouble(calls);
    },
    syncParallelWorkerProgressFn: (args) => {
      calls.sync.push(args);
    },
    stopRunningWorkersFn: (workerStates, signal) => {
      calls.stopWorkers.push({ workerStates, signal });
    },
    spawnWorkerFn: (...args) => {
      calls.spawn.push(args);
    },
    setIntervalFn: (fn, delay) => {
      const handle = { fn, delay };
      calls.intervals.push(handle);
      return handle;
    },
  });

  runtime.start();

  assert.equal(calls.start, 1);
  assert.equal(calls.sync.length, 1);
  assert.equal(calls.sync[0].workerStates.length, 1);
  assert.deepEqual(calls.intervals.map((item) => item.delay), [3000, 5000, 30000]);
  assert.equal(calls.spawn.length, 1);
  assert.equal(calls.spawn[0][0].name, 'main');
  assert.equal(calls.spawn[0][1].cmd, 'python3');
  assert.equal(typeof calls.spawn[0][2], 'function');
  assert.equal(typeof calls.spawn[0][8], 'function');

  calls.spawn[0][3]();
  calls.spawn[0][4]('main', 'message');
  calls.spawn[0][8]();

  assert.equal(calls.scheduleRender, 1);
  assert.deepEqual(calls.pushLog, [['main', 'message']]);
  assert.equal(calls.flushRender, 1);

  dashboardOptions.onGracefulExit();
  dashboardOptions.onImmediateExit();
  dashboardOptions.onInterrupt();

  assert.equal(calls.stopWorkers.length, 3);
  assert.equal(calls.stopWorkers[0].signal, 'SIGINT');
  assert.equal(calls.stopWorkers[0].workerStates.length, 1);

  calls.intervals[1].fn();
  assert.equal(calls.sync.length, 2);
  assert.equal(typeof calls.sync[1].scheduleRender, 'function');
});

test('createParallelRunnerRuntime finishes only after the last worker completes', () => {
  const calls = {
    clearIntervals: [],
    dispose: 0,
    finalizeMerge: [],
    flushRender: 0,
    merge: [],
    printSummary: [],
    pushLog: [],
    renderDashboard: 0,
    scheduleRender: 0,
    spawn: [],
    start: 0,
  };

  const workerStates = [
    { name: 'main', status: 'running' },
    { name: 'feature-a', status: 'running' },
  ];
  const runtime = createParallelRunnerRuntime({
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    workerStates,
    py: { cmd: 'python3' },
    getBudgetInfo: () => null,
    printParallelCompletionSummary: (states) => {
      calls.printSummary.push(states);
    },
    createParallelDashboardFn: () => createDashboardDouble(calls),
    syncParallelWorkerProgressFn: () => {},
    finalizeCompletedParallelWorkersFn: (args) => {
      calls.finalizeMerge.push(args);
    },
    mergeCompletedParallelWorkerFn: (args) => {
      calls.merge.push(args);
    },
    spawnWorkerFn: (...args) => {
      calls.spawn.push(args);
    },
    setIntervalFn: (_fn, delay) => ({ delay }),
    clearIntervalFn: (handle) => {
      calls.clearIntervals.push(handle.delay);
    },
  });

  runtime.start();
  assert.equal(runtime.getActiveWorkers(), 2);

  runtime.onWorkerDone(workerStates[0]);
  assert.equal(runtime.getActiveWorkers(), 1);
  assert.equal(calls.printSummary.length, 0);
  assert.equal(calls.dispose, 0);

  runtime.onWorkerDone(workerStates[1]);
  assert.equal(runtime.getActiveWorkers(), 0);
  assert.equal(calls.merge.length, 2);
  assert.equal(calls.finalizeMerge.length, 1);
  assert.equal(calls.finalizeMerge[0].workerStates, workerStates);
  assert.deepEqual(calls.clearIntervals, [3000, 5000, 30000]);
  assert.equal(calls.dispose, 1);
  assert.equal(calls.printSummary.length, 1);
});

test('createParallelRunnerRuntime stops checking budget after the first stop signal', () => {
  const calls = {
    budgetChecks: 0,
    dispose: 0,
    flushRender: 0,
    intervals: [],
    pushLog: [],
    renderDashboard: 0,
    scheduleRender: 0,
    start: 0,
  };

  createParallelRunnerRuntime({
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    workerStates: [{ name: 'main', status: 'running' }],
    py: { cmd: 'python3' },
    getBudgetInfo: () => null,
    printParallelCompletionSummary: () => {},
    createParallelDashboardFn: () => createDashboardDouble(calls),
    syncParallelWorkerProgressFn: () => {},
    applyParallelBudgetStopFn: () => {
      calls.budgetChecks += 1;
      return { stopped: true };
    },
    spawnWorkerFn: () => {},
    setIntervalFn: (fn, delay) => {
      const handle = { fn, delay };
      calls.intervals.push(handle);
      return handle;
    },
  }).start();

  const budgetInterval = calls.intervals.find((item) => item.delay === 30000);
  budgetInterval.fn();
  budgetInterval.fn();

  assert.equal(calls.budgetChecks, 1);
});
