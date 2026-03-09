const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  appendWorkerTasks,
  appendTasksToQueueContent,
  applyTaskRunUpdates,
  buildRunWorkerState,
  buildTaskRunUpdates,
  buildWorkerTaskQueueContent,
  getFirstTaskIdsByWorker,
  splitTasksByWorkerPresence,
} = require('../bin/lib/runWorkers');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('splitTasksByWorkerPresence separates existing and new worker buckets', () => {
  const result = splitTasksByWorkerPresence(
    [
      { id: 'a', title: '기존 메인', worker: '' },
      { id: 'b', title: '기존 워커', worker: '@worker feature-a' },
      { id: 'c', title: '새 워커', worker: 'feature-b' },
    ],
    ['main', 'feature-a']
  );

  assert.deepEqual(Object.keys(result.existingGroups), ['main', 'feature-a']);
  assert.deepEqual(Object.keys(result.newGroups), ['feature-b']);
  assert.deepEqual(result.newGroups['feature-b'].map((task) => task.id), ['c']);
});

test('appendTasksToQueueContent appends notion task lines with trailing newline', () => {
  const content = appendTasksToQueueContent('# 작업 목록\n', [
    { id: 'a1', title: '첫 번째 태스크' },
    { id: 'a2', title: '두 번째 태스크' },
  ]);

  assert.match(content, /- \[ \] 첫 번째 태스크 <!-- notion:a1 -->/);
  assert.match(content, /- \[ \] 두 번째 태스크 <!-- notion:a2 -->/);
  assert.equal(content.endsWith('\n'), true);
});

test('appendTasksToQueueContent does not add a leading blank line for empty files', () => {
  const content = appendTasksToQueueContent('', [
    { id: 'a1', title: '첫 번째 태스크' },
  ]);

  assert.equal(content.startsWith('\n'), false);
  assert.equal(content, '- [ ] 첫 번째 태스크 <!-- notion:a1 -->\n');
});

test('buildWorkerTaskQueueContent renders a single worker section', () => {
  const content = buildWorkerTaskQueueContent('feature-a', [
    { id: 'a1', title: '워커 태스크' },
  ]);

  assert.match(content, /## @worker feature-a/);
  assert.match(content, /- \[ \] 워커 태스크 <!-- notion:a1 -->/);
});

test('getFirstTaskIdsByWorker picks the first task per worker group', () => {
  const ids = getFirstTaskIdsByWorker({
    main: [{ id: 'main-1' }, { id: 'main-2' }],
    feature: [{ id: 'feature-1' }],
  });

  assert.deepEqual([...ids], ['main-1', 'feature-1']);
});

test('buildRunWorkerState creates runtime metadata including log path', () => {
  const state = buildRunWorkerState({
    workerInfo: { name: 'feature-a', path: 'C:\\repo\\.sleepcode\\worktrees\\feature-a' },
    targetDir: 'C:\\repo',
    logDir: 'C:\\repo\\.sleepcode\\runtime\\logs',
    timestamp: '2026-03-07T22-00-00',
    total: 3,
    merged: false,
  });

  assert.equal(state.status, 'running');
  assert.equal(state.total, 3);
  assert.equal(state.merged, false);
  assert.match(state.logFile, /run_feature-a_2026-03-07T22-00-00\.log$/);
});

test('buildTaskRunUpdates marks only the first worker tasks as running', () => {
  const updates = buildTaskRunUpdates(
    [
      { id: 'a', title: '첫 번째' },
      { id: 'b', title: '두 번째' },
    ],
    { status_prop: 'Status', status_type: 'status', run_prop: 'Run' },
    new Set(['a'])
  );

  assert.deepEqual(
    updates.map((update) => ({
      id: update.task.id,
      run: update.props.Run.checkbox,
      status: update.props.Status.status.name,
    })),
    [
      { id: 'a', run: false, status: 'Running' },
      { id: 'b', run: false, status: 'Pending' },
    ]
  );
});

test('applyTaskRunUpdates tracks tasks, running ids, and notion updates', () => {
  const trackedTasks = [];
  const notionInProgressIds = new Set();
  const updates = [];

  const result = applyTaskRunUpdates({
    tasks: [
      { id: 'a', title: '첫 번째' },
      { id: 'b', title: '두 번째' },
    ],
    schema: { status_prop: 'Status', status_type: 'status', run_prop: 'Run' },
    firstRunningTaskIds: new Set(['a']),
    trackedTasks,
    notionInProgressIds,
    updatePage: (pageId, props) => updates.push({ pageId, props }),
  });

  assert.equal(result.length, 2);
  assert.deepEqual(trackedTasks.map((task) => task.id), ['a', 'b']);
  assert.deepEqual([...notionInProgressIds], ['a']);
  assert.deepEqual(updates.map((update) => update.pageId), ['a', 'b']);
});

test('appendWorkerTasks appends queue content and syncs worker progress', () => {
  withTempDir('sleepcode-run-workers-', (dir) => {
    const sleepcodeDir = path.join(dir, '.sleepcode');
    fs.mkdirSync(sleepcodeDir, { recursive: true });
    const tasksPath = path.join(sleepcodeDir, 'task_queue.md');
    fs.writeFileSync(tasksPath, '# 작업 목록\n');

    const trackedTasks = [];
    const notionInProgressIds = new Set();
    const updates = [];
    const syncCalls = [];
    let onSuccessCalled = 0;

    const workerState = { name: 'main', path: dir, tasksPath, taskEntries: [] };
    const result = appendWorkerTasks({
      workerState,
      tasks: [{ id: 'a', title: '새 태스크' }],
      schema: { status_prop: 'Status', status_type: 'status', run_prop: 'Run' },
      firstRunningTaskIds: new Set(['a']),
      trackedTasks,
      notionInProgressIds,
      updatePage: (pageId, props) => updates.push({ pageId, props }),
      syncWorkerTaskProgress: (worker, _baseline, content) => syncCalls.push({ name: worker.name, content }),
      onSuccess: () => {
        onSuccessCalled += 1;
      },
    });

    assert.equal(result.ok, true);
    assert.equal(onSuccessCalled, 1);
    assert.deepEqual(trackedTasks.map((task) => task.id), ['a']);
    assert.deepEqual(workerState.taskEntries.map((task) => task.id), ['a']);
    assert.deepEqual([...notionInProgressIds], ['a']);
    assert.deepEqual(updates.map((update) => update.pageId), ['a']);
    assert.equal(syncCalls.length, 1);
    assert.match(fs.readFileSync(tasksPath, 'utf-8'), /새 태스크/);
  });
});
