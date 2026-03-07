const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunWorkerSpawner } = require('../bin/lib/runWorkerSpawner');

test('createRunWorkerSpawner forwards worker callbacks and resolves current run state on completion', () => {
  const spawnCalls = [];
  const doneCalls = [];
  const pushLogs = [];
  const currentWorkerStates = [{ name: 'main', status: 'running' }];
  const currentNotionTasks = [{ id: 'task-1' }];
  const currentSchema = { status_prop: 'Status' };

  const spawnManagedWorker = createRunWorkerSpawner({
    py: { cmd: 'python3' },
    targetDir: 'C:\\workspace\\sleepcode',
    cliProvider: 'codex',
    autoMergeWorktrees: () => {},
    scheduleRender: () => {},
    pushLog: (...args) => {
      pushLogs.push(args);
    },
    handleTaskCompleted: () => {},
    handleTaskStarted: () => {},
    handleTaskUiUpdated: () => {},
    finishExecution: () => {},
    getCurrentWorkerStates: () => currentWorkerStates,
    getCurrentNotionTasks: () => currentNotionTasks,
    getCurrentSchema: () => currentSchema,
    handleWorkerDoneFn: (args) => {
      doneCalls.push(args);
    },
    spawnRunWorkerFn: (args) => {
      spawnCalls.push(args);
    },
  });

  spawnManagedWorker({ name: 'feature-a', status: 'running' });

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].workerState.name, 'feature-a');
  assert.equal(spawnCalls[0].py.cmd, 'python3');
  assert.equal(typeof spawnCalls[0].onDone, 'function');

  spawnCalls[0].onDone();

  assert.equal(doneCalls.length, 1);
  assert.equal(doneCalls[0].completedWorker.name, 'feature-a');
  assert.equal(doneCalls[0].currentWorkerStates, currentWorkerStates);
  assert.equal(doneCalls[0].currentNotionTasks, currentNotionTasks);
  assert.equal(doneCalls[0].currentSchema, currentSchema);
  doneCalls[0].pushLog('worker finished');
  assert.deepEqual(pushLogs, [['SYSTEM', 'worker finished']]);
});
