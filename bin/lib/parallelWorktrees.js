const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { C } = require('./constants');
const { countTasks, progressBar } = require('./utils');
const { getPersistedTaskProgress } = require('./taskState');
const {
  ensureRuntimeDirs,
  getRuntimeMainTaskQueuePath,
  getRuntimeTaskQueuePath,
  getRuntimeWorktreesDir,
} = require('./runtimePaths');

const MAIN_WORKER_NAME = 'main';

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

function parseParallelTasks(tasksPath) {
  if (!fs.existsSync(tasksPath)) return null;
  const content = fs.readFileSync(tasksPath, 'utf-8');
  const lines = content.split('\n');

  const workers = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^## @worker\s+(\S+)/);
    if (match) {
      current = { name: match[1], lines: [line] };
      workers.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (workers.length === 0) return null;

  return workers.map((worker) => {
    const joined = worker.lines.join('\n');
    const counts = countTasks(joined);
    return {
      name: worker.name,
      tasks: `# 작업 목록\n\n${joined}`,
      remaining: counts.total - counts.done,
    };
  });
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

function createWorktrees(targetDir, workers) {
  const { worktreesDir: wtBase } = ensureRuntimeDirs(targetDir);
  const mainTasksPath = getRuntimeMainTaskQueuePath(targetDir);
  let currentBranch = 'main';
  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: targetDir, stdio: 'pipe' }).toString().trim() || 'main';
  } catch {}

  const created = [];
  for (const worker of workers) {
    if (worker.name === MAIN_WORKER_NAME) {
      fs.mkdirSync(path.dirname(mainTasksPath), { recursive: true });
      fs.writeFileSync(mainTasksPath, worker.tasks);
      const legacyMainWorktreePath = path.join(wtBase, MAIN_WORKER_NAME);
      if (fs.existsSync(legacyMainWorktreePath)) {
        console.log(`  ${C.yellow}!${C.reset} legacy worktree '${MAIN_WORKER_NAME}' 감지 — ${C.cyan}npx sleepcode parallel --clean${C.reset} 권장`);
      }
      console.log(`  ${C.green}✓${C.reset} ${worker.name} ${C.dim}(${currentBranch})${C.reset} — ${worker.remaining}개 태스크 ${C.dim}[현재 브랜치]${C.reset}`);
      created.push({
        name: worker.name,
        path: targetDir,
        branch: currentBranch,
        tasksPath: mainTasksPath,
        usesMainBranch: true,
      });
      continue;
    }

    const wtPath = path.join(wtBase, worker.name);
    const branch = `sleepcode/${worker.name}`;

    if (fs.existsSync(wtPath)) {
      console.log(`  ${C.dim}-${C.reset} ${worker.name} ${C.dim}(이미 존재)${C.reset}`);
      const wtSleepcodeDir = path.join(wtPath, '.sleepcode');
      if (!fs.existsSync(wtSleepcodeDir)) {
        copySleepcodeDirToWorktree(targetDir, wtPath);
      }
      const wtTasksPath = getRuntimeTaskQueuePath(wtPath);
      fs.mkdirSync(path.dirname(wtTasksPath), { recursive: true });
      fs.writeFileSync(wtTasksPath, worker.tasks);
      created.push({ name: worker.name, path: wtPath, branch, tasksPath: wtTasksPath });
      continue;
    }

    try {
      execSync(`git worktree add "${wtPath}" -b "${branch}"`, {
        cwd: targetDir,
        stdio: 'pipe',
      });
    } catch {
      try {
        execSync(`git worktree add "${wtPath}" "${branch}"`, {
          cwd: targetDir,
          stdio: 'pipe',
        });
      } catch (e) {
        console.error(`  ${C.red}✗${C.reset} ${worker.name}: ${e.message}`);
        continue;
      }
    }

    copySleepcodeDirToWorktree(targetDir, wtPath);

    const wtTasksPath = getRuntimeTaskQueuePath(wtPath);
    fs.mkdirSync(path.dirname(wtTasksPath), { recursive: true });
    fs.writeFileSync(wtTasksPath, worker.tasks);

    console.log(`  ${C.green}✓${C.reset} ${worker.name} ${C.dim}(${branch})${C.reset} — ${worker.remaining}개 태스크`);
    created.push({ name: worker.name, path: wtPath, branch, tasksPath: wtTasksPath });
  }

  return created;
}

function cleanupWorktrees(targetDir, workers) {
  const wtBase = getRuntimeWorktreesDir(targetDir);
  const mainTasksPath = getRuntimeMainTaskQueuePath(targetDir);

  if (workers) {
    for (const worker of workers) {
      if (worker.name === MAIN_WORKER_NAME) {
        if (fs.existsSync(mainTasksPath)) {
          try {
            fs.unlinkSync(mainTasksPath);
            console.log(`  ${C.green}✓${C.reset} ${worker.name} task 파일 제거`);
          } catch (e) {
            console.error(`  ${C.red}✗${C.reset} ${worker.name}: ${e.message}`);
          }
        }
        continue;
      }
      const wtPath = path.join(wtBase, worker.name);
      if (!fs.existsSync(wtPath)) continue;
      try {
        execSync(`git worktree remove "${wtPath}" --force`, { cwd: targetDir, stdio: 'pipe' });
        console.log(`  ${C.green}✓${C.reset} ${worker.name} worktree 제거`);
      } catch (e) {
        console.error(`  ${C.red}✗${C.reset} ${worker.name}: ${e.message}`);
      }
    }
  } else {
    if (!fs.existsSync(wtBase)) {
      if (!fs.existsSync(mainTasksPath)) {
        console.log(`${C.dim}정리할 worktree가 없습니다.${C.reset}`);
        return;
      }
    }
    if (fs.existsSync(wtBase)) {
      const dirs = fs.readdirSync(wtBase).filter((dir) =>
        fs.statSync(path.join(wtBase, dir)).isDirectory()
      );
      for (const dir of dirs) {
        const wtPath = path.join(wtBase, dir);
        try {
          execSync(`git worktree remove "${wtPath}" --force`, { cwd: targetDir, stdio: 'pipe' });
          console.log(`  ${C.green}✓${C.reset} ${dir} worktree 제거`);
        } catch (e) {
          console.error(`  ${C.red}✗${C.reset} ${dir}: ${e.message}`);
        }
      }
    }
    if (fs.existsSync(mainTasksPath)) {
      try {
        fs.unlinkSync(mainTasksPath);
        console.log(`  ${C.green}✓${C.reset} main task 파일 제거`);
      } catch (e) {
        console.error(`  ${C.red}✗${C.reset} main task 파일 제거 실패: ${e.message}`);
      }
    }
  }

  if (fs.existsSync(wtBase)) {
    const remaining = fs.readdirSync(wtBase);
    if (remaining.length === 0) {
      fs.rmdirSync(wtBase);
    }
  }
}

function showParallelStatus(targetDir) {
  const tasksPath = path.join(targetDir, '.sleepcode', 'task_queue.md');
  const mainTasksPath = getRuntimeMainTaskQueuePath(targetDir);
  const workers = parseParallelTasks(tasksPath);

  if (!workers) {
    console.log(`${C.yellow}task_queue.md에 @worker 섹션이 없습니다.${C.reset}`);
    console.log(`${C.dim}병렬 실행을 위해 task_queue.md에 ## @worker <name> 섹션을 추가하세요.${C.reset}`);
    return;
  }

  const wtBase = getRuntimeWorktreesDir(targetDir);

  console.log(`\n${C.bold}워커 상태:${C.reset}\n`);
  for (const worker of workers) {
    const isMainWorker = worker.name === MAIN_WORKER_NAME;
    const wtPath = path.join(wtBase, worker.name);
    const exists = isMainWorker ? true : fs.existsSync(wtPath);
    const sourcePath = isMainWorker
      ? (fs.existsSync(mainTasksPath) ? mainTasksPath : '')
      : getRuntimeTaskQueuePath(wtPath);

    let done = 0;
    let total = 0;
    if (fs.existsSync(sourcePath)) {
      const progress = getPersistedTaskProgress(
        isMainWorker ? targetDir : wtPath,
        sourcePath
      );
      done = progress.counts.done;
      total = progress.counts.total;
    } else {
      total = worker.remaining;
    }

    const bar = total > 0 ? progressBar(done, total, 20) : C.dim + '(태스크 없음)' + C.reset;
    const status = isMainWorker
      ? `${C.green}현재 브랜치${C.reset}`
      : exists
        ? `${C.green}준비됨${C.reset}`
        : `${C.dim}미생성${C.reset}`;

    console.log(`  ${C.bold}${worker.name}${C.reset}  ${bar}  ${done}/${total}  ${status}`);
  }
  console.log('');
}

module.exports = {
  MAIN_WORKER_NAME,
  cleanupWorktrees,
  copySleepcodeDirToWorktree,
  createWorktrees,
  getMergeBlockingStatus,
  isRuntimeOnlyStatusLine,
  normalizeStatusPathPart,
  parseParallelTasks,
  showParallelStatus,
};
