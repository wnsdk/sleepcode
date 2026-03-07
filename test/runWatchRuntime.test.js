const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunStateStore } = require('../bin/lib/runStateStore');
const { createRunWatchRuntime } = require('../bin/lib/runWatchRuntime');

function createDashboardDouble(calls) {
  return {
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
    setWatchPhase: () => {
      calls.setWatchPhase += 1;
    },
    start: () => {
      calls.start += 1;
    },
  };
}

test('createRunWatchRuntime wires dashboard callbacks to polling controller and worker stop handlers', () => {
  const runState = createRunStateStore();
  runState.setCurrentWorkerStates([{ name: 'main' }]);
  const calls = {
    flushRender: 0,
    pushLog: [],
    renderDashboard: 0,
    scheduleRender: 0,
    setWatchPhase: 0,
    start: 0,
    stopTimers: [],
    stopWorkers: [],
  };
  let pollNowCalls = 0;
  let stopPollingCalls = 0;
  let dashboardOptions = null;

  createRunWatchRuntime({
    dbId: 'db-1',
    pollIntervalSec: 30,
    targetDir: 'C:\\workspace\\sleepcode',
    gracefulStopPath: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\graceful_stop',
    pollIntervalMs: 30000,
    notionPoll: () => ({}),
    isOverBudget: () => null,
    buildPollInfo: () => ({ total: 0, pending: 0 }),
    selectTasksToRun: () => [],
    filterNewTasks: () => [],
    runState,
    addTasksDuringExecution: () => {},
    executeNotionTasks: () => {},
    updateNextTaskStatus: () => {},
    syncWorkerTaskProgress: () => {},
    handleGracefulStopDetected: () => {},
    stopWatchTimers: (controller) => {
      calls.stopTimers.push(controller);
    },
    stopWorkerProcesses: (workerStates, signal, runningOnly) => {
      calls.stopWorkers.push({ workerStates, signal, runningOnly });
    },
    createRunDashboardFn: (options) => {
      dashboardOptions = options;
      return createDashboardDouble(calls);
    },
    createRunPollingControllerFn: () => ({
      pollNow: () => {
        pollNowCalls += 1;
      },
      start: () => {},
      stopPolling: () => {
        stopPollingCalls += 1;
      },
    }),
  });

  dashboardOptions.onPollNow();
  dashboardOptions.onGracefulExit();
  dashboardOptions.onImmediateExit();
  dashboardOptions.onInterrupt();

  assert.equal(pollNowCalls, 1);
  assert.equal(stopPollingCalls, 1);
  assert.equal(calls.stopTimers.length, 2);
  assert.equal(calls.stopWorkers.length, 3);
  assert.equal(calls.stopWorkers[0].signal, 'SIGINT');
  assert.equal(calls.stopWorkers[0].runningOnly, true);
  assert.deepEqual(calls.stopWorkers[0].workerStates, [{ name: 'main' }]);
});

test('createRunWatchRuntime proxies dashboard helpers and updates watch phase via the store', () => {
  const runState = createRunStateStore();
  const calls = {
    flushRender: 0,
    pushLog: [],
    renderDashboard: 0,
    scheduleRender: 0,
    setWatchPhase: 0,
    start: 0,
  };

  const runtime = createRunWatchRuntime({
    dbId: 'db-1',
    pollIntervalSec: 30,
    targetDir: 'C:\\workspace\\sleepcode',
    gracefulStopPath: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\graceful_stop',
    pollIntervalMs: 30000,
    notionPoll: () => ({}),
    isOverBudget: () => null,
    buildPollInfo: () => ({ total: 0, pending: 0 }),
    selectTasksToRun: () => [],
    filterNewTasks: () => [],
    runState,
    addTasksDuringExecution: () => {},
    executeNotionTasks: () => {},
    updateNextTaskStatus: () => {},
    syncWorkerTaskProgress: () => {},
    handleGracefulStopDetected: () => {},
    stopWatchTimers: () => {},
    stopWorkerProcesses: () => {},
    createRunDashboardFn: () => createDashboardDouble(calls),
    createRunPollingControllerFn: () => ({
      start: () => {},
      stopPolling: () => {},
      pollNow: () => {},
    }),
  });

  runtime.pushLog('SYSTEM', 'message');
  runtime.scheduleRender();
  runtime.flushRender();
  runtime.renderDashboard();
  runtime.setWatchPhase('executing');

  assert.deepEqual(calls.pushLog, [['SYSTEM', 'message']]);
  assert.equal(calls.scheduleRender, 1);
  assert.equal(calls.flushRender, 1);
  assert.equal(calls.renderDashboard, 1);
  assert.equal(runState.getWatchPhase(), 'executing');
  assert.equal(calls.setWatchPhase, 1);
});

test('createRunWatchRuntime stores the polling controller and routes controller state through the store', () => {
  const runState = createRunStateStore();
  const calls = {
    gracefulStop: [],
  };
  let pollingOptions = null;
  const dashboard = createDashboardDouble({
    flushRender: 0,
    pushLog: [],
    renderDashboard: 0,
    scheduleRender: 0,
    setWatchPhase: 0,
    start: 0,
  });
  const pollingController = {
    start: () => {},
    stopPolling: () => {},
    pollNow: () => {},
  };

  createRunWatchRuntime({
    dbId: 'db-1',
    pollIntervalSec: 30,
    targetDir: 'C:\\workspace\\sleepcode',
    gracefulStopPath: 'C:\\workspace\\sleepcode\\.sleepcode\\runtime\\graceful_stop',
    pollIntervalMs: 30000,
    notionPoll: () => ({}),
    isOverBudget: () => null,
    buildPollInfo: () => ({ total: 0, pending: 0 }),
    selectTasksToRun: () => [],
    filterNewTasks: () => [],
    runState,
    addTasksDuringExecution: () => {},
    executeNotionTasks: () => {},
    updateNextTaskStatus: () => {},
    syncWorkerTaskProgress: () => {},
    handleGracefulStopDetected: (args) => {
      calls.gracefulStop.push(args);
    },
    stopWatchTimers: () => {},
    stopWorkerProcesses: () => {},
    createRunDashboardFn: () => dashboard,
    createRunPollingControllerFn: (options) => {
      pollingOptions = options;
      return pollingController;
    },
  });

  runState.setCurrentWorkerStates([{ name: 'main' }]);
  runState.applyRunState({
    isExecuting: true,
    execStartTime: 123,
    currentSchema: { status_prop: 'Status' },
    currentNotionTasks: [{ id: 'a' }],
    executingTaskIds: new Set(['a']),
  });
  pollingOptions.setLastPollTime(999);
  pollingOptions.setPollInfo({ total: 1, pending: 1 });
  pollingOptions.onGracefulStopDetected();

  assert.equal(runState.getPollingController(), pollingController);
  assert.equal(pollingOptions.getIsExecuting(), true);
  assert.deepEqual([...pollingOptions.getExecutingTaskIds()], ['a']);
  assert.equal(pollingOptions.getWatchPhase(), 'waiting');
  assert.deepEqual(pollingOptions.getCurrentWorkerStates(), [{ name: 'main' }]);
  assert.equal(runState.getLastPollTime(), 999);
  assert.deepEqual(runState.getPollInfo(), { total: 1, pending: 1 });
  assert.equal(calls.gracefulStop.length, 1);
  assert.equal(calls.gracefulStop[0].dashboard, dashboard);
});
