const { execSync } = require('child_process');

const { MAIN_WORKER_NAME } = require('./parallelWorktrees');

function doesBranchExist(targetDir, branch, execSyncFn = execSync) {
  try {
    execSyncFn(`git rev-parse --verify "${branch}"`, {
      cwd: targetDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function hasBranchDiff(targetDir, currentBranch, branch, execSyncFn = execSync) {
  try {
    const diff = execSyncFn(`git log "${currentBranch}..${branch}" --oneline`, {
      cwd: targetDir,
      stdio: 'pipe',
    }).toString().trim();
    return Boolean(diff);
  } catch {
    return false;
  }
}

function planParallelMerges({
  targetDir,
  currentBranch,
  workers,
  execSyncFn = execSync,
  mainWorkerName = MAIN_WORKER_NAME,
}) {
  return workers.map((worker) => {
    const name = worker.name;
    const branch = worker.branch || `sleepcode/${name}`;

    if (name === mainWorkerName || branch === currentBranch) {
      return { action: 'skip', branch, name, reason: 'current_branch' };
    }

    if (!doesBranchExist(targetDir, branch, execSyncFn)) {
      return { action: 'skip', branch, name, reason: 'missing_branch' };
    }

    if (!hasBranchDiff(targetDir, currentBranch, branch, execSyncFn)) {
      return { action: 'skip', branch, name, reason: 'no_changes' };
    }

    return { action: 'merge', branch, name };
  });
}

function runParallelMergePlan({
  targetDir,
  currentBranch,
  mergePlan,
  cliProvider,
  attemptMergeBranchFn,
}) {
  return mergePlan.map((item) => {
    if (item.action === 'skip') {
      return { ...item, status: 'skipped' };
    }

    return {
      ...item,
      ...attemptMergeBranchFn(targetDir, currentBranch, item.branch, cliProvider),
    };
  });
}

module.exports = {
  doesBranchExist,
  hasBranchDiff,
  planParallelMerges,
  runParallelMergePlan,
};
