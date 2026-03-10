const { createRunDashboard } = require('./runDashboard');
const { createRunPollingController } = require('./runPolling');

function createRunWatchRuntime({
  dbId,
  pollIntervalSec,
  projectName,
  targetDir,
  gracefulStopPath,
  pollIntervalMs,
  notionPoll,
  isOverBudget,
  buildPollInfo,
  selectTasksToRun,
  filterNewTasks,
  runState,
  addTasksDuringExecution,
  executeNotionTasks,
  updateNextTaskStatus,
  syncWorkerTaskProgress,
  handleGracefulStopDetected,
  stopWatchTimers,
  stopWorkerProcesses,
  onCancelPendingTask,
  createRunDashboardFn = createRunDashboard,
  createRunPollingControllerFn = createRunPollingController,
}) {
  const dashboard = createRunDashboardFn({
    dbId,
    pollIntervalSec,
    projectName,
    targetDir,
    getWatchPhase: () => runState.getWatchPhase(),
    getPollInfo: () => runState.getPollInfo(),
    getLastPollTime: () => runState.getLastPollTime(),
    getWorkerStates: () => runState.getCurrentWorkerStates(),
    getExecStartTime: () => runState.getExecStartTime(),
    onPollNow: () => {
      const pollingController = runState.getPollingController();
      if (pollingController) {
        pollingController.pollNow();
      }
    },
    onGracefulExit: () => {
      const pollingController = runState.getPollingController();
      if (pollingController) {
        pollingController.stopPolling();
      }
      stopWorkerProcesses(runState.getCurrentWorkerStates(), 'SIGINT', true);
    },
    onImmediateExit: () => {
      stopWatchTimers(runState.getPollingController());
      stopWorkerProcesses(runState.getCurrentWorkerStates());
    },
    onInterrupt: () => {
      stopWatchTimers(runState.getPollingController());
      stopWorkerProcesses(runState.getCurrentWorkerStates());
    },
    onCancelPendingTask,
  });

  const runtime = {
    dashboard,
    flushRender: () => dashboard.flushRender(),
    pushLog: (...args) => dashboard.pushLog(...args),
    renderDashboard: () => dashboard.renderDashboard(),
    scheduleRender: () => dashboard.scheduleRender(),
    setWatchPhase(newPhase) {
      runState.setWatchPhase(newPhase);
      dashboard.setWatchPhase();
    },
  };

  const pollingController = createRunPollingControllerFn({
    targetDir,
    gracefulStopPath,
    pollIntervalMs,
    notionPoll,
    isOverBudget,
    buildPollInfo,
    selectTasksToRun,
    filterNewTasks,
    getIsExecuting: () => runState.getIsExecuting(),
    getExecutingTaskIds: () => runState.getExecutingTaskIds(),
    getWatchPhase: () => runState.getWatchPhase(),
    getCurrentWorkerStates: () => runState.getCurrentWorkerStates(),
    setLastPollTime: (value) => {
      runState.setLastPollTime(value);
    },
    setPollInfo: (value) => {
      runState.setPollInfo(value);
    },
    addTasksDuringExecution,
    executeNotionTasks,
    renderDashboard: runtime.renderDashboard,
    scheduleRender: runtime.scheduleRender,
    updateNextTaskStatus,
    syncWorkerTaskProgress,
    dashboard,
    pushLog: runtime.pushLog,
    onGracefulStopDetected: () => {
      handleGracefulStopDetected({ dashboard });
    },
    getCurrentNotionTasks: () => runState.getCurrentNotionTasks(),
    setCurrentNotionTasks: (tasks) => runState.setCurrentNotionTasks(tasks),
  });
  runState.setPollingController(pollingController);

  return {
    ...runtime,
    pollingController,
  };
}

module.exports = {
  createRunWatchRuntime,
};
