const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const { C, PROVIDERS } = require('./constants');
const { resolveProviderPlan, providerLabel, buildExecutionPrompt, getProviderRunCommand } = require('./provider');
const {
  planParallelMerges,
  runParallelMergePlan,
} = require('./parallelMergePlan');
const {
  getMergeBlockingStatus,
  parseParallelTasks,
} = require('./parallelWorktrees');

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
    } catch {}
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

  let currentBranch;
  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: targetDir, stdio: 'pipe' }).toString().trim();
  } catch {
    console.error(`${C.red}git 브랜치를 확인할 수 없습니다.${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.bold}브랜치 머지${C.reset} — 대상: ${C.cyan}${currentBranch}${C.reset}\n`);

  try {
    const status = getMergeBlockingStatus(targetDir);
    if (status) {
      console.error(`${C.red}커밋되지 않은 변경사항이 있습니다. 먼저 커밋하거나 stash 하세요.${C.reset}`);
      console.log(`${C.dim}${status}${C.reset}`);
      process.exit(1);
    }
  } catch {}

  const results = { merged: [], conflicted: [], skipped: [] };
  const mergePlan = planParallelMerges({
    targetDir,
    currentBranch,
    workers,
  });
  const outcomes = runParallelMergePlan({
    targetDir,
    currentBranch,
    mergePlan,
    cliProvider,
    attemptMergeBranchFn: attemptMergeBranch,
  });

  for (const outcome of outcomes) {
    if (outcome.status === 'skipped') {
      if (outcome.reason === 'current_branch') {
        console.log(`  ${C.dim}-${C.reset} ${C.cyan}${currentBranch}${C.reset} ${C.dim}(현재 브랜치 워커, 머지 불필요)${C.reset}`);
      } else if (outcome.reason === 'missing_branch') {
        console.log(`  ${C.dim}-${C.reset} ${outcome.branch} ${C.dim}(브랜치 없음, 스킵)${C.reset}`);
      } else if (outcome.reason === 'no_changes') {
        console.log(`  ${C.dim}-${C.reset} ${outcome.branch} ${C.dim}(변경사항 없음, 스킵)${C.reset}`);
      }
      results.skipped.push(outcome.name);
      continue;
    }

    if (outcome.status === 'merged') {
      if (outcome.autoResolved) {
        console.log(`  ${C.green}✓${C.reset} ${outcome.branch} AI 머지 완료 (${providerLabel(outcome.provider)} 자동 해결)`);
      } else {
        console.log(`  ${C.green}✓${C.reset} ${outcome.branch} 머지 완료`);
      }
      results.merged.push(outcome.name);
      continue;
    }

    if (outcome.status === 'conflicted') {
      console.log(`  ${C.red}✗${C.reset} ${outcome.branch} ${C.red}AI 해결 실패${C.reset} — 수동 머지 필요`);
      results.conflicted.push(outcome.name);
      continue;
    }

    console.log(`  ${C.red}✗${C.reset} ${outcome.branch} 머지 실패`);
    if (outcome.error) {
      console.log(`  ${C.dim}${outcome.error}${C.reset}`);
    }
    results.conflicted.push(outcome.name);
  }

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

  try {
    const status = getMergeBlockingStatus(targetDir);
    if (status) {
      throw new Error('커밋되지 않은 변경사항이 있습니다.');
    }
  } catch (e) {
    if (e.message.includes('커밋되지 않은')) throw e;
  }

  const results = { merged: [], conflicted: [], skipped: [] };
  const mergePlan = planParallelMerges({
    targetDir,
    currentBranch,
    workers: workerStates,
  });
  const outcomes = runParallelMergePlan({
    targetDir,
    currentBranch,
    mergePlan,
    cliProvider,
    attemptMergeBranchFn: attemptMergeBranch,
  });

  for (const outcome of outcomes) {
    if (outcome.status === 'skipped') {
      results.skipped.push(outcome.name);
    } else if (outcome.status === 'merged') {
      results.merged.push(outcome.name);
    } else {
      results.conflicted.push(outcome.name);
    }
  }

  return results;
}

module.exports = {
  attemptMergeBranch,
  autoMergeWorktrees,
  buildConflictResolutionPrompt,
  finalizeResolvedMerge,
  formatExecError,
  getConflictFiles,
  getGitStatus,
  hasConflictMarkers,
  mergeWorktrees,
  resolveConflictsWithAI,
};
