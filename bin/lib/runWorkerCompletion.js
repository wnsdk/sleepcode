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
    return { attempted: false, conflicted: false, merged: Boolean(worker && worker.merged) };
  }

  if (worker.usesMainBranch || worker.name === 'main') {
    worker.merged = true;
    return { attempted: false, conflicted: false, merged: true };
  }

  log(`${C.green}${worker.name} 완료 — main 브랜치에 즉시 병합 중...${C.reset}`);
  try {
    const mergeResults = autoMergeWorktrees(targetDir, [worker], cliProvider);
    if (mergeResults.merged.includes(worker.name)) {
      worker.merged = true;
      log(`${C.green}✓ ${worker.name} — main 브랜치 병합 완료${C.reset}`);
      return { attempted: true, conflicted: false, merged: true };
    }
    if (mergeResults.skipped.includes(worker.name)) {
      worker.merged = true;
      log(`${C.dim}${worker.name} — 병합 스킵 (변경 없음)${C.reset}`);
      return { attempted: true, conflicted: false, merged: true };
    }
    if (mergeResults.conflicted.includes(worker.name)) {
      log(`${C.red}✗ ${worker.name} — 병합 충돌 (수동 처리 필요)${C.reset}`);
      return { attempted: true, conflicted: true, merged: false };
    }
    return { attempted: true, conflicted: false, merged: Boolean(worker.merged) };
  } catch (e) {
    log(`${C.red}✗ ${worker.name} — 즉시 병합 실패: ${e.message}${C.reset}`);
    return { attempted: true, conflicted: true, merged: false };
  }
}

function areAllWorkersSettled(workerStates) {
  return (workerStates || []).every((worker) => worker.status !== 'running');
}

module.exports = {
  areAllWorkersSettled,
  mergeCompletedWorkerNow,
};
