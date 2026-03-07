const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunNotionBindings } = require('../bin/lib/runNotionBindings');

test('createRunNotionBindings delegates notion client methods and ui refresh', () => {
  const calls = [];
  const bindings = createRunNotionBindings({
    notionSync: {
      poll: () => {
        calls.push(['poll']);
        return { items: [] };
      },
      updatePage: (pageId, props) => {
        calls.push(['updatePage', pageId, props]);
        return true;
      },
      appendContent: (pageId, text) => {
        calls.push(['appendContent', pageId, text]);
        return true;
      },
    },
    getCurrentSchema: () => null,
    getCurrentNotionTasks: () => [],
    getNotionCompletedIds: () => new Set(),
    notionInProgressIds: new Set(),
    getWorkerDoneState: () => ({}),
    flushRender: () => {
      calls.push(['flushRender']);
    },
    pushLog: () => {},
  });

  assert.deepEqual(bindings.poll(), { items: [] });
  assert.equal(bindings.updatePage('page-1', { Status: 'Done' }), true);
  assert.equal(bindings.appendContent('page-1', 'report'), true);
  bindings.handleTaskUiUpdated();

  assert.deepEqual(calls, [
    ['poll'],
    ['updatePage', 'page-1', { Status: 'Done' }],
    ['appendContent', 'page-1', 'report'],
    ['flushRender'],
  ]);
});

test('createRunNotionBindings passes current schema and completion state to notion event handlers', () => {
  const completionCalls = [];
  const startCalls = [];
  const schema = { status_prop: 'Status' };
  const completedIds = new Set(['task-1']);
  const bindings = createRunNotionBindings({
    notionSync: {
      poll: () => ({}),
      updatePage: () => true,
      appendContent: () => true,
    },
    getCurrentSchema: () => schema,
    getCurrentNotionTasks: () => [],
    getNotionCompletedIds: () => completedIds,
    notionInProgressIds: new Set(),
    getWorkerDoneState: () => ({}),
    flushRender: () => {},
    pushLog: () => {},
    handleTaskCompletedEventFn: (args) => {
      completionCalls.push(args);
    },
    handleTaskStartedEventFn: (args) => {
      startCalls.push(args);
    },
  });

  bindings.handleTaskCompleted({ id: 'task-1' });
  bindings.handleTaskStarted({ id: 'task-2' });

  assert.equal(completionCalls.length, 1);
  assert.equal(completionCalls[0].payload.id, 'task-1');
  assert.equal(completionCalls[0].schema, schema);
  assert.equal(completionCalls[0].notionCompletedIds, completedIds);
  assert.equal(typeof completionCalls[0].updatePage, 'function');
  assert.equal(startCalls.length, 1);
  assert.equal(startCalls[0].payload.id, 'task-2');
  assert.equal(startCalls[0].schema, schema);
  assert.equal(typeof startCalls[0].updatePage, 'function');
});

test('createRunNotionBindings updates the next pending task using live task state', () => {
  const syncCalls = [];
  const tasks = [{ id: 'task-1' }, { id: 'task-2' }];
  const notionInProgressIds = new Set(['task-1']);
  const getWorkerDoneState = () => ({ doneSet: new Set(['task-1']) });
  const bindings = createRunNotionBindings({
    notionSync: {
      poll: () => ({}),
      updatePage: () => true,
      appendContent: () => true,
    },
    getCurrentSchema: () => ({ status_prop: 'Status' }),
    getCurrentNotionTasks: () => tasks,
    getNotionCompletedIds: () => new Set(),
    notionInProgressIds,
    getWorkerDoneState,
    flushRender: () => {},
    pushLog: () => {},
    syncNextPendingTaskStatusFn: (args) => {
      syncCalls.push(args);
    },
  });

  bindings.updateNextTaskStatus(['C:\\workspace\\sleepcode\\.sleepcode\\runtime\\task_queue.md']);

  assert.equal(syncCalls.length, 1);
  assert.deepEqual(syncCalls[0].tasks, tasks);
  assert.equal(syncCalls[0].notionInProgressIds, notionInProgressIds);
  assert.equal(syncCalls[0].getWorkerDoneState, getWorkerDoneState);
  assert.equal(typeof syncCalls[0].updatePage, 'function');
});
