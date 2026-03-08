const { C } = require('./constants');

function mergeCompletedWorkerNow({
  completedWorker,
  targetDir,
  cliProvider,
  autoMergeWorktrees,
  pushLog,
}) {
  const worker = completedWorker;
  const log = typeof pushLog === 'function' ? pushLog : () => {};

  if (!worker || worker.status !== 'done' || worker.merged) {
    return { attempted: false, conflicted: false, deferred: false, merged: Boolean(worker && worker.merged) };
  }

  if (worker.usesMainBranch || worker.name === 'main') {
    worker.merged = true;
    return { attempted: false, conflicted: false, deferred: false, merged: true };
  }

  log(`${C.dim}${worker.name} 완료 — 모든 워커 종료 후 일괄 병합 예정${C.reset}`);
  return { attempted: false, conflicted: false, deferred: true, merged: false };
}

function areAllWorkersSettled(workerStates) {
  return (workerStates || []).every((worker) => worker.status !== 'running');
}

module.exports = {
  areAllWorkersSettled,
  mergeCompletedWorkerNow,
};
