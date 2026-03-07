const { C } = require('./constants');
const { isOverBudget, recordCost } = require('./config');
const { syncClaudeMd } = require('./files');
const { createRunDashboard } = require('./runDashboard');
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
  createRunPollingController,
} = require('./runPolling');
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
const { createRunSetup } = require('./runSetup');
const { createRunStateStore } = require('./runStateStore');
const {
  handleGracefulStopDetected,
  handleWorkerDone: handleRunWorkerDone,
  spawnRunWorker: spawnManagedRunWorker,
  stopWatchTimers,
  stopWorkerProcesses,
} = require('./runWatchControl');

function cmdWatch(cliProvider) {
  let setup;
  try {
    setup = createRunSetup();
  } catch (error) {
    const outputLines = Array.isArray(error.outputLines) ? error.outputLines : [`${C.red}${error.message}${C.reset}`];
    for (const line of outputLines) {
      if (!line) continue;
      console.log(line);
    }
    process.exit(error.exitCode || 1);
  }

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

  const dashboard = createRunDashboard({
    dbId,
    pollIntervalSec,
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
  });

  const watchPushLog = (...args) => dashboard.pushLog(...args);
  const scheduleRender = () => dashboard.scheduleRender();
  const flushRender = () => dashboard.flushRender();
  const renderDashboard = () => dashboard.renderDashboard();
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
    poll: notionPoll,
    updateNextTaskStatus,
    updatePage: notionUpdatePage,
  } = notionBindings;

  function setWatchPhase(newPhase) {
    runState.setWatchPhase(newPhase);
    dashboard.setWatchPhase();
  }

  function spawnRunWorker(ws) {
    spawnManagedRunWorker({
      workerState: ws,
      py,
      onDone: () => handleRunWorkerDone({
        completedWorker: ws,
        currentWorkerStates: runState.getCurrentWorkerStates(),
        targetDir,
        cliProvider,
        autoMergeWorktrees,
        pushLog: (message) => watchPushLog('SYSTEM', message),
        scheduleRender,
        finishExecution,
        currentNotionTasks: runState.getCurrentNotionTasks(),
        currentSchema: runState.getCurrentSchema(),
      }),
      scheduleRender,
      pushLog: watchPushLog,
      cliProvider,
      handleTaskCompleted,
      handleTaskStarted,
      handleTaskUiUpdated
    });
  }

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

  runState.setPollingController(createRunPollingController({
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
    renderDashboard,
    scheduleRender,
    updateNextTaskStatus,
    syncWorkerTaskProgress,
    dashboard,
    pushLog: watchPushLog,
    onGracefulStopDetected: () => {
      handleGracefulStopDetected({ dashboard });
    },
  }));

  runState.getPollingController().start();
}

module.exports = {
  runWorker: cmdWatch,
};
