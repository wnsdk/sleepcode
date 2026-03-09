const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildParallelDashboardFrame,
  clipVisualText,
  formatElapsedSeconds,
  getParallelDashboardHeight,
  getCompletionNextSteps,
  summarizeWorkerOutcomes,
} = require('../bin/lib/parallelDashboard');

test('clipVisualText truncates long labels and preserves short ones', () => {
  assert.equal(clipVisualText('짧은 작업', 20), '짧은 작업');
  assert.equal(clipVisualText('이건 상당히 긴 작업 설명입니다', 10).endsWith('...'), true);
});

test('summarizeWorkerOutcomes groups worker states for completion summary', () => {
  const summary = summarizeWorkerOutcomes([
    { name: 'a', status: 'done', merged: true },
    { name: 'b', status: 'done', merged: false },
    { name: 'c', status: 'failed', merged: false },
    { name: 'd', status: 'budget_stop', merged: false },
    { name: 'e', status: 'terminated', merged: false },
  ]);

  assert.deepEqual(summary.done.map((worker) => worker.name), ['a', 'b']);
  assert.deepEqual(summary.failed.map((worker) => worker.name), ['c']);
  assert.deepEqual(summary.stopped.map((worker) => worker.name), ['d']);
  assert.deepEqual(summary.terminated.map((worker) => worker.name), ['e']);
  assert.deepEqual(summary.alreadyMerged.map((worker) => worker.name), ['a']);
  assert.deepEqual(summary.needsMerge.map((worker) => worker.name), ['b', 'c', 'd']);
});

test('getCompletionNextSteps returns merge/clean guidance based on summary', () => {
  assert.deepEqual(
    getCompletionNextSteps({
      done: [{ name: 'a' }],
      needsMerge: [{ name: 'a' }],
      terminated: [],
    }),
    ['npx sleepcode run --merge', 'npx sleepcode run --clean']
  );
  assert.deepEqual(
    getCompletionNextSteps({
      done: [{ name: 'a' }],
      needsMerge: [],
      terminated: [],
    }),
    ['npx sleepcode run --clean']
  );
  assert.deepEqual(
    getCompletionNextSteps({
      done: [],
      needsMerge: [],
      terminated: [{ name: 'feature-a' }],
    }),
    ['npx sleepcode run --clean']
  );
});

test('getParallelDashboardHeight and formatElapsedSeconds summarize the parallel frame layout', () => {
  assert.equal(getParallelDashboardHeight([]), 11);
  assert.equal(getParallelDashboardHeight([{ name: 'main' }, { name: 'feature-a' }]), 15);
  assert.equal(formatElapsedSeconds(5), '5s');
  assert.equal(formatElapsedSeconds(125), '2m 5s');
  assert.equal(formatElapsedSeconds(3661), '1h 1m');
});

test('buildParallelDashboardFrame renders worker progress, budget state, and menu layout', () => {
  const startTime = 10_000;
  const frame = buildParallelDashboardFrame({
    workerStates: [
      {
        name: 'main',
        status: 'running',
        done: 1,
        total: 3,
        cost: 1.25,
        currentTask: '이건 상당히 긴 작업 설명입니다',
      },
      {
        name: 'feature-a',
        status: 'done',
        done: 2,
        total: 2,
        cost: 0.5,
      },
    ],
    budgetInfo: {
      total: 5,
      budget: 10,
      over: false,
    },
    gracefulShutdown: false,
    menuState: {
      menuIndex: 1,
      confirmPending: false,
      _menuItems: [{ label: '즉시 종료' }],
    },
    notionDbId: 'db-123',
    startTime,
    now: () => startTime + 65_000,
    renderMenuLineWithLayoutFn: () => ({
      line: 'menu line',
      items: [{ label: '즉시 종료' }],
    }),
  });

  assert.ok(frame.lines.some((line) => line.includes('parallel')));
  assert.ok(frame.lines.some((line) => line.includes('main')));
  assert.ok(frame.lines.some((line) => line.includes('feature-a')));
  assert.ok(frame.lines.some((line) => line.includes('1m 5s')));
  assert.ok(frame.lines.some((line) => line.includes('menu line')));
  assert.deepEqual(frame.menuLayout, {
    row: frame.lines.length - 1,
    items: [{ label: '즉시 종료' }],
  });
});

test('buildParallelDashboardFrame shows graceful shutdown state without a menu layout', () => {
  const frame = buildParallelDashboardFrame({
    workerStates: [],
    budgetInfo: null,
    gracefulShutdown: true,
    menuState: { menuIndex: 0 },
    startTime: 0,
    now: () => 0,
  });

  assert.equal(frame.menuLayout, null);
  assert.ok(frame.lines.some((line) => line.includes('마무리 중')));
});
