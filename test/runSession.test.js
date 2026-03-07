const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createActiveRunState,
  createIdleRunState,
  createRunTimestamp,
} = require('../bin/lib/runSession');

test('createRunTimestamp normalizes ISO timestamps for file names', () => {
  const timestamp = createRunTimestamp(new Date('2026-03-07T13:45:27.123Z'));
  assert.equal(timestamp, '2026-03-07T13-45-27');
});

test('createActiveRunState captures current execution metadata', () => {
  const state = createActiveRunState(
    [{ id: 'a' }, { id: 'b' }],
    { status_prop: 'Status' },
    123456
  );

  assert.equal(state.isExecuting, true);
  assert.equal(state.execStartTime, 123456);
  assert.deepEqual(state.currentNotionTasks, [{ id: 'a' }, { id: 'b' }]);
  assert.deepEqual([...state.executingTaskIds], ['a', 'b']);
  assert.deepEqual(state.currentSchema, { status_prop: 'Status' });
});

test('createIdleRunState resets execution-only fields', () => {
  const state = createIdleRunState();

  assert.equal(state.isExecuting, false);
  assert.equal(state.execStartTime, null);
  assert.deepEqual(state.currentNotionTasks, []);
  assert.deepEqual(state.currentWorkerStates, []);
  assert.deepEqual([...state.executingTaskIds], []);
  assert.deepEqual([...state.notionCompletedIds], []);
});
