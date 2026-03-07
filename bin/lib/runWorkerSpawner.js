const {
  handleWorkerDone,
  spawnRunWorker,
} = require('./runWatchControl');

function createRunWorkerSpawner({
  py,
  targetDir,
  cliProvider,
  autoMergeWorktrees,
  scheduleRender,
  pushLog,
  handleTaskCompleted,
  handleTaskStarted,
  handleTaskUiUpdated,
  finishExecution,
  getCurrentWorkerStates,
  getCurrentNotionTasks,
  getCurrentSchema,
  handleWorkerDoneFn = handleWorkerDone,
  spawnRunWorkerFn = spawnRunWorker,
}) {
  return function spawnManagedWorker(workerState) {
    spawnRunWorkerFn({
      workerState,
      py,
      onDone: () => handleWorkerDoneFn({
        completedWorker: workerState,
        currentWorkerStates: getCurrentWorkerStates(),
        targetDir,
        cliProvider,
        autoMergeWorktrees,
        pushLog: (message) => pushLog('SYSTEM', message),
        scheduleRender,
        finishExecution,
        currentNotionTasks: getCurrentNotionTasks(),
        currentSchema: getCurrentSchema(),
      }),
      scheduleRender,
      pushLog,
      cliProvider,
      handleTaskCompleted,
      handleTaskStarted,
      handleTaskUiUpdated,
    });
  };
}

module.exports = {
  createRunWorkerSpawner,
};
