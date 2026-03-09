const test = require('node:test');
const assert = require('node:assert/strict');

const { measureVisualWidth, wrapLogLine, createDashboardLogs } = require('../bin/lib/dashboardLogs');

test('measureVisualWidth counts CJK as 2 and ASCII as 1', () => {
  assert.equal(measureVisualWidth('hello'), 5);
  assert.equal(measureVisualWidth('안녕'), 4);
  assert.equal(measureVisualWidth('ab안녕cd'), 8);
});

test('measureVisualWidth ignores ANSI escape codes', () => {
  assert.equal(measureVisualWidth('\x1b[32mhello\x1b[0m'), 5);
  assert.equal(measureVisualWidth('\x1b[1m\x1b[36m안녕\x1b[0m'), 4);
});

test('wrapLogLine returns single-element array when line fits', () => {
  assert.deepEqual(wrapLogLine('short', 80), ['short']);
  assert.deepEqual(wrapLogLine('exact', 5), ['exact']);
});

test('wrapLogLine wraps plain ASCII at the correct boundary', () => {
  const line = 'a'.repeat(50); // 50 chars
  const result = wrapLogLine(line, 30);
  assert.equal(result.length, 2);
  // First line: 30 chars + reset
  assert.equal(result[0], 'a'.repeat(30) + '\x1b[0m');
  // Continuation: 6 spaces indent + remaining 20 chars
  assert.equal(result[1], '      ' + 'a'.repeat(20));
});

test('wrapLogLine preserves ANSI colors across wrap boundaries', () => {
  const line = '\x1b[32m' + 'a'.repeat(50) + '\x1b[0m'; // green text, 50 visible chars
  const result = wrapLogLine(line, 30);
  assert.equal(result.length, 2);
  // First line: green start + 30 chars + reset
  assert.equal(result[0], '\x1b[32m' + 'a'.repeat(30) + '\x1b[0m');
  // Continuation: indent + restore green + remaining + reset
  assert.equal(result[1], '      \x1b[32m' + 'a'.repeat(20) + '\x1b[0m');
});

test('wrapLogLine handles CJK characters at boundary', () => {
  // 29 ASCII + 1 CJK (2-width) = 31 visual, with maxWidth=30 the CJK should wrap
  const line = 'a'.repeat(29) + '한';
  const result = wrapLogLine(line, 30);
  assert.equal(result.length, 2);
  assert.equal(result[0], 'a'.repeat(29) + '\x1b[0m');
  assert.equal(result[1], '      한');
});

test('wrapLogLine wraps into 3+ lines for very long content', () => {
  const line = 'a'.repeat(80);
  const result = wrapLogLine(line, 30);
  // line 1: 30 chars, line 2: indent(6) + 24 chars = 30, line 3: indent(6) + 24 = 30, line 4: indent(6) + 2 remaining
  // 30 + 24 + 24 + 2 = 80
  assert.equal(result.length, 4);
  assert.equal(measureVisualWidth(result[0].replace(/\x1b\[[0-9;]*m/g, '')), 30);
});

test('pushLog wraps long lines into multiple buffer entries', () => {
  const logs = createDashboardLogs({
    getDashboardHeight: () => 3,
    isAltScreenActive: () => false,
    formatLogLine: (name, msg) => msg,
    stdout: { rows: 24, columns: 50 },
    maxBuffer: 200,
  });

  // maxContentWidth = max(20, 50-2) = 48
  const longMsg = 'x'.repeat(100);
  logs.pushLog('test', longMsg);

  const buffer = logs.getLogBuffer();
  assert.ok(buffer.length > 1, `should be wrapped into multiple lines, got ${buffer.length}`);
  // First line should be 48 chars + reset
  assert.equal(buffer[0], 'x'.repeat(48) + '\x1b[0m');
});
