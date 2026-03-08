const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { C } = require('./constants');
const { MAIN_WORKER_NAME, parseParallelTasks, parseTaskQueueWorkers } = require('./parallelTasks');
const { showParallelStatus } = require('./parallelStatus');
const {
  ensureRuntimeDirs,
  getRuntimeMainTaskQueuePath,
  getRuntimeTaskQueuePath,
  getRuntimeWorktreesDir,
} = require('./runtimePaths');
const {
  copySleepcodeDirToWorktree,
  getMergeBlockingStatus,
  isRuntimeOnlyStatusLine,
  normalizeStatusPathPart,
} = require('./parallelWorktreeFiles');

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
        console.log(`  ${C.yellow}!${C.reset} legacy worktree '${MAIN_WORKER_NAME}' 감지 — ${C.cyan}npx sleepcode run --clean${C.reset} 권장`);
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

module.exports = {
  MAIN_WORKER_NAME,
  cleanupWorktrees,
  copySleepcodeDirToWorktree,
  createWorktrees,
  getMergeBlockingStatus,
  isRuntimeOnlyStatusLine,
  normalizeStatusPathPart,
  parseParallelTasks,
  parseTaskQueueWorkers,
  showParallelStatus,
};
