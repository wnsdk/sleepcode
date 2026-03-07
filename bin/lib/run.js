const { isOverBudget, recordCost } = require('./configBudget');
const { syncClaudeMd } = require('./files');
const { parseParallelTasks, createWorktrees, cleanupWorktrees, autoMergeWorktrees } = require('./parallel');
const { getWorkerDoneState, syncWorkerTaskProgress } = require('./taskState');
const {
  parseTaskStatuses,
} = require('./notionRun');
const {
  finalizeParallelWorkers,
  summarizeExecutionResults,
} = require('./runCompletion');
const {
  buildExecutionPlan,
  createDynamicWorkerState,
} = require('./runExecution');
const {
  executeNotionTasks: executeRunTasks,
  finishExecution: finishRunExecution,
} = require('./runExecutionFlow');
const {
  createActiveRunState,
  createIdleRunState,
  createRunTimestamp,
} = require('./runSession');
const {
  buildPollInfo,
  filterNewTasks,
  selectTasksToRun,
} = require('./runPoll');
const {
  applyTaskRunUpdates,
  getFirstTaskIdsByWorker,
} = require('./runWorkers');
const { addTasksDuringExecution: expandRunTasksDuringExecution } = require('./runTaskExpansion');
const { createRunNotionBindings } = require('./runNotionBindings');
const { resolveRunSetupOrExit } = require('./runSetup');
const { createRunStateStore } = require('./runStateStore');
const { createRunWatchRuntime } = require('./runWatchRuntime');
const { createRunWorkerSpawner } = require('./runWorkerSpawner');
const {
  handleGracefulStopDetected,
  stopWatchTimers,
  stopWorkerProcesses,
} = require('./runWatchControl');

function cmdWatch(cliProvider) {
  const setup = resolveRunSetupOrExit();

  const {
    dbId,
    gracefulStopPath,
    logDir,
    notionSync,
    pollIntervalMs,
    pollIntervalSec,
    py,
    runtimeTasksPath,
    targetDir,
  } = setup;

  const runState = createRunStateStore();
  const watchRuntime = createRunWatchRuntime({
    dbId,
    pollIntervalSec,
    targetDir,
    gracefulStopPath,
    pollIntervalMs,
    notionPoll: () => notionBindings.poll(),
    isOverBudget,
    buildPollInfo,
    selectTasksToRun,
    filterNewTasks,
    runState,
    addTasksDuringExecution,
    executeNotionTasks,
    updateNextTaskStatus: (workerPaths) => notionBindings.updateNextTaskStatus(workerPaths),
    syncWorkerTaskProgress,
    handleGracefulStopDetected,
    stopWatchTimers,
    stopWorkerProcesses,
  });
  const {
    dashboard,
    flushRender,
    pushLog: watchPushLog,
    renderDashboard,
    scheduleRender,
    setWatchPhase,
  } = watchRuntime;
  const notionBindings = createRunNotionBindings({
    notionSync,
    getCurrentSchema: () => runState.getCurrentSchema(),
    getCurrentNotionTasks: () => runState.getCurrentNotionTasks(),
    getNotionCompletedIds: () => runState.getNotionCompletedIds(),
    notionInProgressIds: runState.getNotionInProgressIds(),
    getWorkerDoneState,
    flushRender,
    pushLog: (message) => watchPushLog('SYSTEM', message),
  });
  const {
    appendContent: notionAppendContent,
    handleTaskCompleted,
    handleTaskStarted,
    handleTaskUiUpdated,
    updatePage: notionUpdatePage,
  } = notionBindings;

  const spawnRunWorker = createRunWorkerSpawner({
    py,
    targetDir,
    cliProvider,
    autoMergeWorktrees,
    scheduleRender,
    pushLog: watchPushLog,
    handleTaskCompleted,
    handleTaskStarted,
    handleTaskUiUpdated,
    finishExecution,
    getCurrentWorkerStates: () => runState.getCurrentWorkerStates(),
    getCurrentNotionTasks: () => runState.getCurrentNotionTasks(),
    getCurrentSchema: () => runState.getCurrentSchema(),
  });

  // ─── 태스크 실행 ───

  function executeNotionTasks(tasks, schema) {
    executeRunTasks({
      tasks,
      schema,
      targetDir,
      runtimeTasksPath,
      logDir,
      notionInProgressIds: runState.getNotionInProgressIds(),
      updatePage: notionUpdatePage,
      pushLog: watchPushLog,
      setWatchPhase,
      setRunState: (nextState) => runState.applyRunState(nextState),
      setWorkerStates: (workerStates) => runState.setCurrentWorkerStates(workerStates),
      spawnRunWorker,
      finishExecution,
      syncClaudeMd,
      parseParallelTasks,
      createWorktrees,
      syncWorkerTaskProgress,
      buildExecutionPlanFn: buildExecutionPlan,
      createActiveRunStateFn: createActiveRunState,
      createRunTimestampFn: createRunTimestamp,
      applyTaskRunUpdatesFn: applyTaskRunUpdates,
      getFirstTaskIdsByWorkerFn: getFirstTaskIdsByWorker,
    });
  }

  function finishExecution(notionTasks, schema, workerStates) {
    finishRunExecution({
      notionTasks,
      schema,
      workerStates,
      notionCompletedIds: runState.getNotionCompletedIds(),
      targetDir,
      cliProvider,
      autoMergeWorktrees,
      cleanupWorktrees,
      updatePage: notionUpdatePage,
      appendContent: notionAppendContent,
      pushLog: watchPushLog,
      applyIdleState: (idleState) => runState.applyIdleState(idleState),
      setWatchPhase,
      getWorkerDoneState,
      dashboard,
      pollingController: runState.getPollingController(),
      summarizeExecutionResultsFn: summarizeExecutionResults,
      parseTaskStatusesFn: parseTaskStatuses,
      recordCostFn: recordCost,
      finalizeParallelWorkersFn: finalizeParallelWorkers,
      createIdleRunStateFn: createIdleRunState,
    });
  }

  // ─── 실행 중 새 태스크 추가 (즉시 반영) ───

  function addTasksDuringExecution(newTasks, schema) {
    expandRunTasksDuringExecution({
      newTasks,
      schema,
      executingTaskIds: runState.getExecutingTaskIds(),
      currentWorkerStates: runState.getCurrentWorkerStates(),
      currentNotionTasks: runState.getCurrentNotionTasks(),
      notionInProgressIds: runState.getNotionInProgressIds(),
      updatePage: notionUpdatePage,
      syncWorkerTaskProgress,
      targetDir,
      logDir,
      createWorktrees,
      createRunTimestamp,
      createDynamicWorkerState,
      setWatchPhase,
      spawnRunWorker,
      scheduleRender,
      pushLog: watchPushLog,
      applyTaskRunUpdatesFn: applyTaskRunUpdates,
    });
  }
  watchRuntime.pollingController.start();
}

module.exports = {
  runWorker: cmdWatch,
};
