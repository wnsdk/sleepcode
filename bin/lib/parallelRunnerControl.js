const fs = require('fs');
const path = require('path');

const { C } = require('./constants');
const { isOverBudget } = require('./config');
const { syncWorkerTaskProgress } = require('./taskState');
const { autoMergeWorktrees } = require('./parallelMerge');

function stopRunningWorkers(workerStates, signal = null) {
  for (const worker of workerStates || []) {
    if (!worker._proc) continue;
    try {
      if (signal) worker._proc.kill(signal);
      else worker._proc.kill();
    } catch {}
  }
}

function syncParallelWorkerProgress({
  workerStates,
  scheduleRender,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
  syncWorkerTaskProgressFn = syncWorkerTaskProgress,
}) {
  for (const worker of workerStates || []) {
    if (worker.status !== 'running') continue;
    const tasksPath = worker.tasksPath || path.join(worker.path, '.sleepcode', 'task_queue.md');
    try {
      if (!existsSync(tasksPath)) continue;
      const content = readFileSync(tasksPath, 'utf-8');
      syncWorkerTaskProgressFn(worker, null, content);
    } catch {}
  }

  if (typeof scheduleRender === 'function') {
    scheduleRender();
  }
}

function applyParallelBudgetStop({
  targetDir,
  workerStates,
  dashboard,
  isOverBudgetFn = isOverBudget,
}) {
  const result = isOverBudgetFn(targetDir);
  if (!result || !result.over) {
    return { stopped: false, result };
  }

  dashboard.pushLog(
    'SYSTEM',
    `${C.yellow}주간 한도 ${result.threshold}% 도달 ($${result.total.toFixed(2)}) — 워커 중지${C.reset}`
  );

  for (const worker of workerStates || []) {
    if (worker.status === 'running' && worker._proc) {
      worker.status = 'budget_stop';
      worker.currentTask = '한도 도달 — 중지됨';
      try {
        worker._proc.kill();
      } catch {}
    }
  }

  dashboard.renderDashboard();
  return { stopped: true, result };
}

function mergeCompletedParallelWorker({
  completedWorker,
  targetDir,
  cliProvider,
  dashboard,
  autoMergeWorktreesFn = autoMergeWorktrees,
}) {
  if (!completedWorker || completedWorker.status !== 'done') {
    return { merged: false, skipped: false, conflicted: false };
  }

  dashboard.pushLog(
    'SYSTEM',
    `${C.green}${completedWorker.name} 완료 — main 브랜치에 즉시 병합 중...${C.reset}`
  );

  try {
    const mergeResults = autoMergeWorktreesFn(targetDir, [completedWorker], cliProvider);
    if (mergeResults.merged.length > 0) {
      dashboard.pushLog('SYSTEM', `${C.green}✓ ${completedWorker.name} — main 브랜치 병합 완료${C.reset}`);
      completedWorker.merged = true;
      return { merged: true, skipped: false, conflicted: false };
    }
    if (mergeResults.skipped.length > 0) {
      dashboard.pushLog('SYSTEM', `${C.dim}${completedWorker.name} — 병합 스킵 (변경 없음)${C.reset}`);
      completedWorker.merged = true;
      return { merged: false, skipped: true, conflicted: false };
    }
    if (mergeResults.conflicted.length > 0) {
      dashboard.pushLog('SYSTEM', `${C.red}✗ ${completedWorker.name} — 병합 충돌 (수동 처리 필요)${C.reset}`);
      return { merged: false, skipped: false, conflicted: true };
    }
  } catch (error) {
    dashboard.pushLog('SYSTEM', `${C.red}✗ ${completedWorker.name} — 병합 오류: ${error.message}${C.reset}`);
    return { merged: false, skipped: false, conflicted: false, error };
  }

  return { merged: false, skipped: false, conflicted: false };
}

module.exports = {
  applyParallelBudgetStop,
  mergeCompletedParallelWorker,
  stopRunningWorkers,
  syncParallelWorkerProgress,
};
