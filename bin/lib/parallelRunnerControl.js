const fs = require('fs');
const path = require('path');

const { C } = require('./constants');
const { isOverBudget } = require('./configBudget');
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
    return { merged: false, skipped: false, conflicted: false, deferred: false };
  }

  if (completedWorker.usesMainBranch || completedWorker.name === 'main') {
    completedWorker.merged = true;
    return { merged: true, skipped: false, conflicted: false, deferred: false };
  }

  dashboard.pushLog(
    'SYSTEM',
    `${C.dim}${completedWorker.name} 완료 — 모든 워커 종료 확인 후 일괄 병합 예정${C.reset}`
  );
  return { merged: false, skipped: false, conflicted: false, deferred: true };
}

function finalizeCompletedParallelWorkers({
  targetDir,
  cliProvider,
  workerStates,
  dashboard,
  autoMergeWorktreesFn = autoMergeWorktrees,
}) {
  const workers = Array.isArray(workerStates) ? workerStates : [];
  if (workers.length === 0) {
    return { merged: [], skipped: [], conflicted: [] };
  }

  dashboard.pushLog('SYSTEM', `${C.bold}모든 워커 종료 확인 — 브랜치 일괄 병합 시작${C.reset}`);

  try {
    const mergeResults = autoMergeWorktreesFn(targetDir, workers, cliProvider);

    for (const worker of workers) {
      if (mergeResults.merged.includes(worker.name) || mergeResults.skipped.includes(worker.name)) {
        worker.merged = true;
      }
    }

    if (mergeResults.merged.length > 0) {
      dashboard.pushLog('SYSTEM', `${C.green}✓ 일괄 병합 완료: ${mergeResults.merged.join(', ')}${C.reset}`);
    }
    if (mergeResults.skipped.length > 0) {
      dashboard.pushLog('SYSTEM', `${C.dim}병합 스킵: ${mergeResults.skipped.join(', ')}${C.reset}`);
    }
    if (mergeResults.conflicted.length > 0) {
      dashboard.pushLog(
        'SYSTEM',
        `${C.red}✗ 일괄 병합 충돌: ${mergeResults.conflicted.join(', ')}${C.reset} ${C.dim}(기본 AI 자동 해결 실패)${C.reset}`
      );
    }

    return mergeResults;
  } catch (error) {
    dashboard.pushLog('SYSTEM', `${C.red}✗ 일괄 병합 오류: ${error.message}${C.reset}`);
    return { merged: [], skipped: [], conflicted: workers.filter((worker) => !worker.merged).map((worker) => worker.name), error };
  }
}

module.exports = {
  applyParallelBudgetStop,
  finalizeCompletedParallelWorkers,
  mergeCompletedParallelWorker,
  stopRunningWorkers,
  syncParallelWorkerProgress,
};
