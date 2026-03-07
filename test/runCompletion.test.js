const test = require('node:test');
const assert = require('node:assert/strict');

const {
  finalizeParallelWorkers,
  summarizeExecutionResults,
} = require('../bin/lib/runCompletion');

test('summarizeExecutionResults builds task outcomes, costs, and reports', () => {
  const summary = summarizeExecutionResults({
    notionTasks: [
      { id: 'a', title: '첫 번째' },
      { id: 'b', title: '두 번째' },
    ],
    schema: {
      status_prop: 'Status',
      status_type: 'status',
      cost_prop: 'Cost',
      log_prop: 'Log',
      completed_at_prop: 'Completed At',
    },
    workerStates: [
      { name: 'main', cost: 1.5, merged: true, reportLines: ['main report'] },
      { name: 'feature', cost: 0.5, merged: false, reportLines: ['feature report'] },
    ],
    notionCompletedIds: new Set(['a']),
    getTaskCompletion: () => ({ a: true, b: false }),
  });

  assert.equal(summary.totalCost, 2);
  assert.equal(summary.reportText.includes('main report'), true);
  assert.equal(summary.reportText.includes('feature report'), true);
  assert.deepEqual(summary.pendingMergeWorkers.map((worker) => worker.name), ['feature']);
  assert.deepEqual(
    summary.taskResults.map((result) => ({
      id: result.task.id,
      status: result.newStatus,
      hasStatusProp: Boolean(result.props.Status),
      cost: result.props.Cost.number,
    })),
    [
      { id: 'a', status: 'Success', hasStatusProp: false, cost: 1 },
      { id: 'b', status: 'Failed', hasStatusProp: true, cost: 1 },
    ]
  );
});

test('finalizeParallelWorkers merges and cleans worktrees when there are no conflicts', () => {
  const logs = [];
  let cleaned = false;

  const result = finalizeParallelWorkers({
    targetDir: 'C:\\workspace\\sleepcode',
    workerStates: [
      { name: 'main', merged: true },
      { name: 'feature-a', merged: false },
    ],
    cliProvider: 'claude',
    autoMergeWorktrees: () => ({ merged: ['feature-a'], conflicted: [], skipped: [] }),
    cleanupWorktrees: () => {
      cleaned = true;
    },
    pushLog: (message) => logs.push(message),
  });

  assert.equal(result.hasConflicts, false);
  assert.equal(result.cleaned, true);
  assert.equal(cleaned, true);
  assert.equal(logs.some((message) => message.includes('머지 성공: feature-a')), true);
  assert.equal(logs.some((message) => message.includes('워크트리 정리 완료')), true);
});

test('finalizeParallelWorkers keeps worktrees when merge conflicts remain', () => {
  const logs = [];
  let cleaned = false;

  const result = finalizeParallelWorkers({
    targetDir: 'C:\\workspace\\sleepcode',
    workerStates: [
      { name: 'main', merged: true },
      { name: 'feature-a', merged: false },
    ],
    cliProvider: 'claude',
    autoMergeWorktrees: () => ({ merged: [], conflicted: ['feature-a'], skipped: [] }),
    cleanupWorktrees: () => {
      cleaned = true;
    },
    pushLog: (message) => logs.push(message),
  });

  assert.equal(result.hasConflicts, true);
  assert.equal(result.cleaned, false);
  assert.equal(cleaned, false);
  assert.equal(logs.some((message) => message.includes('머지 충돌: feature-a')), true);
  assert.equal(logs.some((message) => message.includes('워크트리를 유지합니다')), true);
});
