const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureSleepcodeGitignoreContent } = require('../bin/lib/files');

test('ensureSleepcodeGitignoreContent preserves other rules and tracks task_done logs', () => {
  const current = [
    'node_modules/',
    '',
    '# sleepcode workspace',
    '.sleepcode/',
    '',
  ].join('\n');

  assert.equal(
    ensureSleepcodeGitignoreContent(current),
    [
      'node_modules/',
      '',
      '# sleepcode workspace',
      '.sleepcode/*',
      '!.sleepcode/task_done/',
      '!.sleepcode/task_done/**',
      '',
    ].join('\n')
  );
});
