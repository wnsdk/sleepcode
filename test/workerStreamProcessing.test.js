const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { PROVIDERS } = require('../bin/lib/constants');
const { loadUsage } = require('../bin/lib/configBudget');
const { processStreamEvent } = require('../bin/lib/workerStreamProcessing');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createWorker(targetDir = '') {
  return {
    name: 'main',
    provider: PROVIDERS.CODEX,
    model: 'gpt-5.2-codex',
    targetDir,
    path: targetDir,
    tasksPath: targetDir ? path.join(targetDir, '.sleepcode', 'task_queue.md') : '',
    cost: 0,
    totalCost: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    currentTaskCostRecorded: false,
    currentTaskReportLines: [],
    reportLines: [],
  };
}

test('processStreamEvent estimates Codex cost from turn.completed usage', () => {
  const ws = createWorker();
  let updates = 0;

  processStreamEvent(
    ws,
    {
      type: 'turn.completed',
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 100,
        prompt_tokens_details: { cached_tokens: 200 },
      },
    },
    () => {
      updates += 1;
    },
    () => {}
  );

  const expected = ((800 * 1.75) + (200 * 0.175) + (100 * 14)) / 1_000_000;
  assert.equal(ws.inputTokens, 1000);
  assert.equal(ws.outputTokens, 100);
  assert.ok(Math.abs(ws.cost - expected) < 1e-12);
  assert.ok(Math.abs(ws.totalCost - expected) < 1e-12);
  assert.equal(updates >= 1, true);
});

test('processStreamEvent records estimated Codex cost on result when cost_usd is absent', () => {
  withTempDir('sleepcode-worker-stream-', (dir) => {
    const sleepcodeDir = path.join(dir, '.sleepcode');
    fs.mkdirSync(sleepcodeDir, { recursive: true });
    fs.writeFileSync(path.join(sleepcodeDir, 'task_queue.md'), '# 작업 목록\n', 'utf-8');

    const ws = createWorker(dir);

    processStreamEvent(
      ws,
      {
        type: 'turn.completed',
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 100,
        },
      },
      () => {},
      () => {}
    );

    processStreamEvent(
      ws,
      {
        type: 'result',
        message: 'done',
      },
      () => {},
      () => {}
    );

    const usage = loadUsage(dir);
    assert.equal(usage.entries.length, 1);
    assert.equal(usage.entries[0].provider, PROVIDERS.CODEX);
    assert.ok(usage.entries[0].cost > 0);
    assert.equal(ws.currentTaskCostRecorded, true);
  });
});

test('processStreamEvent prefers explicit cost_usd over estimated Codex cost', () => {
  const ws = createWorker();

  processStreamEvent(
    ws,
    {
      type: 'turn.completed',
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 100,
      },
    },
    () => {},
    () => {}
  );

  processStreamEvent(
    ws,
    {
      type: 'result',
      cost_usd: 0.1234,
      message: 'done',
    },
    () => {},
    () => {}
  );

  assert.ok(Math.abs(ws.cost - 0.1234) < 1e-12);
  assert.ok(Math.abs(ws.totalCost - 0.1234) < 1e-12);
});
