const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createParallelDashboardLogs,
  formatParallelDashboardLogLine,
} = require('../bin/lib/parallelDashboardLogs');

test('formatParallelDashboardLogLine formats worker tags and keeps system messages plain', () => {
  assert.match(formatParallelDashboardLogLine('feature-a', '메시지'), /\[feature-a\].*메시지/);
  assert.equal(formatParallelDashboardLogLine('SYSTEM', '종료 예정'), '종료 예정');
});

test('createParallelDashboardLogs appends, renders, and scrolls buffered logs', () => {
  const writes = [];
  const stdout = {
    rows: 8,
    write(chunk) {
      writes.push(chunk);
    },
  };

  const logs = createParallelDashboardLogs({
    getDashboardHeight: () => 4,
    isAltScreenActive: () => true,
    stdout,
    formatLogLine: (name, message) => `[${name}] ${message}`,
  });

  logs.pushLog('main', '첫 번째');
  logs.pushLog('main', '두 번째');
  logs.pushLog('main', '세 번째');
  logs.pushLog('main', '네 번째');
  logs.pushLog('main', '다섯 번째');

  assert.equal(logs.getLogRows(), 4);
  assert.equal(logs.getMaxLogScroll(), 1);
  assert.equal(logs.getLogScroll(), 0);
  assert.equal(logs.handleScroll('lineUp'), true);
  assert.equal(logs.getLogScroll(), 1);

  writes.length = 0;
  logs.renderLogs(true);

  const output = writes.join('');
  assert.match(output, /\[main\] 첫 번째/);
  assert.match(output, /\[main\] 네 번째/);
  assert.doesNotMatch(output, /\[main\] 다섯 번째/);
});

test('createParallelDashboardLogs ignores writes while inactive and keeps scroll when new logs arrive', () => {
  const writes = [];
  let active = false;
  const logs = createParallelDashboardLogs({
    getDashboardHeight: () => 3,
    isAltScreenActive: () => active,
    stdout: {
      rows: 6,
      write(chunk) {
        writes.push(chunk);
      },
    },
    maxBuffer: 3,
    formatLogLine: (name, message) => `[${name}] ${message}`,
  });

  logs.pushLog('main', '하나');
  logs.pushLog('main', '둘');
  logs.pushLog('main', '셋');
  logs.handleScroll('lineUp');
  logs.pushLog('main', '넷');

  assert.deepEqual(logs.getLogBuffer(), ['[main] 둘', '[main] 셋', '[main] 넷']);
  assert.equal(writes.length, 0);

  active = true;
  logs.renderLogs(true);
  assert.ok(writes.length > 0);
});
