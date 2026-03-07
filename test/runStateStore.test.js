const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunStateStore } = require('../bin/lib/runStateStore');

test('createRunStateStore exposes the default watch state', () => {
  const store = createRunStateStore();

  assert.equal(store.getIsExecuting(), false);
  assert.deepEqual([...store.getExecutingTaskIds()], []);
  assert.equal(store.getCurrentSchema(), null);
  assert.deepEqual(store.getCurrentNotionTasks(), []);
  assert.deepEqual([...store.getNotionCompletedIds()], []);
  assert.deepEqual([...store.getNotionInProgressIds()], []);
  assert.equal(store.getWatchPhase(), 'waiting');
  assert.deepEqual(store.getPollInfo(), { total: 0, pending: 0 });
  assert.equal(store.getLastPollTime(), null);
  assert.deepEqual(store.getCurrentWorkerStates(), []);
  assert.equal(store.getExecStartTime(), null);
  assert.equal(store.getPollingController(), null);
});

test('createRunStateStore tracks run state transitions and mutable refs', () => {
  const store = createRunStateStore();
  const runState = {
    isExecuting: true,
    execStartTime: 123,
    currentSchema: { status_prop: 'Status' },
    currentNotionTasks: [{ id: 'a' }],
    executingTaskIds: new Set(['a']),
  };

  store.applyRunState(runState);
  store.getNotionInProgressIds().add('a');
  store.getNotionCompletedIds().add('b');
  store.setWatchPhase('executing');
  store.setPollInfo({ total: 2, pending: 1 });
  store.setLastPollTime(456);
  store.setCurrentWorkerStates([{ name: 'main' }]);
  store.setPollingController({ pollOnce: () => {} });

  assert.equal(store.getIsExecuting(), true);
  assert.equal(store.getExecStartTime(), 123);
  assert.deepEqual(store.getCurrentSchema(), { status_prop: 'Status' });
  assert.deepEqual(store.getCurrentNotionTasks(), [{ id: 'a' }]);
  assert.deepEqual([...store.getExecutingTaskIds()], ['a']);
  assert.deepEqual([...store.getNotionInProgressIds()], ['a']);
  assert.deepEqual([...store.getNotionCompletedIds()], ['b']);
  assert.equal(store.getWatchPhase(), 'executing');
  assert.deepEqual(store.getPollInfo(), { total: 2, pending: 1 });
  assert.equal(store.getLastPollTime(), 456);
  assert.deepEqual(store.getCurrentWorkerStates(), [{ name: 'main' }]);
  assert.equal(typeof store.getPollingController().pollOnce, 'function');
});

test('createRunStateStore applies idle state and resets execution-only fields', () => {
  const store = createRunStateStore();
  const idleState = {
    isExecuting: false,
    executingTaskIds: new Set(),
    currentSchema: null,
    currentNotionTasks: [],
    notionCompletedIds: new Set(),
    currentWorkerStates: [],
    execStartTime: null,
  };

  store.applyRunState({
    isExecuting: true,
    execStartTime: 123,
    currentSchema: { status_prop: 'Status' },
    currentNotionTasks: [{ id: 'a' }],
    executingTaskIds: new Set(['a']),
  });
  store.applyIdleState(idleState);

  assert.equal(store.getIsExecuting(), false);
  assert.deepEqual([...store.getExecutingTaskIds()], []);
  assert.equal(store.getCurrentSchema(), null);
  assert.deepEqual(store.getCurrentNotionTasks(), []);
  assert.deepEqual([...store.getNotionCompletedIds()], []);
  assert.deepEqual(store.getCurrentWorkerStates(), []);
  assert.equal(store.getExecStartTime(), null);
});
