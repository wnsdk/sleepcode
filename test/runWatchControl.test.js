const test = require('node:test');
const assert = require('node:assert/strict');

const {
  handleGracefulStopDetected,
  handleWorkerDone,
  spawnRunWorker,
  stopWatchTimers,
  stopWorkerProcesses,
} = require('../bin/lib/runWatchControl');

test('stopWorkerProcesses kills only running workers when requested', () => {
  const killed = [];
  const workerStates = [
    { name: 'main', status: 'running', _proc: { kill: (signal) => killed.push(['main', signal]) } },
    { name: 'done', status: 'done', _proc: { kill: (signal) => killed.push(['done', signal]) } },
    { name: 'idle', status: 'running' },
    { name: 'error', status: 'running', _proc: { kill: () => { throw new Error('ignore'); } } },
  ];

  stopWorkerProcesses(workerStates, 'SIGINT', true);

  assert.deepEqual(killed, [['main', 'SIGINT']]);
});

test('stopWatchTimers stops the polling controller when present', () => {
  let stopAllCalls = 0;

  stopWatchTimers({
    stopAll: () => {
      stopAllCalls += 1;
    },
  });
  stopWatchTimers(null);

  assert.equal(stopAllCalls, 1);
});

test('handleWorkerDone merges the worker and finishes when all workers have settled', () => {
  const mergeCalls = [];
  const finishCalls = [];
  let renderCalls = 0;
  const currentWorkerStates = [{ name: 'main', status: 'done' }];

  handleWorkerDone({
    completedWorker: currentWorkerStates[0],
    currentWorkerStates,
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    autoMergeWorktrees: () => {},
    pushLog: () => {},
    scheduleRender: () => {
      renderCalls += 1;
    },
    finishExecution: (...args) => {
      finishCalls.push(args);
    },
    currentNotionTasks: [{ id: 'a' }],
    currentSchema: { status_prop: 'Status' },
    mergeCompletedWorkerNowFn: (args) => {
      mergeCalls.push(args);
    },
    areAllWorkersSettledFn: () => true,
  });

  assert.equal(renderCalls, 1);
  assert.equal(mergeCalls.length, 1);
  assert.equal(mergeCalls[0].completedWorker.name, 'main');
  assert.equal(finishCalls.length, 1);
  assert.deepEqual(finishCalls[0][0], [{ id: 'a' }]);
  assert.deepEqual(finishCalls[0][1], { status_prop: 'Status' });
  assert.equal(finishCalls[0][2], currentWorkerStates);
});

test('handleWorkerDone skips finishExecution while another worker is still running', () => {
  let finishCalls = 0;

  handleWorkerDone({
    completedWorker: { name: 'feature-a' },
    currentWorkerStates: [{ name: 'feature-a', status: 'done' }, { name: 'feature-b', status: 'running' }],
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    autoMergeWorktrees: () => {},
    pushLog: () => {},
    scheduleRender: () => {},
    finishExecution: () => {
      finishCalls += 1;
    },
    currentNotionTasks: [],
    currentSchema: null,
    mergeCompletedWorkerNowFn: () => {},
    areAllWorkersSettledFn: () => false,
  });

  assert.equal(finishCalls, 0);
});

test('spawnRunWorker forwards the expected worker callbacks to spawnWorker', () => {
  const calls = [];

  spawnRunWorker({
    workerState: { name: 'main' },
    py: { cmd: 'python3' },
    onDone: () => {},
    scheduleRender: () => {},
    pushLog: () => {},
    cliProvider: 'codex',
    handleTaskCompleted: () => {},
    handleTaskStarted: () => {},
    handleTaskUiUpdated: () => {},
    spawnWorkerFn: (...args) => {
      calls.push(args);
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].name, 'main');
  assert.equal(calls[0][1].cmd, 'python3');
  assert.equal(typeof calls[0][2], 'function');
  assert.equal(typeof calls[0][6], 'function');
  assert.equal(typeof calls[0][7], 'function');
  assert.equal(typeof calls[0][8], 'function');
});

test('handleGracefulStopDetected disposes the dashboard, logs, and exits', () => {
  let disposed = 0;
  const logs = [];
  const exitCodes = [];

  handleGracefulStopDetected({
    dashboard: {
      dispose: () => {
        disposed += 1;
      },
    },
    log: (message) => {
      logs.push(message);
    },
    exit: (code) => {
      exitCodes.push(code);
    },
  });

  assert.equal(disposed, 1);
  assert.equal(exitCodes[0], 0);
  assert.match(logs[0], /graceful_stop 감지/);
});
