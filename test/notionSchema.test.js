const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXPECTED_DB_PROPERTIES,
  summarizeSchemaChanges,
} = require('../bin/lib/notionSchema');

test('EXPECTED_DB_PROPERTIES includes Difficulty as a 1-5 select field', () => {
  assert.deepEqual(
    EXPECTED_DB_PROPERTIES.Difficulty.select.options.map((option) => option.name),
    ['1', '2', '3', '4', '5']
  );
});

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
