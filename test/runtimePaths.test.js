const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  getRuntimeDir,
  getRuntimeGracefulStopPath,
  getRuntimeLogsDir,
  getRuntimeMainTaskQueuePath,
  getRuntimeTaskQueuePath,
  getRuntimeWorktreesDir,
} = require('../bin/lib/runtimePaths');

test('runtime path helpers stay under .sleepcode/runtime', () => {
  const targetDir = path.join('C:', 'workspace', 'sleepcode');

  assert.equal(getRuntimeDir(targetDir), path.join(targetDir, '.sleepcode', 'runtime'));
  assert.equal(getRuntimeLogsDir(targetDir), path.join(targetDir, '.sleepcode', 'runtime', 'logs'));
  assert.equal(getRuntimeWorktreesDir(targetDir), path.join(targetDir, '.sleepcode', 'runtime', 'worktrees'));
  assert.equal(getRuntimeTaskQueuePath(targetDir), path.join(targetDir, '.sleepcode', 'runtime', 'task_queue.md'));
  assert.equal(getRuntimeMainTaskQueuePath(targetDir), path.join(targetDir, '.sleepcode', 'runtime', 'task_queue.main.md'));
  assert.equal(getRuntimeGracefulStopPath(targetDir), path.join(targetDir, '.sleepcode', 'runtime', 'graceful_stop'));
});
