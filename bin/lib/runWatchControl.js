const { C } = require('./constants');
const { spawnWorker } = require('./worker');
const {
  areAllWorkersSettled,
  mergeCompletedWorkerNow,
} = require('./runWorkerCompletion');

function stopWorkerProcesses(workerStates, signal, runningOnly = false) {
  for (const workerState of workerStates) {
    if (runningOnly && workerState.status !== 'running') continue;
    if (!workerState._proc) continue;
    try {
      workerState._proc.kill(signal);
    } catch {}
  }
}

function stopWatchTimers(pollingController) {
  if (pollingController) {
    pollingController.stopAll();
  }
}

function handleWorkerDone({
  completedWorker,
  currentWorkerStates,
  targetDir,
  cliProvider,
  autoMergeWorktrees,
  pushLog,
  scheduleRender,
  finishExecution,
  currentNotionTasks,
  currentSchema,
  mergeCompletedWorkerNowFn = mergeCompletedWorkerNow,
  areAllWorkersSettledFn = areAllWorkersSettled,
}) {
  scheduleRender();
  mergeCompletedWorkerNowFn({
    completedWorker,
    targetDir,
    cliProvider,
    autoMergeWorktrees,
    pushLog,
  });

  if (areAllWorkersSettledFn(currentWorkerStates)) {
    finishExecution(currentNotionTasks, currentSchema, currentWorkerStates);
  }
}

function spawnRunWorker({
  workerState,
  py,
  onDone,
  scheduleRender,
  pushLog,
  cliProvider,
  handleTaskCompleted,
  handleTaskStarted,
  handleTaskUiUpdated,
  spawnWorkerFn = spawnWorker,
}) {
  spawnWorkerFn(
    workerState,
    py,
    onDone,
    scheduleRender,
    pushLog,
    cliProvider,
    handleTaskCompleted,
    handleTaskStarted,
    handleTaskUiUpdated
  );
}

function handleGracefulStopDetected({
  dashboard,
  log = console.log,
  exit = process.exit,
}) {
  dashboard.dispose();
  log(`\n${C.yellow}graceful_stop 감지 — run 종료${C.reset}`);
  exit(0);
}

module.exports = {
  handleGracefulStopDetected,
  handleWorkerDone,
  spawnRunWorker,
  stopWatchTimers,
  stopWorkerProcesses,
};
