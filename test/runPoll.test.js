const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPollInfo,
  filterNewTasks,
  normalizeStatus,
  selectTasksToRun,
} = require('../bin/lib/runPoll');

test('normalizeStatus trims and lowercases status values', () => {
  assert.equal(normalizeStatus('  In Progress '), 'in progress');
  assert.equal(normalizeStatus(null), '');
});

test('buildPollInfo counts backlog tasks waiting to start', () => {
  const info = buildPollInfo([
    { status: 'To Do' },
    { status: '할 일' },
    { status: '' },
    { status: 'Not Started' },
    { status: 'Running' },
  ]);

  assert.deepEqual(info, { total: 5, pending: 4 });
});

test('selectTasksToRun prefers run checkbox when the schema exposes it', () => {
  const tasks = [
    { id: 'a', run: true, status: 'To Do' },
    { id: 'b', run: true, status: 'Running' },
    { id: 'c', run: false, status: 'To Do' },
  ];

  assert.deepEqual(
    selectTasksToRun(tasks, { run_prop: 'Run' }).map((task) => task.id),
    ['a']
  );
});

test('selectTasksToRun falls back to Start status when run checkbox is unavailable', () => {
  const tasks = [
    { id: 'a', status: 'Start' },
    { id: 'b', status: '시작' },
    { id: 'c', status: 'To Do' },
  ];

  assert.deepEqual(
    selectTasksToRun(tasks, { run_prop: '' }).map((task) => task.id),
    ['a', 'b']
  );
});

test('filterNewTasks excludes task ids already executing', () => {
  const tasks = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
  ];

  assert.deepEqual(
    filterNewTasks(tasks, new Set(['a', 'c'])).map((task) => task.id),
    ['b']
  );
});
