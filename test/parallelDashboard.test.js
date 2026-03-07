const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clipVisualText,
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
  ]);

  assert.deepEqual(summary.done.map((worker) => worker.name), ['a', 'b']);
  assert.deepEqual(summary.failed.map((worker) => worker.name), ['c']);
  assert.deepEqual(summary.stopped.map((worker) => worker.name), ['d']);
  assert.deepEqual(summary.alreadyMerged.map((worker) => worker.name), ['a']);
  assert.deepEqual(summary.needsMerge.map((worker) => worker.name), ['b']);
});

test('getCompletionNextSteps returns merge/clean guidance based on summary', () => {
  assert.deepEqual(
    getCompletionNextSteps({
      done: [{ name: 'a' }],
      needsMerge: [{ name: 'a' }],
    }),
    ['npx sleepcode parallel --merge', 'npx sleepcode parallel --clean']
  );
  assert.deepEqual(
    getCompletionNextSteps({
      done: [{ name: 'a' }],
      needsMerge: [],
    }),
    ['npx sleepcode parallel --clean']
  );
});
