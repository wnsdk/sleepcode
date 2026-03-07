const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCompletedAtProp,
  buildModelProp,
  buildStatusProps,
  createNotionSyncClient,
} = require('../bin/lib/notionSync');

test('buildStatusProps supports status and select schemas', () => {
  assert.deepEqual(
    buildStatusProps({ status_prop: 'Status', status_type: 'status' }, 'Running'),
    { Status: { status: { name: 'Running' } } }
  );
  assert.deepEqual(
    buildStatusProps({ status_prop: 'State', status_type: 'select' }, 'Pending'),
    { State: { select: { name: 'Pending' } } }
  );
  assert.equal(buildStatusProps({}, 'Running'), null);
});

test('buildModelProp falls back to rich_text when schema is not select', () => {
  assert.deepEqual(
    buildModelProp({ model_prop: 'Model', model_type: 'select' }, 'gpt-5.2-codex'),
    { Model: { select: { name: 'gpt-5.2-codex' } } }
  );
  assert.deepEqual(
    buildModelProp({ model_prop: 'Model', model_type: 'rich_text' }, 'claude-sonnet-4-6'),
    { Model: { rich_text: [{ text: { content: 'claude-sonnet-4-6' } }] } }
  );
});

test('buildCompletedAtProp emits an ISO timestamp with timezone offset', () => {
  const schema = { completed_at_prop: 'Completed At' };
  const props = buildCompletedAtProp(schema, new Date('2026-03-07T12:34:56.000Z'));

  assert.ok(props['Completed At']);
  assert.match(
    props['Completed At'].date.start,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
  );
});

test('createNotionSyncClient delegates to the bridge and returns safe results', () => {
  const calls = [];
  const client = createNotionSyncClient({
    targetDir: 'C:\\workspace\\sleepcode',
    pythonCommand: 'python3',
    createNotionSyncBridgeFn: (options) => {
      calls.push(options);
      return {
        scriptPath: 'C:\\workspace\\sleepcode\\.sleepcode\\scripts\\notion_sync.py',
        poll: () => ({ tasks: [], schema: {} }),
        updatePage: () => ({ ok: true }),
        appendContent: () => {},
      };
    },
  });

  assert.equal(client.syncScript, 'C:\\workspace\\sleepcode\\.sleepcode\\scripts\\notion_sync.py');
  assert.deepEqual(client.poll(), { tasks: [], schema: {} });
  assert.equal(client.updatePage('page-1', { Status: { status: { name: 'Running' } } }), true);
  assert.equal(client.appendContent('page-1', 'report text'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pythonCommand, 'python3');
});

test('createNotionSyncClient converts bridge failures into poll/update/append fallbacks', () => {
  const client = createNotionSyncClient({
    targetDir: 'C:\\workspace\\sleepcode',
    pythonCommand: 'python3',
    createNotionSyncBridgeFn: () => ({
      scriptPath: 'C:\\workspace\\sleepcode\\.sleepcode\\scripts\\notion_sync.py',
      poll: () => {
        const error = new Error('bridge failed');
        error.stderr = 'stderr message';
        throw error;
      },
      updatePage: () => {
        throw new Error('update failed');
      },
      appendContent: () => {
        throw new Error('append failed');
      },
    }),
  });

  assert.deepEqual(client.poll(), { error: 'poll_failed', message: 'stderr message' });
  assert.equal(client.updatePage('page-1', { Status: { status: { name: 'Running' } } }), false);
  assert.equal(client.appendContent('page-1', 'report text'), false);
});
