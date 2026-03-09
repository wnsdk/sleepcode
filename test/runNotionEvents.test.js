const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  handleTaskCompletedEvent,
  handleTaskStartedEvent,
  syncNextPendingTaskStatus,
} = require('../bin/lib/runNotionEvents');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('handleTaskCompletedEvent logs commit failures before notion updates', () => {
  const logs = [];
  const appends = [];
  const result = handleTaskCompletedEvent({
    payload: {
      taskEntry: { title: '리팩토링', notionId: 'notion-1' },
      commit: { committed: false, reason: 'nothing_to_commit' },
      reportText: 'task report',
    },
    schema: { status_prop: 'Status', status_type: 'status' },
    notionCompletedIds: new Set(),
    appendContent: (pageId, text) => {
      appends.push({ pageId, text });
      return true;
    },
    updatePage: () => {
      throw new Error('should not update');
    },
    pushLog: (message) => logs.push(message),
  });

  assert.equal(result.handled, true);
  assert.equal(result.updated, false);
  assert.deepEqual(appends, [{ pageId: 'notion-1', text: 'task report' }]);
  assert.equal(logs.some((message) => message.includes('commit 실패 (nothing_to_commit)')), true);
});

test('handleTaskCompletedEvent marks tasks as success when notion update succeeds', () => {
  const logs = [];
  const notionCompletedIds = new Set();
  const updates = [];
  const appends = [];

  const result = handleTaskCompletedEvent({
    payload: {
      taskEntry: { title: '배포', notionId: 'notion-1' },
      commit: { committed: true },
      reportText: '배포 report',
    },
    schema: { status_prop: 'Status', status_type: 'status' },
    notionCompletedIds,
    appendContent: (pageId, text) => {
      appends.push({ pageId, text });
      return true;
    },
    updatePage: (pageId, props) => {
      updates.push({ pageId, props });
      return true;
    },
    pushLog: (message) => logs.push(message),
  });

  assert.equal(result.handled, true);
  assert.equal(result.updated, true);
  assert.equal(notionCompletedIds.has('notion-1'), true);
  assert.equal(updates.length, 1);
  assert.deepEqual(appends, [{ pageId: 'notion-1', text: '배포 report' }]);
  assert.equal(logs.some((message) => message.includes('배포 → Success')), true);
});

test('handleTaskCompletedEvent includes cost when worker has token info', () => {
  const notionCompletedIds = new Set();
  const updates = [];

  handleTaskCompletedEvent({
    payload: {
      taskEntry: { title: 'Cost 태스크', notionId: 'notion-cost' },
      commit: { committed: true },
      worker: { inputTokens: 800, outputTokens: 200 },
    },
    schema: { status_prop: 'Status', status_type: 'status', cost_prop: 'Cost' },
    notionCompletedIds,
    updatePage: (pageId, props) => {
      updates.push({ pageId, props });
      return true;
    },
    pushLog: () => {},
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].props.Cost.number, 1000);
  assert.equal(notionCompletedIds.has('notion-cost'), true);
});

test('handleTaskStartedEvent updates model information and logs the result', () => {
  const logs = [];
  const updates = [];

  const result = handleTaskStartedEvent({
    payload: {
      taskEntry: { title: '모델 선택', notionId: 'notion-2' },
      model: 'claude-sonnet',
    },
    schema: { model_prop: 'Model', model_type: 'select' },
    updatePage: (pageId, props) => {
      updates.push({ pageId, props });
      return true;
    },
    pushLog: (message) => logs.push(message),
  });

  assert.equal(result.handled, true);
  assert.equal(result.updated, true);
  assert.deepEqual(updates[0], {
    pageId: 'notion-2',
    props: { Model: { select: { name: 'claude-sonnet' } } },
  });
  assert.equal(logs.some((message) => message.includes('Model 업데이트: 모델 선택 → claude-sonnet')), true);
});

test('handleTaskStartedEvent includes update failure details in logs', () => {
  const logs = [];

  const result = handleTaskStartedEvent({
    payload: {
      taskEntry: { title: '모델 선택', notionId: 'notion-2' },
      model: 'gpt-5.3-codex',
    },
    schema: { model_prop: 'Model', model_type: 'select' },
    updatePage: () => false,
    getUpdateError: () => 'property Model is invalid',
    pushLog: (message) => logs.push(message),
  });

  assert.equal(result.handled, true);
  assert.equal(result.updated, false);
  assert.equal(logs.some((message) => message.includes('Model 업데이트 실패 (property Model is invalid)')), true);
});

test('handleTaskCompletedEvent includes update failure details in logs', () => {
  const logs = [];

  const result = handleTaskCompletedEvent({
    payload: {
      taskEntry: { title: '배포', notionId: 'notion-1' },
      commit: { committed: true },
    },
    schema: { status_prop: 'Status', status_type: 'status' },
    notionCompletedIds: new Set(),
    updatePage: () => false,
    getUpdateError: () => 'property Status is invalid',
    pushLog: (message) => logs.push(message),
  });

  assert.equal(result.handled, true);
  assert.equal(result.updated, false);
  assert.equal(logs.some((message) => message.includes('Notion 업데이트 실패 (property Status is invalid)')), true);
});

test('syncNextPendingTaskStatus promotes the next unfinished task per worker', () => {
  withTempDir('sleepcode-run-notion-', (dir) => {
    const doneTaskId = '123e4567-e89b-12d3-a456-426614174000';
    const nextTaskId = '123e4567-e89b-12d3-a456-426614174001';
    const sleepcodeDir = path.join(dir, '.sleepcode');
    fs.mkdirSync(sleepcodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(sleepcodeDir, 'task_queue.md'),
      [
        '# 작업 목록',
        '',
        `- [x] 첫 번째 작업 <!-- notion:${doneTaskId} -->`,
        `- [ ] 두 번째 작업 <!-- notion:${nextTaskId} -->`,
        '',
      ].join('\n')
    );

    const updates = [];
    const notionInProgressIds = new Set([doneTaskId]);
    const updated = syncNextPendingTaskStatus({
      schema: { status_prop: 'Status', status_type: 'status' },
      tasks: [
        { id: doneTaskId, worker: 'main' },
        { id: nextTaskId, worker: 'main' },
      ],
      workerPaths: [{ path: dir, tasksPath: path.join(sleepcodeDir, 'task_queue.md') }],
      notionInProgressIds,
      updatePage: (pageId, props) => {
        updates.push({ pageId, props });
        return true;
      },
      getWorkerDoneState: () => ({ doneSet: new Set() }),
    });

    assert.equal(updated, true);
    assert.deepEqual(updates, [
      { pageId: nextTaskId, props: { Status: { status: { name: 'Running' } } } },
    ]);
    assert.equal(notionInProgressIds.has(nextTaskId), true);
  });
});
