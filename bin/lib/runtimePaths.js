const fs = require('fs');
const path = require('path');

function getSleepcodeDir(targetDir) {
  return path.join(targetDir, '.sleepcode');
}

function getRuntimeDir(targetDir) {
  return path.join(getSleepcodeDir(targetDir), 'runtime');
}

function getRuntimeLogsDir(targetDir) {
  return path.join(getRuntimeDir(targetDir), 'logs');
}

function getRuntimeWorktreesDir(targetDir) {
  return path.join(getRuntimeDir(targetDir), 'worktrees');
}

function getRuntimeTaskQueuePath(targetDir) {
  return path.join(getRuntimeDir(targetDir), 'task_queue.md');
}

function getRuntimeMainTaskQueuePath(targetDir) {
  return path.join(getRuntimeDir(targetDir), 'task_queue.main.md');
}

function getRuntimeGracefulStopPath(targetDir) {
  return path.join(getRuntimeDir(targetDir), 'graceful_stop');
}

function getRuntimeStopRequestsDir(targetDir) {
  return path.join(getRuntimeDir(targetDir), 'stop_requests');
}

function ensureRuntimeDirs(targetDir) {
  const runtimeDir = getRuntimeDir(targetDir);
  const logsDir = getRuntimeLogsDir(targetDir);
  const worktreesDir = getRuntimeWorktreesDir(targetDir);
  const stopRequestsDir = getRuntimeStopRequestsDir(targetDir);

  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(worktreesDir, { recursive: true });
  fs.mkdirSync(stopRequestsDir, { recursive: true });

  return {
    runtimeDir,
    logsDir,
    worktreesDir,
    stopRequestsDir,
  };
}

module.exports = {
  getSleepcodeDir,
  getRuntimeDir,
  getRuntimeLogsDir,
  getRuntimeWorktreesDir,
  getRuntimeTaskQueuePath,
  getRuntimeMainTaskQueuePath,
  getRuntimeGracefulStopPath,
  getRuntimeStopRequestsDir,
  ensureRuntimeDirs,
};
