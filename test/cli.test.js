const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs, parseCommand } = require('../bin/lib/cli');

test('parseCommand recognizes the explicit init subcommand', () => {
  assert.equal(parseCommand(['node', 'sleepcode', 'init']), 'init');
});

test('parseCommand leaves option-only invocation as init alias mode', () => {
  assert.equal(parseCommand(['node', 'sleepcode', '--type', 'nextjs']), '');
});

test('parseCommand keeps legacy parallel invocations detectable for migration messaging', () => {
  assert.equal(parseCommand(['node', 'sleepcode', 'parallel', '--clean']), 'parallel');
});

test('parseArgs ignores the init token and still parses init options', () => {
  assert.deepEqual(
    parseArgs(['node', 'sleepcode', 'init', '--type', 'nextjs', '--name', 'demo']),
    {
      type: 'nextjs',
      name: 'demo',
    }
  );
});

test('parseArgs reads run worktree management flags', () => {
  assert.deepEqual(
    parseArgs(['node', 'sleepcode', 'run', '--setup', '--status', '--merge', '--clean']),
    {
      setup: true,
      status: true,
      merge: true,
      clean: true,
    }
  );
});
