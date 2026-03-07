const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getTaskDoneFilePath, appendTaskDone } = require('./utils');
const { formatExecError, gitOutput, getHeadCommit } = require('./workerGitOps');
const { buildTaskCommitMessage, inferCommitPrefix, normalizeCommitSubject } = require('./workerCommitMessage');

// --- Staging ---

function stageTaskChanges(targetDir) {
  try {
    execFileSync('git', ['add', '-u', '--', '.'], {
      cwd: targetDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return { ok: false, reason: 'git_add_failed', error: formatExecError(e) };
  }

  let untrackedFiles = [];
  try {
    untrackedFiles = gitOutput(targetDir, ['ls-files', '--others', '--exclude-standard', '--']).split(/\r?\n/).filter(Boolean);
  } catch (e) {
    return { ok: false, reason: 'git_ls_untracked_failed', error: formatExecError(e) };
  }

  const addableUntracked = untrackedFiles.filter((filePath) => {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    return normalized !== '.sleepcode' && !normalized.startsWith('.sleepcode/');
  });

  if (addableUntracked.length > 0) {
    try {
      execFileSync('git', ['add', '--', ...addableUntracked], {
        cwd: targetDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      return { ok: false, reason: 'git_add_untracked_failed', error: formatExecError(e) };
    }
  }

  let stagedFiles = [];
  try {
    stagedFiles = gitOutput(targetDir, ['diff', '--cached', '--name-only', '--']).split(/\r?\n/).filter(Boolean);
  } catch (e) {
    return { ok: false, reason: 'git_diff_cached_failed', error: formatExecError(e) };
  }

  if (stagedFiles.length === 0) {
    return { ok: false, reason: 'no_changes' };
  }

  return { ok: true, stagedFiles };
}

function toGitPath(targetDir, filePath) {
  return path.relative(targetDir, filePath).replace(/\\/g, '/');
}

function stageFile(targetDir, filePath) {
  const gitPath = toGitPath(targetDir, filePath);
  execFileSync('git', ['add', '--', gitPath], {
    cwd: targetDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// --- Task done transaction ---

function captureTaskDoneSnapshot(doneFilePath) {
  const exists = fs.existsSync(doneFilePath);
  return {
    exists,
    content: exists ? fs.readFileSync(doneFilePath, 'utf-8') : '',
  };
}

function restoreTaskDoneSnapshot(targetDir, doneFilePath, snapshot) {
  const gitPath = toGitPath(targetDir, doneFilePath);

  if (snapshot.exists) {
    fs.mkdirSync(path.dirname(doneFilePath), { recursive: true });
    fs.writeFileSync(doneFilePath, snapshot.content);
    stageFile(targetDir, doneFilePath);
    return;
  }

  if (fs.existsSync(doneFilePath)) {
    fs.unlinkSync(doneFilePath);
  }

  try {
    execFileSync('git', ['restore', '--staged', '--', gitPath], {
      cwd: targetDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {}
}

function prepareTaskDoneAppend(targetDir, taskEntry, doneFilePath, dedupeSet = null) {
  const resolvedDoneFilePath = doneFilePath || getTaskDoneFilePath(targetDir);
  const snapshot = captureTaskDoneSnapshot(resolvedDoneFilePath);

  let appended = false;
  try {
    appended = appendTaskDone(targetDir, taskEntry, resolvedDoneFilePath, dedupeSet);
  } catch (e) {
    return {
      ok: false,
      reason: 'task_done_append_failed',
      error: e.message,
    };
  }

  if (!appended) {
    return {
      ok: false,
      reason: 'task_done_append_skipped',
    };
  }

  try {
    stageFile(targetDir, resolvedDoneFilePath);
  } catch (e) {
    try {
      restoreTaskDoneSnapshot(targetDir, resolvedDoneFilePath, snapshot);
    } catch {}
    return {
      ok: false,
      reason: 'task_done_stage_failed',
      error: formatExecError(e),
    };
  }

  return {
    ok: true,
    doneFilePath: resolvedDoneFilePath,
    snapshot,
  };
}

function rollbackPreparedTaskDone(targetDir, prepared) {
  if (!prepared || !prepared.ok) return null;
  try {
    restoreTaskDoneSnapshot(targetDir, prepared.doneFilePath, prepared.snapshot);
    return null;
  } catch (e) {
    return e.message || String(e);
  }
}

// --- Commit orchestration ---

function commitTaskNow(targetDir, taskEntry, startHead, options = null) {
  if (!taskEntry || !taskEntry.title) {
    return { committed: false, reason: 'empty_task' };
  }

  if (!startHead) {
    return { committed: false, reason: 'missing_start_head' };
  }

  let currentHead = '';
  try {
    currentHead = getHeadCommit(targetDir);
  } catch (e) {
    return {
      committed: false,
      reason: 'git_head_failed',
      error: formatExecError(e),
    };
  }

  if (currentHead !== startHead) {
    return {
      committed: false,
      reason: 'manual_commit_detected',
      startHead,
      endHead: currentHead,
    };
  }

  const taskDoneTxn = options
    ? prepareTaskDoneAppend(targetDir, taskEntry, options.doneFilePath, options.dedupeSet)
    : null;

  if (taskDoneTxn && !taskDoneTxn.ok) {
    return {
      committed: false,
      reason: taskDoneTxn.reason,
      error: taskDoneTxn.error,
    };
  }

  const failWithRollback = (result) => {
    const rollbackError = rollbackPreparedTaskDone(targetDir, taskDoneTxn);
    if (!rollbackError) return result;
    return { ...result, rollbackError };
  };

  const stageResult = stageTaskChanges(targetDir);
  if (!stageResult.ok) {
    return failWithRollback({
      committed: false,
      reason: stageResult.reason,
      error: stageResult.error,
    });
  }

  const msg = buildTaskCommitMessage(taskEntry, stageResult.stagedFiles);
  try {
    execFileSync('git', ['commit', '-m', msg], {
      cwd: targetDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return failWithRollback({
      committed: false,
      reason: 'git_commit_failed',
      error: formatExecError(e),
      stagedFiles: stageResult.stagedFiles,
    });
  }

  let endHead = '';
  try {
    endHead = getHeadCommit(targetDir);
  } catch (e) {
    return {
      committed: false,
      reason: 'git_head_failed',
      error: formatExecError(e),
      stagedFiles: stageResult.stagedFiles,
    };
  }

  if (!endHead || endHead === startHead) {
    return {
      committed: false,
      reason: 'head_unchanged',
      stagedFiles: stageResult.stagedFiles,
      startHead,
      endHead,
    };
  }

  return {
    committed: true,
    message: msg,
    stagedFiles: stageResult.stagedFiles,
    startHead,
    endHead,
    taskDoneAppended: !!taskDoneTxn,
  };
}

module.exports = {
  buildTaskCommitMessage,
  commitTaskNow,
  stageTaskChanges,
  normalizeCommitSubject,
  inferCommitPrefix,
};
