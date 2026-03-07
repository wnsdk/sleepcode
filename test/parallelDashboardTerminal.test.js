const test = require('node:test');
const assert = require('node:assert/strict');

const { createParallelDashboardTerminal } = require('../bin/lib/parallelDashboardTerminal');

function createListenerHost() {
  const listeners = new Map();
  return {
    listeners,
    on(event, handler) {
      listeners.set(event, handler);
    },
    removeListener(event, handler) {
      if (listeners.get(event) === handler) {
        listeners.delete(event);
      }
    },
  };
}

test('createParallelDashboardTerminal starts alt screen, syncs viewport, and disposes listeners', () => {
  const writes = [];
  const stdout = {
    ...createListenerHost(),
    isTTY: true,
    rows: 20,
    write(chunk) {
      writes.push(chunk);
    },
  };
  const processRef = createListenerHost();
  let resizeCalls = 0;

  const terminal = createParallelDashboardTerminal({
    getDashboardHeight: () => 8,
    onResize: () => {
      resizeCalls += 1;
    },
    stdout,
    processRef,
  });

  terminal.start();
  assert.equal(terminal.isActive(), true);
  assert.ok(writes.includes('\x1b[?1049h'));
  assert.ok(writes.includes('\x1b[?25l'));
  assert.ok(writes.includes('\x1b[9;20r'));
  assert.equal(stdout.listeners.has('resize'), true);
  assert.equal(processRef.listeners.has('exit'), true);

  writes.length = 0;
  stdout.listeners.get('resize')();
  assert.equal(resizeCalls, 1);
  assert.ok(writes.includes('\x1b[2J'));

  terminal.dispose();
  assert.equal(terminal.isActive(), false);
  assert.equal(stdout.listeners.has('resize'), false);
  assert.equal(processRef.listeners.has('exit'), false);
  assert.ok(writes.includes('\x1b[?1049l'));
  assert.ok(writes.includes('\x1b[?25h'));
});

test('createParallelDashboardTerminal skips alt screen activation when stdout is not a TTY', () => {
  const writes = [];
  const terminal = createParallelDashboardTerminal({
    getDashboardHeight: () => 8,
    stdout: {
      ...createListenerHost(),
      isTTY: false,
      rows: 20,
      write(chunk) {
        writes.push(chunk);
      },
    },
    processRef: createListenerHost(),
  });

  terminal.start();
  assert.equal(terminal.isActive(), false);
  assert.deepEqual(writes, []);
});
