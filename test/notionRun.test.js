const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildExecutionReportText,
  buildFinalTaskProps,
  buildRuntimeTaskQueueContent,
  groupTasksByWorker,
  updateFirstPendingStatuses,
} = require('../bin/lib/notionRun');

test('groupTasksByWorker normalizes worker names and defaults to main', () => {
  const groups = groupTasksByWorker([
    { id: '1', title: 'A', worker: '@worker feature-auth' },
    { id: '2', title: 'B', worker: 'feature-auth' },
    { id: '3', title: 'C', worker: '' },
  ]);

  assert.deepEqual(Object.keys(groups), ['feature-auth', 'main']);
  assert.deepEqual(groups['feature-auth'].map((task) => task.id), ['1', '2']);
  assert.deepEqual(groups.main.map((task) => task.id), ['3']);
});

test('groupTasksByWorker uses defaultWorker when worker is empty', () => {
  const groups = groupTasksByWorker([
    { id: '1', title: 'A', worker: '@worker feature-auth' },
    { id: '2', title: 'B', worker: '' },
    { id: '3', title: 'C', worker: '' },
  ], { defaultWorker: 'dev' });

  assert.deepEqual(Object.keys(groups), ['feature-auth', 'dev']);
  assert.deepEqual(groups['feature-auth'].map((task) => task.id), ['1']);
  assert.deepEqual(groups.dev.map((task) => task.id), ['2', '3']);
});

test('buildRuntimeTaskQueueContent renders parallel and single-mode queues', () => {
  const workerGroups = {
    main: [{ id: 'n1', title: '메인 태스크' }],
    bugfix: [{ id: 'n2', title: '버그 수정' }],
  };

  const parallelContent = buildRuntimeTaskQueueContent(workerGroups, { parallel: true });
  const singleContent = buildRuntimeTaskQueueContent(workerGroups, { parallel: false });

  assert.match(parallelContent, /## @worker main/);
  assert.match(parallelContent, /- \[ \] 버그 수정 <!-- notion:n2 -->/);
  assert.match(singleContent, /아래 태스크를 순서대로 진행하세요/);
  assert.doesNotMatch(singleContent, /## @worker/);
});

test('updateFirstPendingStatuses promotes the first unfinished task per worker', () => {
  const updates = [];
  const notionInProgressIds = new Set(['done-task']);
  updateFirstPendingStatuses({
    schema: { status_prop: 'Status', status_type: 'status' },
    tasks: [
      { id: 'done-task', worker: 'main' },
      { id: 'next-main', worker: 'main' },
      { id: 'next-worker', worker: 'feature-a' },
      { id: 'later-worker', worker: 'feature-a' },
    ],
    taskStatuses: { 'done-task': true },
    notionInProgressIds,
    updatePage: (pageId, props) => {
      updates.push({ pageId, props });
      return true;
    },
  });

  assert.deepEqual(
    updates,
    [
      { pageId: 'next-main', props: { Status: { status: { name: 'Running' } } } },
      { pageId: 'next-worker', props: { Status: { status: { name: 'Running' } } } },
    ]
  );
});

test('buildFinalTaskProps and buildExecutionReportText summarize results', () => {
  const props = buildFinalTaskProps({
    schema: {
      status_prop: 'Status',
      status_type: 'status',
      completed_at_prop: 'Completed At',
      cost_prop: 'Cost',
      log_prop: 'Log',
    },
    isDone: true,
    totalCost: 1.23456,
    totalTasks: 2,
    totalInputTokens: 800,
    totalOutputTokens: 200,
    alreadyCompleted: false,
  });

  assert.deepEqual(props.Status, { status: { name: 'Success' } });
  assert.equal(props.Cost.number, 500);
  assert.match(props.Log.rich_text[0].text.content, /^완료 \(\$0\.6173\)$/);
  assert.match(
    buildExecutionReportText([
      { reportLines: ['첫 번째 줄', '두 번째 줄'] },
      { reportLines: [] },
      { reportLines: ['세 번째 줄'] },
    ]),
    /첫 번째 줄[\s\S]*---[\s\S]*세 번째 줄/
  );
});

test('buildExecutionReportText includes token summary when tokenInfo provided', () => {
  const report = buildExecutionReportText(
    [{ reportLines: ['작업 완료'] }],
    {
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      tokensByProvider: { claude: { input: 1000, output: 500 } },
    }
  );

  assert.match(report, /Cost \(가중 토큰\)/);
  assert.match(report, /Input:/);
  assert.match(report, /Output:/);
  assert.match(report, /Total:/);
});
