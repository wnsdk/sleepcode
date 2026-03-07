const test = require('node:test');
const assert = require('node:assert/strict');

const { buildConfigToSave, parseClaudeRatio } = require('../bin/lib/init');

test('parseClaudeRatio accepts 0-100 percentages and rejects invalid input', () => {
  assert.equal(parseClaudeRatio('0'), 0);
  assert.equal(parseClaudeRatio('30'), 0.3);
  assert.equal(parseClaudeRatio('100'), 1);
  assert.equal(parseClaudeRatio('101'), null);
  assert.equal(parseClaudeRatio('-1'), null);
  assert.equal(parseClaudeRatio('abc'), null);
  assert.equal(parseClaudeRatio(undefined), null);
});

test('buildConfigToSave stores only configured values', () => {
  assert.deepEqual(
    buildConfigToSave({ weeklyBudget: 50, budgetThreshold: 90, claudeRatio: 0.3 }),
    { weeklyBudget: 50, budgetThreshold: 90, claudeRatio: 0.3 }
  );
  assert.deepEqual(
    buildConfigToSave({ weeklyBudget: 0, budgetThreshold: 90, claudeRatio: null }),
    {}
  );
  assert.deepEqual(
    buildConfigToSave({ weeklyBudget: 20, budgetThreshold: 80, claudeRatio: null }),
    { weeklyBudget: 20, budgetThreshold: 80 }
  );
});
