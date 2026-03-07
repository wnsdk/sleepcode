const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeSchemaChanges } = require('../bin/lib/notionSchema');

test('summarizeSchemaChanges captures added, updated, and skipped columns', () => {
  assert.deepEqual(
    summarizeSchemaChanges({
      added: ['Run'],
      updated: ['Status'],
      skipped: ['Legacy(status)'],
    }),
    {
      added: ['Run'],
      updated: ['Status'],
      skipped: ['Legacy(status)'],
      parts: ['추가: Run', '업데이트: Status'],
      hasChanges: true,
    }
  );
});

test('summarizeSchemaChanges treats empty results as no-op', () => {
  assert.deepEqual(
    summarizeSchemaChanges({ added: [], updated: [], skipped: [] }),
    {
      added: [],
      updated: [],
      skipped: [],
      parts: [],
      hasChanges: false,
    }
  );
});
