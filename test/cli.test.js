const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs, parseCommand } = require('../bin/lib/cli');

test('parseCommand recognizes the explicit init subcommand', () => {
  assert.equal(parseCommand(['node', 'sleepcode', 'init']), 'init');
});

test('parseCommand leaves option-only invocation as init alias mode', () => {
  assert.equal(parseCommand(['node', 'sleepcode', '--type', 'nextjs']), '');
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
