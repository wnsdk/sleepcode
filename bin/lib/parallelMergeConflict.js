const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { PROVIDERS } = require('./constants');
const { resolveProviderPlan, buildExecutionPrompt, getProviderRunCommand } = require('./provider');
const { formatExecError } = require('./workerGitOps');

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

module.exports = {
  buildConflictResolutionPrompt,
  finalizeResolvedMerge,
  getConflictFiles,
  getGitStatus,
  hasConflictMarkers,
  resolveConflictsWithAI,
  runConflictResolverAttempt,
};
