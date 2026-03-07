const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCompletedAtProp,
  buildModelProp,
  buildStatusProps,
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
