const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildConflictResolutionPrompt,
  formatExecError,
} = require('../bin/lib/parallelMerge');
const { getConflictResolverProviders } = require('../bin/lib/parallelMergeConflict');

test('formatExecError prefers stderr then stdout then message', () => {
  assert.equal(formatExecError({ stderr: 'stderr message', stdout: 'stdout message' }), 'stderr message');
  assert.equal(formatExecError({ stderr: '', stdout: 'stdout message' }), 'stdout message');
  assert.equal(formatExecError({ message: 'fallback message' }), 'fallback message');
});

test('buildConflictResolutionPrompt includes merge context and restrictions', () => {
  const prompt = buildConflictResolutionPrompt(process.cwd(), 'main', 'sleepcode/feature-auth', [
    'src/app.js',
    'src/api.js',
  ]);

  assert.match(prompt, /Current branch: main/);
  assert.match(prompt, /Incoming branch: sleepcode\/feature-auth/);
  assert.match(prompt, /- src\/app\.js/);
  assert.match(prompt, /Do not modify or stage anything under \.sleepcode\//);
});

test('getConflictResolverProviders prefers the configured default provider first', () => {
  assert.deepEqual(
    getConflictResolverProviders({
      preferred: 'codex',
      selected: 'claude',
      fallback: 'codex',
    }),
    ['codex', 'claude']
  );

  assert.deepEqual(
    getConflictResolverProviders({
      preferred: 'auto',
      selected: 'claude',
      fallback: 'codex',
    }),
    ['claude', 'codex']
  );
});
