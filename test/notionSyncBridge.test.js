const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createNotionSyncBridge,
  ensureNotionSyncScript,
} = require('../bin/lib/notionSyncBridge');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('ensureNotionSyncScript copies the template into .sleepcode/scripts', () => {
  withTempDir('sleepcode-notion-bridge-', (dir) => {
    const templatePath = path.join(dir, 'template.py');
    fs.writeFileSync(templatePath, 'print("hello")\r\n', 'utf-8');

    const scriptPath = ensureNotionSyncScript(dir, {
      templatePath,
      existsSync: fs.existsSync,
      mkdirSync: fs.mkdirSync,
      readFileSync: fs.readFileSync,
      writeFileSync: fs.writeFileSync,
      chmodSync: fs.chmodSync,
    });

    assert.equal(scriptPath, path.join(dir, '.sleepcode', 'scripts', 'notion_sync.py'));
    assert.equal(fs.existsSync(scriptPath), true);
    assert.equal(fs.readFileSync(scriptPath, 'utf-8'), 'print("hello")\n');
  });
});

test('createNotionSyncBridge sends the expected commands to the python script', () => {
  const execCalls = [];
  const bridge = createNotionSyncBridge({
    targetDir: 'C:\\workspace\\sleepcode',
    pythonCommand: 'python3',
    syncScript: 'C:\\workspace\\sleepcode\\.sleepcode\\scripts\\notion_sync.py',
    env: { NOTION_API_KEY: 'key' },
    execFileSyncFn: (command, args, options) => {
      execCalls.push({ command, args, options });
      if (args[1] === 'poll') {
        return JSON.stringify({ tasks: [], schema: {} });
      }
      if (args[1] === 'update-page') {
        return JSON.stringify({ ok: true });
      }
      return '';
    },
  });

  const pollResult = bridge.poll();
  const updateResult = bridge.updatePage('page-1', { Status: { status: { name: 'Running' } } });
  bridge.appendContent('page-1', 'report text');

  assert.deepEqual(pollResult, { tasks: [], schema: {} });
  assert.deepEqual(updateResult, { ok: true });
  assert.equal(execCalls.length, 3);
  assert.deepEqual(execCalls[0], {
    command: 'python3',
    args: ['C:\\workspace\\sleepcode\\.sleepcode\\scripts\\notion_sync.py', 'poll'],
    options: {
      cwd: 'C:\\workspace\\sleepcode',
      env: { NOTION_API_KEY: 'key' },
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 30000,
      input: undefined,
    },
  });
  assert.equal(execCalls[1].args[1], 'update-page');
  assert.equal(execCalls[1].args[2], 'page-1');
  assert.equal(execCalls[1].options.timeout, 15000);
  assert.equal(execCalls[1].options.input, JSON.stringify({ Status: { status: { name: 'Running' } } }));
  assert.equal(execCalls[2].args[1], 'append-content');
  assert.equal(execCalls[2].options.timeout, 60000);
  assert.equal(execCalls[2].options.input, 'report text');
});
