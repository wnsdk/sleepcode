const test = require('node:test');
const assert = require('node:assert/strict');

const { PROVIDERS } = require('../bin/lib/constants');
const {
  findTaskMetadata,
  prepareTaskExecution,
} = require('../bin/lib/workerTaskPrep');

function collectLogMessages() {
  const lines = [];
  return {
    lines,
    pushLog: (...args) => {
      lines.push(args[1] || args[0] || '');
    },
  };
}

test('findTaskMetadata prefers notion id and falls back to title', () => {
  const taskEntries = [
    { id: 'task-1', title: '첫 번째 작업', difficulty: 2 },
    { id: 'task-2', title: '두 번째 작업', difficulty: 4 },
  ];

  assert.equal(
    findTaskMetadata({ title: '무시됨', notionId: 'task-2' }, taskEntries),
    taskEntries[1]
  );
  assert.equal(
    findTaskMetadata({ title: '첫 번째 작업', notionId: '' }, taskEntries),
    taskEntries[0]
  );
  assert.equal(findTaskMetadata({ title: '없는 작업', notionId: '' }, taskEntries), null);
});

test('prepareTaskExecution uses notion difficulty before AI assessment', () => {
  const { lines, pushLog } = collectLogMessages();
  let assessCalled = false;
  let onUpdateCalled = 0;
  const ws = {
    name: 'main',
    targetDir: '/tmp/sleepcode',
    taskEntries: [{ id: 'task-1', title: '노션 태스크', difficulty: 5 }],
  };

  const result = prepareTaskExecution({
    ws,
    wtDir: '/tmp/sleepcode',
    nextTask: '노션 태스크',
    cliProvider: '',
    buildTaskPrompt: () => 'task prompt',
    nextTaskEntry: { title: '노션 태스크', notionId: 'task-1' },
    pushLog,
    onUpdate: () => {
      onUpdateCalled += 1;
    },
    resolveProviderPlanFn: () => ({
      selected: PROVIDERS.CLAUDE,
      fallback: PROVIDERS.CODEX,
    }),
    assessTaskDifficultyFn: () => {
      assessCalled = true;
      return { difficulty: 1, label: '★☆☆☆☆', model: 'wrong-model' };
    },
    buildDifficultyAssessmentFn: (difficulty) => ({
      difficulty,
      label: '★★★★★',
      model: 'claude-opus-4-6',
    }),
    buildExecutionPromptFn: (_wtDir, taskPrompt, provider) => `${provider}:${taskPrompt}`,
    getHeadCommitFn: () => 'abc123',
  });

  assert.equal(result.error, undefined);
  assert.equal(assessCalled, false);
  assert.equal(onUpdateCalled, 1);
  assert.equal(ws.provider, PROVIDERS.CLAUDE);
  assert.equal(ws.difficulty, 5);
  assert.equal(ws.difficultyLabel, '★★★★★');
  assert.equal(ws.model, 'claude-opus-4-6');
  assert.match(lines.join('\n'), /\[Notion\]/);
  assert.equal(result.taskStartHead, 'abc123');
  assert.equal(result.promptsByProvider[PROVIDERS.CLAUDE], 'task prompt');
  assert.equal(result.promptsByProvider[PROVIDERS.CODEX], 'codex:task prompt');
});

test('prepareTaskExecution falls back to AI assessment when notion difficulty is absent', () => {
  const { lines, pushLog } = collectLogMessages();
  let assessCalled = 0;
  const ws = {
    name: 'main',
    targetDir: '/tmp/sleepcode',
    taskEntries: [{ id: 'task-1', title: '노션 태스크', difficulty: '' }],
  };

  const result = prepareTaskExecution({
    ws,
    wtDir: '/tmp/sleepcode',
    nextTask: '노션 태스크',
    cliProvider: '',
    buildTaskPrompt: () => 'task prompt',
    nextTaskEntry: { title: '노션 태스크', notionId: 'task-1' },
    pushLog,
    onUpdate: () => {},
    resolveProviderPlanFn: () => ({
      selected: PROVIDERS.CODEX,
      fallback: PROVIDERS.CLAUDE,
    }),
    assessTaskDifficultyFn: () => {
      assessCalled += 1;
      return { difficulty: 2, label: '★★☆☆☆', model: 'gpt-5.1-codex-mini' };
    },
    buildDifficultyAssessmentFn: () => {
      throw new Error('should not use notion difficulty');
    },
    buildExecutionPromptFn: (_wtDir, taskPrompt, provider) => `${provider}:${taskPrompt}`,
    getHeadCommitFn: () => 'def456',
  });

  assert.equal(result.error, undefined);
  assert.equal(assessCalled, 1);
  assert.equal(ws.provider, PROVIDERS.CODEX);
  assert.equal(ws.difficulty, 2);
  assert.equal(ws.model, 'gpt-5.1-codex-mini');
  assert.doesNotMatch(lines.join('\n'), /\[Notion\]/);
});
