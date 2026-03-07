const { execFileSync } = require('child_process');

function formatExecError(err) {
  if (!err) return 'unknown error';
  const stderr = err.stderr ? String(err.stderr).trim() : '';
  if (stderr) return stderr;
  const stdout = err.stdout ? String(err.stdout).trim() : '';
  if (stdout) return stdout;
  return err.message || 'unknown error';
}

function gitOutput(targetDir, args) {
  return execFileSync('git', args, {
    cwd: targetDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString().trim();
}

function getHeadCommit(targetDir) {
  return gitOutput(targetDir, ['rev-parse', 'HEAD']);
}

function detectForbiddenGitWriteCommand(obj) {
  if (!obj || !obj.item || obj.item.type !== 'command_execution') return null;
  const command = String(obj.item.command || '').trim();
  if (!command) return null;

  const lowered = command.toLowerCase();
  const forbiddenPattern = /\bgit\s+(add|commit|merge|checkout|switch|cherry-pick|rebase|reset|restore|stash|worktree|clean)\b/;
  if (!forbiddenPattern.test(lowered)) return null;
  return command;
}

function terminateProcessTree(proc) {
  if (!proc || !proc.pid) return;

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return;
    } catch {}
  }

  try {
    proc.kill('SIGTERM');
  } catch {}
}

module.exports = {
  formatExecError,
  gitOutput,
  getHeadCommit,
  detectForbiddenGitWriteCommand,
  terminateProcessTree,
};
