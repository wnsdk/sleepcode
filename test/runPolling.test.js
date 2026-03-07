const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createRunPollingController,
  processPollResponse,
  syncRunningWorkerProgress,
} = require('../bin/lib/runPolling');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('processPollResponse adds newly queued tasks during execution', () => {
  const pollInfos = [];
  const addedTasks = [];
  let rendered = 0;

  const result = processPollResponse({
    data: {
      schema: { run_prop: 'Run' },
      tasks: [
        { id: 'a', run: true, status: 'To Do' },
        { id: 'b', run: true, status: 'To Do' },
      ],
    },
    isExecuting: true,
    executingTaskIds: new Set(['a']),
    setPollInfo: (info) => pollInfos.push(info),
    buildPollInfo: (tasks) => ({ total: tasks.length, pending: 2 }),
    selectTasksToRun: (tasks) => tasks,
    filterNewTasks: (tasks) => tasks.filter((task) => task.id !== 'a'),
    addTasksDuringExecution: (tasks, schema) => addedTasks.push({ tasks, schema }),
    executeNotionTasks: () => {
      throw new Error('should not execute a new run');
    },
    renderDashboard: () => {
      rendered += 1;
    },
  });

  assert.deepEqual(pollInfos, [{ total: 2, pending: 2 }]);
  assert.equal(result.mode, 'executing');
  assert.deepEqual(addedTasks, [{
    tasks: [{ id: 'b', run: true, status: 'To Do' }],
    schema: { run_prop: 'Run' },
  }]);
  assert.equal(rendered, 1);
});

test('syncRunningWorkerProgress refreshes only running workers and schedules a render', () => {
  withTempDir('sleepcode-run-poll-', (dir) => {
    const workerDir = path.join(dir, 'worker-main', '.sleepcode');
    fs.mkdirSync(workerDir, { recursive: true });
    const tasksPath = path.join(workerDir, 'task_queue.md');
    fs.writeFileSync(tasksPath, '- [ ] 태스크\n');

    const syncCalls = [];
    let nextStatusArgs = null;
    let scheduled = 0;

    const updated = syncRunningWorkerProgress({
      watchPhase: 'executing',
      workerStates: [
        { name: 'main', status: 'running', path: path.join(dir, 'worker-main'), tasksPath },
        { name: 'done', status: 'done', path: path.join(dir, 'worker-done') },
      ],
      syncWorkerTaskProgress: (worker, _baseline, content) => {
        syncCalls.push({ name: worker.name, content });
      },
      updateNextTaskStatus: (workerStates) => {
        nextStatusArgs = workerStates;
      },
      scheduleRender: () => {
        scheduled += 1;
      },
    });

    assert.equal(updated, true);
    assert.deepEqual(syncCalls, [{ name: 'main', content: '- [ ] 태스크\n' }]);
    assert.equal(nextStatusArgs.length, 2);
    assert.equal(scheduled, 1);
  });
});

test('createRunPollingController stops immediately when graceful stop file exists', () => {
  withTempDir('sleepcode-run-graceful-', (dir) => {
    const gracefulStopPath = path.join(dir, 'graceful_stop');
    fs.writeFileSync(gracefulStopPath, '');

    let stopped = 0;
    const controller = createRunPollingController({
      targetDir: dir,
      gracefulStopPath,
      pollIntervalMs: 1000,
      notionPoll: () => {
        throw new Error('should not poll notion');
      },
      isOverBudget: () => null,
      buildPollInfo: () => ({ total: 0, pending: 0 }),
      selectTasksToRun: () => [],
      filterNewTasks: () => [],
      getIsExecuting: () => false,
      getExecutingTaskIds: () => new Set(),
      getWatchPhase: () => 'waiting',
      getCurrentWorkerStates: () => [],
      setLastPollTime: () => {},
      setPollInfo: () => {},
      addTasksDuringExecution: () => {},
      executeNotionTasks: () => {},
      renderDashboard: () => {},
      scheduleRender: () => {},
      updateNextTaskStatus: () => {},
      syncWorkerTaskProgress: () => {},
      dashboard: { start: () => {}, dispose: () => {} },
      pushLog: () => {},
      onGracefulStopDetected: () => {
        stopped += 1;
      },
    });

    const result = controller.pollOnce();
    assert.equal(result.mode, 'stopped');
    assert.equal(stopped, 1);
  });
});
