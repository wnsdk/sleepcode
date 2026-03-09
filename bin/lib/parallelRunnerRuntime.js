const { spawnWorker } = require('./worker');
const { createParallelDashboard } = require('./parallelDashboard');
const {
  applyParallelBudgetStop,
  applyParallelStopRequests,
  finalizeCompletedParallelWorkers,
  mergeCompletedParallelWorker,
  stopRunningWorkers,
  syncParallelWorkerProgress,
} = require('./parallelRunnerControl');

function createParallelRunnerRuntime({
  targetDir,
  cliProvider,
  workerStates,
  py,
  getBudgetInfo,
  printParallelCompletionSummary,
  createParallelDashboardFn = createParallelDashboard,
  syncParallelWorkerProgressFn = syncParallelWorkerProgress,
  applyParallelBudgetStopFn = applyParallelBudgetStop,
  applyParallelStopRequestsFn = applyParallelStopRequests,
  finalizeCompletedParallelWorkersFn = finalizeCompletedParallelWorkers,
  mergeCompletedParallelWorkerFn = mergeCompletedParallelWorker,
  stopRunningWorkersFn = stopRunningWorkers,
  spawnWorkerFn = spawnWorker,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  const dashboard = createParallelDashboardFn({
    workerStates,
    targetDir,
    getBudgetInfo,
    onGracefulExit: () => {
      stopRunningWorkersFn(workerStates.filter((worker) => worker.status === 'running'), 'SIGINT');
    },
    onImmediateExit: () => stopRunningWorkersFn(workerStates),
    onInterrupt: () => stopRunningWorkersFn(workerStates),
  });

  let budgetStopped = false;
  let activeWorkers = workerStates.length;
  let dashboardInterval = null;
  let taskProgressInterval = null;
  let budgetCheckInterval = null;
  let stopRequestInterval = null;

  function finishIfDone() {
    if (activeWorkers !== 0) return false;

    clearIntervalFn(dashboardInterval);
    clearIntervalFn(taskProgressInterval);
    clearIntervalFn(budgetCheckInterval);
    clearIntervalFn(stopRequestInterval);
    finalizeCompletedParallelWorkersFn({
      targetDir,
      cliProvider,
      workerStates,
      dashboard,
    });
    dashboard.renderDashboard();
    dashboard.dispose();
    printParallelCompletionSummary(workerStates);
    return true;
  }

  function onWorkerDone(completedWorker) {
    activeWorkers -= 1;
    dashboard.renderDashboard();
    mergeCompletedParallelWorkerFn({
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

  function start() {
    syncParallelWorkerProgressFn({
      workerStates,
    });

    dashboard.start();
    dashboardInterval = setIntervalFn(() => dashboard.renderDashboard(), 3000);
    taskProgressInterval = setIntervalFn(() => {
      syncParallelWorkerProgressFn({
        workerStates,
        scheduleRender: () => dashboard.scheduleRender(),
      });
    }, 5000);
    budgetCheckInterval = setIntervalFn(() => {
      if (budgetStopped) return;
      const result = applyParallelBudgetStopFn({
        targetDir,
        workerStates,
        dashboard,
        isOverBudgetFn: getBudgetInfo,
      });
      budgetStopped = result.stopped;
    }, 30000);
    stopRequestInterval = setIntervalFn(() => {
      applyParallelStopRequestsFn({
        targetDir,
        workerStates,
        dashboard,
      });
    }, 1000);

    for (const worker of workerStates) {
      spawnWorkerFn(
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

  return {
    dashboard,
    finishIfDone,
    getActiveWorkers: () => activeWorkers,
    handleTaskUiUpdated,
    onWorkerDone,
    start,
  };
}

module.exports = {
  createParallelRunnerRuntime,
};
