const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveNotionUpdateArgs } = require('../bin/lib/notionUpdate');

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('resolveNotionUpdateArgs falls back to .sleepcode/.env values', () => {
  withTempDir('sleepcode-notion-update-', (dir) => {
    const envPath = path.join(dir, '.sleepcode', '.env');
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, 'NOTION_API_KEY=test-key\nNOTION_DB_ID=test-db\n');

    assert.deepEqual(resolveNotionUpdateArgs(dir, {}), {
      notionKey: 'test-key',
      notionDbRaw: 'test-db',
    });
  });
});

test('resolveNotionUpdateArgs prefers CLI values over env values', () => {
  withTempDir('sleepcode-notion-update-', (dir) => {
    const envPath = path.join(dir, '.sleepcode', '.env');
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, 'NOTION_API_KEY=test-key\nNOTION_DB_ID=test-db\n');

    assert.deepEqual(
      resolveNotionUpdateArgs(dir, { notionKey: 'cli-key', notionDb: 'cli-db' }),
      {
        notionKey: 'cli-key',
        notionDbRaw: 'cli-db',
      }
    );
  });
});
