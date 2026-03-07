const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clipVisualText,
  formatElapsedSeconds,
  getRunDashboardHeight,
} = require('../bin/lib/runDashboard');

test('clipVisualText truncates long task labels and preserves short ones', () => {
  assert.equal(clipVisualText('짧은 작업', 20), '짧은 작업');
  assert.equal(clipVisualText('이건 상당히 긴 작업 설명입니다', 10).endsWith('...'), true);
});

test('getRunDashboardHeight switches between waiting and executing layouts', () => {
  assert.equal(getRunDashboardHeight('waiting', []), 12);
  assert.equal(getRunDashboardHeight('executing', []), 12);
  assert.equal(getRunDashboardHeight('executing', [{ name: 'main' }]), 10);
  assert.equal(getRunDashboardHeight('executing', [{}, {}, {}]), 14);
});

test('formatElapsedSeconds renders seconds, minutes, and hours compactly', () => {
  assert.equal(formatElapsedSeconds(5), '5s');
  assert.equal(formatElapsedSeconds(125), '2m 5s');
  assert.equal(formatElapsedSeconds(3661), '1h 1m');
});
