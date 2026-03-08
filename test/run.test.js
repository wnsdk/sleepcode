const test = require('node:test');
const assert = require('node:assert/strict');

const { runWorker, _internals } = require('../bin/lib/run');

test('hasTaskQueueManagementFlags detects worktree management options', () => {
  assert.equal(_internals.hasTaskQueueManagementFlags({}), false);
  assert.equal(_internals.hasTaskQueueManagementFlags({ setup: true }), true);
  assert.equal(_internals.hasTaskQueueManagementFlags({ clean: true }), true);
  assert.equal(_internals.hasTaskQueueManagementFlags({ status: true }), true);
  assert.equal(_internals.hasTaskQueueManagementFlags({ merge: true }), true);
});

test('shouldUseNotionControlPlane prefers explicit notion arguments', () => {
  assert.equal(
    _internals.shouldUseNotionControlPlane(
      'C:\\workspace\\sleepcode',
      { notionDb: 'db-id' },
      {},
      () => ({})
    ),
    true
  );
});

test('runWorker routes to task queue execution when notion config is absent', () => {
  const calls = [];

  runWorker('codex', {}, {
    targetDir: 'C:\\workspace\\sleepcode',
    env: {},
    parseEnvFileFn: () => ({}),
    runTaskQueueCommandFn: (args) => calls.push(['task_queue', args]),
    cmdWatchFn: () => calls.push(['watch']),
  });

  assert.deepEqual(calls, [[
    'task_queue',
    {
      cliArgs: {},
      cliProvider: 'codex',
      targetDir: 'C:\\workspace\\sleepcode',
    },
  ]]);
});

test('runWorker routes to notion control plane when credentials are configured', () => {
  const calls = [];

  runWorker('claude', {}, {
    targetDir: 'C:\\workspace\\sleepcode',
    env: {},
    parseEnvFileFn: () => ({
      NOTION_API_KEY: 'secret',
      NOTION_DB_ID: 'db-id',
    }),
    runTaskQueueCommandFn: () => calls.push(['task_queue']),
    cmdWatchFn: (provider) => calls.push(['watch', provider]),
  });

  assert.deepEqual(calls, [['watch', 'claude']]);
});

test('runWorker keeps worktree management under run even when notion credentials exist', () => {
  const calls = [];

  runWorker('codex', { clean: true }, {
    targetDir: 'C:\\workspace\\sleepcode',
    env: {},
    parseEnvFileFn: () => ({
      NOTION_API_KEY: 'secret',
      NOTION_DB_ID: 'db-id',
    }),
    runTaskQueueCommandFn: (args) => calls.push(['task_queue', args.cliArgs.clean]),
    cmdWatchFn: () => calls.push(['watch']),
  });

  assert.deepEqual(calls, [['task_queue', true]]);
});
