const path = require('path');

const { C } = require('./constants');
const { detectPython } = require('./prerequisites');
const { resolveProviderPlan } = require('./provider');
const { isOverBudget } = require('./config');
const { spawnWorker } = require('./worker');
const { syncWorkerTaskProgress } = require('./taskState');
const { ensureRuntimeDirs } = require('./runtimePaths');
const {
  createParallelDashboard,
  getCompletionNextSteps,
  summarizeWorkerOutcomes,
} = require('./parallelDashboard');
const {
  applyParallelBudgetStop,
  mergeCompletedParallelWorker,
  stopRunningWorkers,
  syncParallelWorkerProgress,
} = require('./parallelRunnerControl');

function createWorkerStates(targetDir, workerInfos, logsDir, timestamp) {
  return workerInfos.map((worker) => ({
    ...worker,
    targetDir,
    status: 'running',
    currentTask: '',
    done: 0,
    total: 0,
    cost: 0,
    provider: null,
    fallbackProvider: null,
    _proc: null,
    logFile: path.join(logsDir, `parallel_${worker.name}_${timestamp}.log`),
  }));
}

function printBudgetLimitReached(budgetCheck) {
  console.log(`\n${C.red}주간 한도에 도달했습니다.${C.reset}`);
  console.log(`  사용: $${budgetCheck.total.toFixed(2)} / 한도: $${budgetCheck.limit.toFixed(2)} (${budgetCheck.threshold}% of $${budgetCheck.budget.toFixed(2)})`);
  console.log(`${C.dim}다음 주 월요일에 초기화됩니다.${C.reset}`);
}

function printParallelCompletionSummary(workerStates) {
  const summary = summarizeWorkerOutcomes(workerStates);

  console.log(`\n${C.bold}병렬 실행 완료${C.reset}`);
  const parts = [`${C.green}성공: ${summary.done.length}${C.reset}`];
  if (summary.failed.length > 0) parts.push(`${C.red}실패: ${summary.failed.length}${C.reset}`);
  if (summary.stopped.length > 0) parts.push(`${C.yellow}예산 중지: ${summary.stopped.length}${C.reset}`);
  console.log(`  ${parts.join('  ')}`);

  console.log(`\n${C.bold}생성된 브랜치:${C.reset}`);
  for (const worker of workerStates) {
    const mergedTag = worker.merged ? ` ${C.dim}(병합됨)${C.reset}` : '';
    const icon = worker.status === 'done'
      ? `${C.green}✓${C.reset}`
      : worker.status === 'budget_stop'
        ? `${C.yellow}■${C.reset}`
        : `${C.red}✗${C.reset}`;
    console.log(`  ${icon} ${worker.branch}${mergedTag}`);
  }

  if (summary.alreadyMerged.length > 0) {
    console.log(`\n${C.green}✓ 자동 병합 완료: ${summary.alreadyMerged.map((worker) => worker.name).join(', ')}${C.reset}`);
  }

  console.log(`\n${C.bold}다음 단계:${C.reset}\n`);
  for (const command of getCompletionNextSteps(summary)) {
    const description = command.includes('--merge') ? '# 브랜치 자동 머지' : '# worktree 정리';
    console.log(`  ${C.cyan}${command}${C.reset}   ${C.dim}${description}${C.reset}`);
  }
  console.log('');
}

function runParallelWorkers(targetDir, workerInfos, cliProvider) {
  const { logsDir } = ensureRuntimeDirs(targetDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const py = detectPython();
  if (!py) {
    console.error(`${C.red}python3이 필요합니다.${C.reset}`);
    process.exit(1);
  }

  const budgetCheck = isOverBudget(targetDir);
  if (budgetCheck && budgetCheck.over) {
    printBudgetLimitReached(budgetCheck);
    process.exit(0);
  }

  console.log(`\n${C.bold}병렬 실행 시작${C.reset} — ${workerInfos.length}개 워커\n`);

  try {
    resolveProviderPlan(targetDir, cliProvider);
  } catch (e) {
    console.error(`${C.red}${e.message}${C.reset}`);
    process.exit(1);
  }

  const workerStates = createWorkerStates(targetDir, workerInfos, logsDir, timestamp);
  syncParallelWorkerProgress({
    workerStates,
    syncWorkerTaskProgressFn: syncWorkerTaskProgress,
  });

  const dashboard = createParallelDashboard({
    workerStates,
    targetDir,
    getBudgetInfo: isOverBudget,
    onGracefulExit: () => {
      stopRunningWorkers(workerStates.filter((worker) => worker.status === 'running'), 'SIGINT');
    },
    onImmediateExit: () => stopRunningWorkers(workerStates),
    onInterrupt: () => stopRunningWorkers(workerStates),
  });

  dashboard.start();

  const dashboardInterval = setInterval(() => dashboard.renderDashboard(), 3000);
  const taskProgressInterval = setInterval(() => {
    syncParallelWorkerProgress({
      workerStates,
      scheduleRender: () => dashboard.scheduleRender(),
      syncWorkerTaskProgressFn: syncWorkerTaskProgress,
    });
  }, 5000);

  let budgetStopped = false;
  const budgetCheckInterval = setInterval(() => {
    if (budgetStopped) return;
    const result = applyParallelBudgetStop({
      targetDir,
      workerStates,
      dashboard,
      isOverBudgetFn: isOverBudget,
    });
    budgetStopped = result.stopped;
  }, 30000);

  let activeWorkers = workerStates.length;

  function finishIfDone() {
    if (activeWorkers !== 0) return;
    clearInterval(dashboardInterval);
    clearInterval(taskProgressInterval);
    clearInterval(budgetCheckInterval);
    dashboard.renderDashboard();
    dashboard.dispose();
    printParallelCompletionSummary(workerStates);
  }

  function onWorkerDone(completedWorker) {
    activeWorkers -= 1;
    dashboard.renderDashboard();
    mergeCompletedParallelWorker({
      completedWorker,
      targetDir,
      cliProvider,
      dashboard,
    });
    dashboard.scheduleRender();

    finishIfDone();
  }

  function handleTaskUiUpdated() {
    dashboard.flushRender();
  }

  for (const worker of workerStates) {
    spawnWorker(
      worker,
      py,
      () => onWorkerDone(worker),
      () => dashboard.scheduleRender(),
      (name, message) => dashboard.pushLog(name, message),
      cliProvider,
      null,
      null,
      handleTaskUiUpdated
    );
  }
}

module.exports = {
  createWorkerStates,
  printParallelCompletionSummary,
  runParallelWorkers,
};
