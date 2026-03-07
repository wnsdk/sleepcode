const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRunSetup } = require('../bin/lib/runSetup');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('createRunSetup loads env, applies CLI overrides, and returns runtime paths', () => {
  withTempDir('sleepcode-run-setup-', (dir) => {
    fs.mkdirSync(path.join(dir, '.sleepcode'), { recursive: true });

    const env = {};
    const notionSync = { poll: () => ({ items: [] }) };
    const calls = {};

    const setup = createRunSetup({
      targetDir: dir,
      env,
      loadEnvFileToProcessEnvFn: (envPath) => {
        calls.envPath = envPath;
        env.NOTION_API_KEY = 'env-key';
        env.NOTION_DB_ID = 'env-db';
      },
      parseArgsFn: () => ({
        interval: '45',
        notionDb: 'https://www.notion.so/workspace/cli-db?v=view',
        notionFilter: 'status:pending',
        notionKey: 'cli-key',
      }),
      parseNotionDbIdFn: (value) => {
        calls.rawDbArg = value;
        return 'cli-db';
      },
      detectPythonFn: () => ({ cmd: 'python3', version: '3.12.0' }),
      createNotionSyncClientFn: (options) => {
        calls.clientOptions = options;
        return notionSync;
      },
      ensureRuntimeDirsFn: (targetDirArg) => {
        calls.runtimeDirTarget = targetDirArg;
        return { logsDir: path.join(targetDirArg, '.sleepcode', 'runtime', 'logs') };
      },
      getRuntimeTaskQueuePathFn: (targetDirArg) => path.join(targetDirArg, '.sleepcode', 'runtime', 'task_queue.md'),
      getRuntimeGracefulStopPathFn: (targetDirArg) => path.join(targetDirArg, '.sleepcode', 'runtime', 'graceful_stop'),
    });

    assert.equal(calls.envPath, path.join(dir, '.sleepcode', '.env'));
    assert.equal(calls.rawDbArg, 'https://www.notion.so/workspace/cli-db?v=view');
    assert.equal(calls.runtimeDirTarget, dir);
    assert.deepEqual(calls.clientOptions, {
      env,
      pythonCommand: 'python3',
      targetDir: dir,
    });
    assert.equal(env.NOTION_API_KEY, 'cli-key');
    assert.equal(env.NOTION_DB_ID, 'cli-db');
    assert.equal(env.NOTION_FILTER, 'status:pending');
    assert.equal(setup.dbId, 'cli-db');
    assert.equal(setup.notionSync, notionSync);
    assert.equal(setup.pollIntervalSec, 45);
    assert.equal(setup.pollIntervalMs, 45000);
    assert.equal(setup.py.cmd, 'python3');
    assert.equal(setup.runtimeTasksPath, path.join(dir, '.sleepcode', 'runtime', 'task_queue.md'));
    assert.equal(setup.gracefulStopPath, path.join(dir, '.sleepcode', 'runtime', 'graceful_stop'));
  });
});

test('createRunSetup throws a structured error when .sleepcode is missing', () => {
  assert.throws(
    () => createRunSetup({ targetDir: 'C:\\workspace\\missing', existsSync: () => false }),
    (error) => {
      assert.equal(error.exitCode, 1);
      assert.equal(error.outputLines.length, 1);
      assert.match(error.outputLines[0], /\.sleepcode\/ 폴더가 없습니다/);
      return true;
    }
  );
});

test('createRunSetup throws a structured error when notion credentials are missing', () => {
  withTempDir('sleepcode-run-setup-', (dir) => {
    fs.mkdirSync(path.join(dir, '.sleepcode'), { recursive: true });

    assert.throws(
      () => createRunSetup({
        targetDir: dir,
        env: {},
        loadEnvFileToProcessEnvFn: () => {},
        parseArgsFn: () => ({}),
      }),
      (error) => {
        assert.equal(error.exitCode, 1);
        assert.equal(error.outputLines.length, 3);
        assert.match(error.outputLines[0], /Notion API Key와 DB ID가 필요합니다/);
        assert.match(error.outputLines[1], /sleepcode run --notion-key/);
        return true;
      }
    );
  });
});

test('createRunSetup throws a structured error when python is unavailable', () => {
  withTempDir('sleepcode-run-setup-', (dir) => {
    fs.mkdirSync(path.join(dir, '.sleepcode'), { recursive: true });

    assert.throws(
      () => createRunSetup({
        targetDir: dir,
        env: {
          NOTION_API_KEY: 'key',
          NOTION_DB_ID: 'db',
        },
        loadEnvFileToProcessEnvFn: () => {},
        parseArgsFn: () => ({}),
        detectPythonFn: () => null,
      }),
      (error) => {
        assert.equal(error.exitCode, 1);
        assert.equal(error.outputLines.length, 1);
        assert.match(error.outputLines[0], /python3이 필요합니다/);
        return true;
      }
    );
  });
});
