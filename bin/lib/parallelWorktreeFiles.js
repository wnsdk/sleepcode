const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function normalizeStatusPathPart(value) {
  return String(value || '').trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
}

function isRuntimeOnlyStatusLine(line) {
  const payload = String(line || '').slice(3).trim();
  if (!payload) return false;
  const paths = payload.split(' -> ').map(normalizeStatusPathPart).filter(Boolean);
  if (paths.length === 0) return false;
  return paths.every((part) => part.startsWith('.sleepcode/runtime/'));
}

function getMergeBlockingStatus(targetDir) {
  try {
    const output = execSync('git status --porcelain', { cwd: targetDir, stdio: 'pipe' }).toString();
    if (!output.trim()) return '';
    return output
      .split(/\r?\n/)
      .filter((line) => line.trim() && !isRuntimeOnlyStatusLine(line))
      .join('\n');
  } catch {
    return '';
  }
}

function copySleepcodeDirToWorktree(srcDir, wtPath) {
  const sleepcodeDir = path.join(srcDir, '.sleepcode');
  const wtSleepcodeDir = path.join(wtPath, '.sleepcode');

  if (!fs.existsSync(sleepcodeDir)) return;

  const EXCLUDE_DIRS = new Set(['runtime', 'worktrees', 'logs', 'task_done']);

  function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        if (src === sleepcodeDir && EXCLUDE_DIRS.has(entry.name)) continue;
        copyDirRecursive(srcPath, destPath);
        continue;
      }
      fs.copyFileSync(srcPath, destPath);
    }
  }

  copyDirRecursive(sleepcodeDir, wtSleepcodeDir);
}

module.exports = {
  copySleepcodeDirToWorktree,
  getMergeBlockingStatus,
  isRuntimeOnlyStatusLine,
  normalizeStatusPathPart,
};
