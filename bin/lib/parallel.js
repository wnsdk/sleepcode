const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { C, SLEEPCODE_BADGE, notionLink, branchColor, PROVIDERS } = require('./constants');
const { countTasks, progressBar, visualWidth, padEndVisual, readTaskDoneSet } = require('./utils');
const { detectPython } = require('./prerequisites');
const { resolveProviderPlan, providerLabel, buildExecutionPrompt, getProviderRunCommand } = require('./provider');
const { isOverBudget, recordCost } = require('./config');
const { boxLine, renderMenuLineWithLayout, setupMenuInput } = require('./dashboard');
const { spawnWorker } = require('./worker');
const MAIN_WORKER_NAME = 'main';

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

  // 각 워커의 task_queue.md 콘텐츠 구성
  return workers.map(w => {
    const joined = w.lines.join('\n');
    const tc = countTasks(joined);
    return {
      // task_queue 자체의 [x]는 호환 목적으로 유지. 완료 집계는 워커별 task_done 로그와 함께 계산된다.
      name: w.name,
      tasks: `# 작업 목록\n\n${joined}`,
      remaining: tc.total - tc.done,
    };
  });
}

/**
 * .sleepcode/ 디렉토리를 worktree로 복사 (worktrees/, logs/ 제외)
 */
function copySleepcodeDirToWorktree(srcDir, wtPath) {
  const sleepcodeDir = path.join(srcDir, '.sleepcode');
  const wtSleepcodeDir = path.join(wtPath, '.sleepcode');

  if (!fs.existsSync(sleepcodeDir)) return;

  // 복사에서 제외할 디렉토리 (재귀 방지 + 불필요한 파일)
  const EXCLUDE_DIRS = new Set(['worktrees', 'logs']);

  function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        // 최상위 .sleepcode/ 직속 하위인 경우만 제외 체크
        if (src === sleepcodeDir && EXCLUDE_DIRS.has(entry.name)) continue;
        copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDirRecursive(sleepcodeDir, wtSleepcodeDir);
}

function createWorktrees(targetDir, workers) {
  const wtBase = path.join(targetDir, '.sleepcode', 'worktrees');
  fs.mkdirSync(wtBase, { recursive: true });
  const mainTasksPath = path.join(targetDir, '.sleepcode', 'task_queue.main.md');
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
      // .sleepcode 디렉토리가 없으면 복사
      const wtSleepcodeDir = path.join(wtPath, '.sleepcode');
      if (!fs.existsSync(wtSleepcodeDir)) {
        copySleepcodeDirToWorktree(targetDir, wtPath);
      }
      // 태스크 파일 갱신
      const wtTasksPath = path.join(wtPath, '.sleepcode', 'task_queue.md');
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
    } catch (e) {
      // 브랜치가 이미 있으면 -b 없이 재시도
      try {
        execSync(`git worktree add "${wtPath}" "${branch}"`, {
          cwd: targetDir,
          stdio: 'pipe',
        });
      } catch (e2) {
        console.error(`  ${C.red}✗${C.reset} ${worker.name}: ${e2.message}`);
        continue;
      }
    }

    // .sleepcode 디렉토리를 worktree로 복사 (scripts, rules, docs 등)
    copySleepcodeDirToWorktree(targetDir, wtPath);

    // worktree 안의 task_queue.md를 해당 워커 태스크만으로 덮어쓰기
    const wtTasksPath = path.join(wtPath, '.sleepcode', 'task_queue.md');
    fs.mkdirSync(path.dirname(wtTasksPath), { recursive: true });
    fs.writeFileSync(wtTasksPath, worker.tasks);

    console.log(`  ${C.green}✓${C.reset} ${worker.name} ${C.dim}(${branch})${C.reset} — ${worker.remaining}개 태스크`);
    created.push({ name: worker.name, path: wtPath, branch, tasksPath: wtTasksPath });
  }

  return created;
}

function cleanupWorktrees(targetDir, workers) {
  const wtBase = path.join(targetDir, '.sleepcode', 'worktrees');
  const mainTasksPath = path.join(targetDir, '.sleepcode', 'task_queue.main.md');

  if (workers) {
    // 특정 워커들만 정리
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
    // 전체 정리: .sleepcode/worktrees/ 아래 모든 디렉토리
    if (!fs.existsSync(wtBase)) {
      if (!fs.existsSync(mainTasksPath)) {
        console.log(`${C.dim}정리할 worktree가 없습니다.${C.reset}`);
        return;
      }
    }
    if (fs.existsSync(wtBase)) {
      const dirs = fs.readdirSync(wtBase).filter(d =>
        fs.statSync(path.join(wtBase, d)).isDirectory()
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

  // worktrees 디렉토리가 비었으면 삭제
  if (fs.existsSync(wtBase)) {
    const remaining = fs.readdirSync(wtBase);
    if (remaining.length === 0) {
      fs.rmdirSync(wtBase);
    }
  }
}

function showParallelStatus(targetDir) {
  const tasksPath = path.join(targetDir, '.sleepcode', 'task_queue.md');
  const mainTasksPath = path.join(targetDir, '.sleepcode', 'task_queue.main.md');
  const workers = parseParallelTasks(tasksPath);

  if (!workers) {
    console.log(`${C.yellow}task_queue.md에 @worker 섹션이 없습니다.${C.reset}`);
    console.log(`${C.dim}병렬 실행을 위해 task_queue.md에 ## @worker <name> 섹션을 추가하세요.${C.reset}`);
    return;
  }

  const wtBase = path.join(targetDir, '.sleepcode', 'worktrees');

  console.log(`\n${C.bold}워커 상태:${C.reset}\n`);
  for (const worker of workers) {
    const isMainWorker = worker.name === MAIN_WORKER_NAME;
    const wtPath = path.join(wtBase, worker.name);
    const exists = isMainWorker ? true : fs.existsSync(wtPath);
    const sourcePath = isMainWorker
      ? (fs.existsSync(mainTasksPath) ? mainTasksPath : '')
      : path.join(wtPath, '.sleepcode', 'task_queue.md');

    // worktree가 있으면 그 안의 task_queue.md에서 진행률 확인
    let done = 0;
    let total = 0;
    if (fs.existsSync(sourcePath)) {
      const wtContent = fs.readFileSync(sourcePath, 'utf-8');
      const doneState = readTaskDoneSet(isMainWorker ? targetDir : wtPath);
      const tc = countTasks(wtContent, doneState.doneSet);
        done = tc.done;
        total = tc.total;
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

/**
 * AI를 이용하여 merge conflict를 해결한다.
 * merge가 진행 중인 상태(충돌 파일이 있는 상태)에서 호출해야 한다.
 * @returns {{ resolved: boolean, provider?: string, reason?: string, error?: string, conflictFiles?: string[] }}
 */
function formatExecError(err) {
  if (!err) return 'unknown error';
  const stderr = err.stderr ? String(err.stderr).trim() : '';
  if (stderr) return stderr;
  const stdout = err.stdout ? String(err.stdout).trim() : '';
  if (stdout) return stdout;
  return err.message || 'unknown error';
}

function getConflictFiles(targetDir) {
  try {
    const output = execSync('git diff --name-only --diff-filter=U', {
      cwd: targetDir,
      stdio: 'pipe',
    }).toString().trim();
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getGitStatus(targetDir) {
  try {
    return execSync('git status --short', {
      cwd: targetDir,
      stdio: 'pipe',
    }).toString().trim();
  } catch {
    return '';
  }
}

function buildConflictResolutionPrompt(targetDir, currentBranch, branch, conflictFiles) {
  const status = getGitStatus(targetDir) || '(empty)';
  return [
    'You are resolving an in-progress git merge conflict inside a real repository.',
    `Current branch: ${currentBranch}`,
    `Incoming branch: ${branch}`,
    '',
    'Resolve every unmerged path in the working tree and stage the resolved files with git add.',
    'Use repository context, the conflicted files, and git stage blobs (:1, :2, :3) when needed.',
    'For binary or generated files, choose the correct side with git checkout --ours/--theirs, then git add.',
    'Keep the correct combination of both branches when possible.',
    'Do not modify or stage anything under .sleepcode/.',
    'Do not run git commit, git merge --abort, git reset, or delete unrelated files.',
    '',
    'Current conflicted files:',
    ...conflictFiles.map((file) => `- ${file}`),
    '',
    'Current git status:',
    status,
    '',
    'Finish only after all conflicted files are resolved and staged.',
  ].join('\n');
}

function runConflictResolverAttempt(targetDir, prompt, provider) {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  const invoke = getProviderRunCommand(provider, false, null);
  const stdinPrompt = provider === PROVIDERS.CODEX
    ? buildExecutionPrompt(targetDir, prompt, provider)
    : prompt;

  const proc = spawnSync(invoke.command, invoke.args, {
    input: stdinPrompt,
    cwd: targetDir,
    env,
    shell: true,
    timeout: 600000,
    maxBuffer: 20 * 1024 * 1024,
    encoding: 'utf-8',
  });

  if (proc.error) {
    return { ok: false, error: proc.error.message || String(proc.error) };
  }

  if (proc.status !== 0) {
    const stderr = (proc.stderr || '').trim();
    const stdout = (proc.stdout || '').trim();
    return {
      ok: false,
      error: (stderr || stdout || `${provider} exited with code ${proc.status}`).trim(),
    };
  }

  return { ok: true };
}

function hasConflictMarkers(targetDir, files) {
  const remaining = [];
  for (const file of files) {
    const absPath = path.join(targetDir, file);
    if (!fs.existsSync(absPath)) continue;
    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      if (
        content.includes('<<<<<<<')
        || content.includes('=======')
        || content.includes('>>>>>>>')
      ) {
        remaining.push(file);
      }
    } catch {
      // Binary/non-text files are ignored here. Git unmerged-path checks remain authoritative.
    }
  }
  return remaining;
}

function finalizeResolvedMerge(targetDir, conflictFiles) {
  const remainingConflicts = getConflictFiles(targetDir);
  if (remainingConflicts.length > 0) {
    return {
      ok: false,
      reason: 'unresolved_conflicts',
      conflictFiles: remainingConflicts,
    };
  }

  const filesWithMarkers = hasConflictMarkers(targetDir, conflictFiles);
  if (filesWithMarkers.length > 0) {
    return {
      ok: false,
      reason: 'conflict_markers_remaining',
      conflictFiles: filesWithMarkers,
    };
  }

  try {
    execSync('git commit --no-edit', { cwd: targetDir, stdio: 'pipe' });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: 'git_commit_failed',
      error: formatExecError(e),
    };
  }
}

function resolveConflictsWithAI(targetDir, currentBranch, branch, cliProvider) {
  const conflictFiles = getConflictFiles(targetDir);
  if (conflictFiles.length === 0) {
    return { resolved: false, reason: 'no_conflicts' };
  }

  let plan;
  try {
    plan = resolveProviderPlan(targetDir, cliProvider);
  } catch (e) {
    return {
      resolved: false,
      reason: 'provider_unavailable',
      error: e.message,
      conflictFiles,
    };
  }

  const prompt = buildConflictResolutionPrompt(targetDir, currentBranch, branch, conflictFiles);
  const providers = [plan.selected, plan.fallback].filter((provider, index, arr) =>
    provider && arr.indexOf(provider) === index
  );

  let lastFailure = null;
  for (const provider of providers) {
    const attempt = runConflictResolverAttempt(targetDir, prompt, provider);
    const completion = finalizeResolvedMerge(targetDir, conflictFiles);
    if (completion.ok) {
      return {
        resolved: true,
        provider,
      };
    }
    lastFailure = {
      resolved: false,
      provider,
      reason: completion.reason || 'ai_attempt_failed',
      error: completion.error || attempt.error,
      conflictFiles: completion.conflictFiles || conflictFiles,
    };
  }

  return lastFailure || {
    resolved: false,
    reason: 'ai_attempt_failed',
    conflictFiles,
  };
}

function attemptMergeBranch(targetDir, currentBranch, branch, cliProvider) {
  try {
    execSync(`git merge "${branch}" --no-edit`, { cwd: targetDir, stdio: 'pipe' });
    return { status: 'merged', autoResolved: false };
  } catch (e) {
    const conflictFiles = getConflictFiles(targetDir);
    if (conflictFiles.length === 0) {
      try {
        execSync('git merge --abort', { cwd: targetDir, stdio: 'pipe' });
      } catch {}
      return {
        status: 'failed',
        reason: 'merge_failed',
        error: formatExecError(e),
      };
    }

    const resolved = resolveConflictsWithAI(targetDir, currentBranch, branch, cliProvider);
    if (resolved.resolved) {
      return {
        status: 'merged',
        autoResolved: true,
        provider: resolved.provider,
      };
    }

    try {
      execSync('git merge --abort', { cwd: targetDir, stdio: 'pipe' });
    } catch {}
    return {
      status: 'conflicted',
      reason: resolved.reason,
      error: resolved.error,
      provider: resolved.provider,
      conflictFiles: resolved.conflictFiles || conflictFiles,
    };
  }
}

function mergeWorktrees(targetDir, cliProvider) {
  const tasksPath = path.join(targetDir, '.sleepcode', 'task_queue.md');
  const workers = parseParallelTasks(tasksPath);

  if (!workers) {
    console.error(`${C.red}task_queue.md에 @worker 섹션이 없습니다.${C.reset}`);
    process.exit(1);
  }

  // 현재 브랜치 확인
  let currentBranch;
  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
  } catch {
    console.error(`${C.red}git 브랜치를 확인할 수 없습니다.${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.bold}브랜치 머지${C.reset} — 대상: ${C.cyan}${currentBranch}${C.reset}\n`);

  // 머지 전 uncommitted changes 체크
  try {
    const status = execSync('git status --porcelain', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
    if (status) {
      console.error(`${C.red}커밋되지 않은 변경사항이 있습니다. 먼저 커밋하거나 stash 하세요.${C.reset}`);
      console.log(`${C.dim}${status}${C.reset}`);
      process.exit(1);
    }
  } catch {
    // 무시
  }

  const results = { merged: [], conflicted: [], skipped: [] };

  for (const worker of workers) {
    if (worker.name === MAIN_WORKER_NAME) {
      console.log(`  ${C.dim}-${C.reset} ${C.cyan}${currentBranch}${C.reset} ${C.dim}(현재 브랜치 워커, 머지 불필요)${C.reset}`);
      results.skipped.push(worker.name);
      continue;
    }
    const branch = `sleepcode/${worker.name}`;

    // 브랜치 존재 확인
    try {
      execSync(`git rev-parse --verify "${branch}"`, { cwd: targetDir, stdio: 'pipe' });
    } catch {
      console.log(`  ${C.dim}-${C.reset} ${branch} ${C.dim}(브랜치 없음, 스킵)${C.reset}`);
      results.skipped.push(worker.name);
      continue;
    }

    // 메인 브랜치와 차이 확인
    try {
      const diff = execSync(`git log "${currentBranch}..${branch}" --oneline`, { cwd: targetDir, stdio: 'pipe' }).toString().trim();
      if (!diff) {
        console.log(`  ${C.dim}-${C.reset} ${branch} ${C.dim}(변경사항 없음, 스킵)${C.reset}`);
        results.skipped.push(worker.name);
        continue;
      }
    } catch {
      // diff 실패 시 머지 시도
    }

    const mergeResult = attemptMergeBranch(targetDir, currentBranch, branch, cliProvider);
    if (mergeResult.status === 'merged') {
      if (mergeResult.autoResolved) {
        console.log(`  ${C.green}✓${C.reset} ${branch} AI 머지 완료 (${providerLabel(mergeResult.provider)} 자동 해결)`);
      } else {
        console.log(`  ${C.green}✓${C.reset} ${branch} 머지 완료`);
      }
      results.merged.push(worker.name);
      continue;
    }

    if (mergeResult.status === 'conflicted') {
      console.log(`  ${C.red}✗${C.reset} ${branch} ${C.red}AI 해결 실패${C.reset} — 수동 머지 필요`);
      results.conflicted.push(worker.name);
      continue;
    }

    console.log(`  ${C.red}✗${C.reset} ${branch} 머지 실패`);
    if (mergeResult.error) {
      console.log(`  ${C.dim}${mergeResult.error}${C.reset}`);
    }
    results.conflicted.push(worker.name);
  }

  // 결과 요약
  console.log(`\n${C.bold}머지 결과:${C.reset}`);
  if (results.merged.length > 0) {
    console.log(`  ${C.green}성공: ${results.merged.length}${C.reset} (${results.merged.join(', ')})`);
  }
  if (results.conflicted.length > 0) {
    console.log(`  ${C.red}충돌: ${results.conflicted.length}${C.reset} (${results.conflicted.join(', ')}) ${C.dim}(AI 자동 해결 실패)${C.reset}`);
    console.log(`\n${C.yellow}충돌 브랜치를 수동으로 머지하세요:${C.reset}`);
    for (const name of results.conflicted) {
      console.log(`  ${C.cyan}git merge sleepcode/${name}${C.reset}  ${C.dim}# 충돌 해결 후 git commit${C.reset}`);
    }
    console.log(`\n${C.yellow}⚠ 충돌이 남아있으므로 워크트리를 정리하지 마세요.${C.reset}`);
    console.log(`  ${C.dim}수동 머지 완료 후 'npx sleepcode parallel --clean'으로 정리하세요.${C.reset}`);
  }
  if (results.skipped.length > 0) {
    console.log(`  ${C.dim}스킵: ${results.skipped.length} (${results.skipped.join(', ')})${C.reset}`);
  }

  if (results.conflicted.length === 0 && results.merged.length > 0) {
    console.log(`\n${C.green}${C.bold}모든 브랜치 머지 완료!${C.reset}`);
    console.log(`  ${C.cyan}npx sleepcode parallel --clean${C.reset}  ${C.dim}# worktree 정리${C.reset}\n`);
  }
}

function autoMergeWorktrees(targetDir, workerStates, cliProvider) {
  let currentBranch;
  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
  } catch {
    throw new Error('git 브랜치를 확인할 수 없습니다.');
  }

  // 머지 전 uncommitted changes 체크
  try {
    const status = execSync('git status --porcelain', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
    if (status) {
      throw new Error('커밋되지 않은 변경사항이 있습니다.');
    }
  } catch (e) {
    if (e.message.includes('커밋되지 않은')) throw e;
  }

  const results = { merged: [], conflicted: [], skipped: [] };

  for (const ws of workerStates) {
    const branch = ws.branch || `sleepcode/${ws.name}`;
    if (ws.name === MAIN_WORKER_NAME || branch === currentBranch) {
      results.skipped.push(ws.name);
      continue;
    }

    try {
      execSync(`git rev-parse --verify "${branch}"`, { cwd: targetDir, stdio: 'pipe' });
    } catch {
      results.skipped.push(ws.name);
      continue;
    }

    try {
      const diff = execSync(`git log "${currentBranch}..${branch}" --oneline`, { cwd: targetDir, stdio: 'pipe' }).toString().trim();
      if (!diff) {
        results.skipped.push(ws.name);
        continue;
      }
    } catch {
      // diff 실패 시 머지 시도
    }

    const mergeResult = attemptMergeBranch(targetDir, currentBranch, branch, cliProvider);
    if (mergeResult.status === 'merged') {
      results.merged.push(ws.name);
    } else if (mergeResult.status === 'conflicted') {
      results.conflicted.push(ws.name);
    } else {
      results.conflicted.push(ws.name);
    }
  }

  return results;
}

function runParallel(subArgs, cliProvider) {
  const targetDir = process.cwd();
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode'로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  // 서브 옵션 파싱
  const isSetup = subArgs.includes('--setup');
  const isClean = subArgs.includes('--clean');
  const isStatus = subArgs.includes('--status');
  const isMerge = subArgs.includes('--merge');

  if (isStatus) {
    showParallelStatus(targetDir);
    return;
  }

  if (isMerge) {
    mergeWorktrees(targetDir, cliProvider);
    return;
  }

  if (isClean) {
    console.log(`\n${C.bold}Worktree 정리 중...${C.reset}\n`);
    cleanupWorktrees(targetDir, null);
    console.log(`\n${C.green}정리 완료.${C.reset}`);
    return;
  }

  // --setup 또는 기본 동작: worktree 생성
  const tasksPath = path.join(scDir, 'task_queue.md');
  const workers = parseParallelTasks(tasksPath);

  if (!workers) {
    console.error(`${C.red}task_queue.md에 @worker 섹션이 없습니다.${C.reset}`);
    console.log(`
${C.bold}task_queue.md 병렬 포맷 예시:${C.reset}

  ${C.dim}# 작업 목록${C.reset}
  ${C.cyan}## @worker feature-auth${C.reset}
  ${C.dim}- [ ] 로그인 화면 구현${C.reset}
  ${C.dim}- [ ] 회원가입 API 연동${C.reset}

  ${C.cyan}## @worker feature-cart${C.reset}
  ${C.dim}- [ ] 장바구니 화면 구현${C.reset}
  ${C.dim}- [ ] 상품 추가/삭제 API${C.reset}
`);
    process.exit(1);
  }

  console.log(`\n${C.bold}병렬 워커 설정${C.reset} — ${workers.length}개 워커 감지\n`);

  const created = createWorktrees(targetDir, workers);

  if (created.length === 0) {
    console.error(`\n${C.red}생성된 worktree가 없습니다.${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.green}${C.bold}Worktree 생성 완료!${C.reset}`);

  if (isSetup) {
    console.log(`
${C.bold}다음 단계:${C.reset}

  ${C.cyan}npx sleepcode parallel --status${C.reset}  ${C.dim}# 워커 상태 확인${C.reset}
  ${C.cyan}npx sleepcode parallel${C.reset}           ${C.dim}# 병렬 실행${C.reset}
  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}
`);
    return;
  }

  // 병렬 실행
  runParallelWorkers(targetDir, created, cliProvider);
}

function runParallelWorkers(targetDir, workerInfos, cliProvider) {
  const logDir = path.join(targetDir, '.sleepcode', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const py = detectPython();
  if (!py) {
    console.error(`${C.red}python3이 필요합니다.${C.reset}`);
    process.exit(1);
  }

  // 실행 전 예산 체크
  const budgetCheck = isOverBudget(targetDir);
  if (budgetCheck && budgetCheck.over) {
    console.log(`\n${C.red}주간 한도에 도달했습니다.${C.reset}`);
    console.log(`  사용: $${budgetCheck.total.toFixed(2)} / 한도: $${budgetCheck.limit.toFixed(2)} (${budgetCheck.threshold}% of $${budgetCheck.budget.toFixed(2)})`);
    console.log(`${C.dim}다음 주 월요일에 초기화됩니다.${C.reset}`);
    process.exit(0);
  }

  console.log(`\n${C.bold}병렬 실행 시작${C.reset} — ${workerInfos.length}개 워커\n`);

  // provider 가용성만 검증 (실제 선택은 워커가 태스크마다 ratio에 따라 수행)
  try {
    resolveProviderPlan(targetDir, cliProvider);
  } catch (e) {
    console.error(`${C.red}${e.message}${C.reset}`);
    process.exit(1);
  }

  const workerStates = workerInfos.map(w => ({
    ...w,
    targetDir,
    status: 'running',
    currentTask: '',
    done: 0,
    total: 0,
    cost: 0,
    provider: null,
    fallbackProvider: null,
    _proc: null,
    logFile: path.join(logDir, `parallel_${w.name}_${timestamp}.log`),
  }));

  // 초기 태스크 수 계산
  for (const ws of workerStates) {
    const tasksPath = ws.tasksPath || path.join(ws.path, '.sleepcode', 'task_queue.md');
    if (fs.existsSync(tasksPath)) {
      const content = fs.readFileSync(tasksPath, 'utf-8');
      const doneState = readTaskDoneSet(ws.path, ws.doneFilePath);
      const tc = countTasks(content, doneState.doneSet);
      ws.total = tc.total;
      ws.done = tc.done;
    }
  }

  // 로그 버퍼 (리사이즈 시 재렌더링용)
  const MAX_LOG_BUFFER = 200;
  const logBuffer = [];
  let altScreenActive = false;
  let cursorHidden = false;
  let logScroll = 0;

  function getLogRows(dashboardHeight) {
    const rows = process.stdout.rows || 24;
    return Math.max(0, rows - dashboardHeight);
  }

  function getMaxLogScroll(dashboardHeight) {
    const logRows = getLogRows(dashboardHeight);
    return Math.max(0, logBuffer.length - logRows);
  }

  function appendLogToScreen(line) {
    if (!altScreenActive) return;
    if (logScroll > 0) return;
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[${rows};1H`);
    process.stdout.write(`\n  ${line}\x1b[K`);
  }

  function renderLogs(dashboardHeight, force = false) {
    if (!altScreenActive) return;
    const logRows = getLogRows(dashboardHeight);
    if (logRows <= 0) return;

    const maxScroll = getMaxLogScroll(dashboardHeight);
    if (logScroll > maxScroll) logScroll = maxScroll;
    if (!force && logScroll === 0) return;

    const start = Math.max(0, logBuffer.length - logRows - logScroll);
    const slice = logBuffer.slice(start, start + logRows);
    for (let i = 0; i < logRows; i++) {
      const line = slice[i] || '';
      process.stdout.write(`\x1b[${dashboardHeight + 1 + i};1H`);
      process.stdout.write(`  ${line}\x1b[K`);
    }
    process.stdout.write('\x1b[1;1H');
  }

  function pushLog(workerName, msg) {
    const color = branchColor(workerName);
    const tag = `${color}[${workerName}]${C.reset}`;
    const fullMsg = `${tag} ${msg}`;
    logBuffer.push(fullMsg);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
    if (logScroll > 0) {
      logScroll = Math.min(logScroll + 1, getMaxLogScroll(dashboardHeight));
    }
    appendLogToScreen(fullMsg);
  }

  // 대시보드 렌더링
  const startTime = Date.now();
  let renderPending = false;
  let renderTimer = null;
  const menuState = { menuIndex: 0 };
  let gracefulShutdown = false;

  function renderDashboard() {
    if (!altScreenActive) return;

    const lines = [];
    const W = 62; // 박스 내부 너비
    const totalTasks = workerStates.reduce((s, w) => s + w.total, 0);
    const totalDone = workerStates.reduce((s, w) => s + w.done, 0);
    const activeCount = workerStates.filter(w => w.status === 'running').length;
    const totalCost = workerStates.reduce((s, w) => s + w.cost, 0);

    lines.push(`${C.dim}╔${'═'.repeat(W + 2)}╗${C.reset}`);
    lines.push(boxLine(`${SLEEPCODE_BADGE} parallel  ${C.dim}${activeCount}/${workerStates.length} workers${C.reset}${notionLink(process.env.NOTION_DB_ID)}`, W));
    lines.push(`${C.dim}╠${'═'.repeat(W + 2)}╣${C.reset}`);

    for (const ws of workerStates) {
      const bar = progressBar(ws.done, ws.total, 15);
      const statusIcon = ws.status === 'running' ? `${C.cyan}⟳${C.reset}`
        : ws.status === 'done' ? `${C.green}✓${C.reset}`
        : ws.status === 'budget_stop' ? `${C.yellow}■${C.reset}`
        : `${C.red}✗${C.reset}`;
      const wPct = ws.total > 0 ? Math.round(ws.done / ws.total * 100) : 0;
      const diffTag = ws.difficultyLabel ? ` ${C.yellow}${ws.difficulty}${C.reset}` : '';
      lines.push(boxLine(`${statusIcon} ${C.bold}${padEndVisual(ws.name, 18)}${C.reset} ${bar} ${String(ws.done).padStart(2)}/${String(ws.total).padEnd(2)} ${C.cyan}${String(wPct).padStart(3)}%${C.reset}${diffTag}`, W));
      if (ws.currentTask && ws.status === 'running') {
        const maxTaskW = W - 6;
        let task = ws.currentTask;
        if (visualWidth(task) > maxTaskW) {
          let tw = 0;
          let cut = 0;
          for (const ch of task) {
            const cw = visualWidth(ch);
            if (tw + cw > maxTaskW - 3) break;
            tw += cw;
            cut += ch.length;
          }
          task = task.slice(0, cut) + '...';
        }
        lines.push(boxLine(`  ${C.dim}> ${task}${C.reset}`, W));
      } else {
        lines.push(boxLine('', W));
      }
    }

    lines.push(`${C.dim}╠${'═'.repeat(W + 2)}╣${C.reset}`);
    const costStr = `$${totalCost.toFixed(4)}`;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = elapsed >= 3600
      ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
      : elapsed >= 60
        ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
        : `${elapsed}s`;
    const totalPct = totalTasks > 0 ? Math.round(totalDone / totalTasks * 100) : 0;
    lines.push(boxLine(`${C.dim}비용${C.reset} ${C.yellow}${costStr}${C.reset}  ${C.dim}·  경과${C.reset} ${C.cyan}${elapsedStr}${C.reset}  ${C.dim}·  진행${C.reset} ${totalDone}/${totalTasks} ${C.cyan}${totalPct}%${C.reset}`, W));
    const budgetInfo = isOverBudget(targetDir);
    if (budgetInfo) {
      const pct = Math.min(100, (budgetInfo.total / budgetInfo.budget * 100)).toFixed(0);
      const budgetBar = progressBar(Math.min(budgetInfo.total, budgetInfo.budget), budgetInfo.budget, 10);
      const warn = budgetInfo.over ? ` ${C.red}한도 도달!${C.reset}` : '';
      lines.push(boxLine(`${C.dim}주간${C.reset} ${C.yellow}$${budgetInfo.total.toFixed(2)}${C.reset}/${C.dim}$${budgetInfo.budget}${C.reset} (${pct}%) ${budgetBar}${warn}`, W));
    } else {
      lines.push(boxLine('', W));
    }

    // 테이블 닫기
    lines.push(`${C.dim}╚${'═'.repeat(W + 2)}╝${C.reset}`);

    // 메뉴 (테이블 밖)
    if (gracefulShutdown) {
      lines.push(`  ${C.yellow}⏳ 마무리 중... 현재 작업 완료 후 종료됩니다${C.reset}`);
      menuState._menuLayout = null;
    } else {
      const menuRender = renderMenuLineWithLayout(menuState.menuIndex, W, menuState.confirmPending, menuState._menuItems);
      lines.push(menuRender.line);
      menuState._menuLayout = { row: lines.length, items: menuRender.items };
    }
    lines.push(`${C.dim} ══ ${C.reset}${C.cyan}logs${C.reset}${C.dim} ${'═'.repeat(W - 6)}${C.reset}`);

    // Alternate Screen: 절대 좌표로 대시보드 렌더링
    for (let i = 0; i < lines.length; i++) {
      process.stdout.write(`\x1b[${i + 1};1H${lines[i]}\x1b[K`);
    }
    // 커서를 한 곳에 고정 (숨김 미지원 터미널 대비)
    process.stdout.write('\x1b[1;1H');
    if (logScroll > 0) renderLogs(dashboardHeight);
  }

  /** 이벤트 기반 렌더 요청을 200ms 디바운스로 처리 (깜빡임 방지) */
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    renderTimer = setTimeout(() => {
      renderPending = false;
      renderTimer = null;
      renderDashboard();
    }, 200);
  }

  function flushRender() {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    renderPending = false;
    renderDashboard();
    renderLogs(dashboardHeight, true);
  }

  // Alternate Screen 초기화
  const dashboardHeight = 11 + workerStates.length * 2;
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1049h');
    process.stdout.write('\x1b[H');
    process.stdout.write('\x1b[2J');
    process.stdout.write('\x1b[?25l');
    cursorHidden = true;
    const rows = process.stdout.rows || 24;
    if (rows > dashboardHeight) {
      process.stdout.write(`\x1b[${dashboardHeight + 1};${rows}r`);
    }
    altScreenActive = true;
  }

  function cleanupAltScreen() {
    if (!altScreenActive) return;
    altScreenActive = false;
    process.stdout.write('\x1b[r');
    process.stdout.write('\x1b[?1049l');
    if (cursorHidden) {
      process.stdout.write('\x1b[?25h');
      cursorHidden = false;
    }
  }

  process.stdout.on('resize', () => {
    if (!altScreenActive) return;
    const rows = process.stdout.rows || 24;
    if (rows > dashboardHeight) {
      process.stdout.write(`\x1b[${dashboardHeight + 1};${rows}r`);
    }
    process.stdout.write('\x1b[2J');
    renderDashboard();
    renderLogs(dashboardHeight, true);
  });

  const sigintHandler = () => {
    if (cleanupMenuInput) cleanupMenuInput();
    for (const ws of workerStates) {
      if (ws._proc) try { ws._proc.kill(); } catch {}
    }
    cleanupAltScreen();
    console.log(`\n${C.yellow}중단됨${C.reset}`);
    process.exit(1);
  };
  process.on('SIGINT', sigintHandler);
  process.on('exit', cleanupAltScreen);

  // 메뉴 키 입력 핸들러
  const gracefulExit = () => {
    if (gracefulShutdown) return;
    gracefulShutdown = true;
    pushLog('SYSTEM', `${C.yellow}마무리 후 종료 요청 — 현재 작업 완료 후 종료됩니다${C.reset}`);
    for (const ws of workerStates) {
      if (ws.status === 'running' && ws._proc) {
        try { ws._proc.kill('SIGINT'); } catch {}
      }
    }
    renderDashboard();
  };

  const immediateExit = () => {
    if (cleanupMenuInput) cleanupMenuInput();
    for (const ws of workerStates) {
      if (ws._proc) try { ws._proc.kill(); } catch {}
    }
    cleanupAltScreen();
    console.log(`\n${C.yellow}즉시 종료됨${C.reset}`);
    process.exit(0);
  };

  let cleanupMenuInput;
  cleanupMenuInput = setupMenuInput(
    menuState,
    renderDashboard,
    [
      { label: '마무리 후 종료', handler: gracefulExit },
      { label: '즉시 종료', handler: immediateExit },
    ],
    immediateExit,
    (action) => {
      const logRows = getLogRows(dashboardHeight);
      if (logRows <= 0) return false;
      const maxScroll = getMaxLogScroll(dashboardHeight);
      let next = logScroll;
      const page = Math.max(1, logRows - 1);
      switch (action) {
        case 'lineUp':
          next = Math.min(maxScroll, logScroll + 1);
          break;
        case 'lineDown':
          next = Math.max(0, logScroll - 1);
          break;
        case 'pageUp':
          next = Math.min(maxScroll, logScroll + page);
          break;
        case 'pageDown':
          next = Math.max(0, logScroll - page);
          break;
        case 'top':
          next = maxScroll;
          break;
        case 'bottom':
          next = 0;
          break;
        case 'wheelUp':
          next = Math.min(maxScroll, logScroll + 3);
          break;
        case 'wheelDown':
          next = Math.max(0, logScroll - 3);
          break;
        default:
          return false;
      }
      if (next === logScroll) return true;
      logScroll = next;
      renderLogs(dashboardHeight, true);
      return true;
    }
  );

  renderDashboard();
  renderLogs(dashboardHeight, true);

  // 대시보드 갱신 타이머
  const dashboardInterval = setInterval(renderDashboard, 3000);

  // 5초마다 task_queue.md를 읽어 진행률 갱신
  const taskProgressInterval = setInterval(() => {
    for (const ws of workerStates) {
      if (ws.status !== 'running') continue;
      const tp = ws.tasksPath || path.join(ws.path, '.sleepcode', 'task_queue.md');
      try {
        if (fs.existsSync(tp)) {
          const content = fs.readFileSync(tp, 'utf-8');
          const doneState = readTaskDoneSet(ws.path, ws.doneFilePath);
          const tc = countTasks(content, doneState.doneSet);
          ws.done = tc.done;
          ws.total = tc.total;
        }
      } catch {}
    }
    scheduleRender();
  }, 5000);

  // 예산 체크 타이머 (30초마다)
  let budgetStopped = false;
  const budgetCheckInterval = setInterval(() => {
    if (budgetStopped) return;
    const result = isOverBudget(targetDir);
    if (result && result.over) {
      budgetStopped = true;
      pushLog('SYSTEM', `${C.yellow}주간 한도 ${result.threshold}% 도달 ($${result.total.toFixed(2)}) — 워커 중지${C.reset}`);
      for (const ws of workerStates) {
        if (ws.status === 'running' && ws._proc) {
          ws.status = 'budget_stop';
          ws.currentTask = '한도 도달 — 중지됨';
          try { ws._proc.kill(); } catch {}
        }
      }
      renderDashboard();
    }
  }, 30000);

  // 각 워커 프로세스 생성
  let activeWorkers = workerStates.length;

  function onWorkerDone(completedWs) {
    activeWorkers--;
    renderDashboard();

    // 워커가 모든 태스크를 완료했으면 즉시 main 브랜치에 병합
    if (completedWs && completedWs.status === 'done') {
      pushLog('SYSTEM', `${C.green}${completedWs.name} 완료 — main 브랜치에 즉시 병합 중...${C.reset}`);
      try {
        const mergeResults = autoMergeWorktrees(targetDir, [completedWs], cliProvider);
        if (mergeResults.merged.length > 0) {
          pushLog('SYSTEM', `${C.green}✓ ${completedWs.name} — main 브랜치 병합 완료${C.reset}`);
          completedWs.merged = true;
        } else if (mergeResults.skipped.length > 0) {
          pushLog('SYSTEM', `${C.dim}${completedWs.name} — 병합 스킵 (변경 없음)${C.reset}`);
          completedWs.merged = true;
        } else if (mergeResults.conflicted.length > 0) {
          pushLog('SYSTEM', `${C.red}✗ ${completedWs.name} — 병합 충돌 (수동 처리 필요)${C.reset}`);
        }
      } catch (e) {
        pushLog('SYSTEM', `${C.red}✗ ${completedWs.name} — 병합 오류: ${e.message}${C.reset}`);
      }
      scheduleRender();
    }

    if (activeWorkers === 0) {
      clearInterval(dashboardInterval);
      clearInterval(budgetCheckInterval);
      clearInterval(taskProgressInterval);
      renderDashboard();
      if (cleanupMenuInput) cleanupMenuInput();
      process.removeListener('SIGINT', sigintHandler);
      cleanupAltScreen();
      onAllDone();
    }
  }

  function onAllDone() {
    const failed = workerStates.filter(w => w.status === 'failed');
    const done = workerStates.filter(w => w.status === 'done');
    const stopped = workerStates.filter(w => w.status === 'budget_stop');
    const alreadyMerged = workerStates.filter(w => w.merged);
    const needsMerge = done.filter(w => !w.merged);

    console.log(`\n${C.bold}병렬 실행 완료${C.reset}`);
    const parts = [`${C.green}성공: ${done.length}${C.reset}`];
    if (failed.length > 0) parts.push(`${C.red}실패: ${failed.length}${C.reset}`);
    if (stopped.length > 0) parts.push(`${C.yellow}예산 중지: ${stopped.length}${C.reset}`);
    console.log(`  ${parts.join('  ')}`);

    // 브랜치 목록 출력
    console.log(`\n${C.bold}생성된 브랜치:${C.reset}`);
    for (const ws of workerStates) {
      const mergedTag = ws.merged ? ` ${C.dim}(병합됨)${C.reset}` : '';
      const icon = ws.status === 'done' ? `${C.green}✓${C.reset}`
        : ws.status === 'budget_stop' ? `${C.yellow}■${C.reset}`
        : `${C.red}✗${C.reset}`;
      console.log(`  ${icon} ${ws.branch}${mergedTag}`);
    }

    if (alreadyMerged.length > 0) {
      console.log(`\n${C.green}✓ 자동 병합 완료: ${alreadyMerged.map(w => w.name).join(', ')}${C.reset}`);
    }

    if (needsMerge.length > 0) {
      console.log(`\n${C.bold}다음 단계:${C.reset}\n`);
      console.log(`  ${C.cyan}npx sleepcode parallel --merge${C.reset}   ${C.dim}# 남은 브랜치 병합${C.reset}`);
      console.log(`  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}`);
    } else if (done.length > 0) {
      console.log(`\n${C.bold}다음 단계:${C.reset}\n`);
      console.log(`  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}`);
    } else {
      console.log(`\n${C.bold}다음 단계:${C.reset}\n`);
      console.log(`  ${C.cyan}npx sleepcode parallel --merge${C.reset}   ${C.dim}# 브랜치 자동 머지${C.reset}`);
      console.log(`  ${C.cyan}npx sleepcode parallel --clean${C.reset}   ${C.dim}# worktree 정리${C.reset}`);
    }
    console.log('');
  }

  function handleTaskUiUpdated() {
    flushRender();
  }

  for (const ws of workerStates) {
    spawnWorker(ws, py, () => onWorkerDone(ws), scheduleRender, pushLog, cliProvider, null, null, handleTaskUiUpdated);
  }
}

module.exports = {
  parseParallelTasks,
  copySleepcodeDirToWorktree,
  createWorktrees,
  cleanupWorktrees,
  showParallelStatus,
  mergeWorktrees,
  autoMergeWorktrees,
  runParallel,
  runParallelWorkers,
};
