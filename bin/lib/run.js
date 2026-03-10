const path = require('path');

const { C } = require('./constants');
const { isOverBudget, recordCost } = require('./configBudget');
const { loadConfig } = require('./config');
const { syncClaudeMd } = require('./files');
const { parseEnvFile } = require('./utils');
const {
  parseParallelTasks,
  createWorktrees,
  cleanupWorktrees,
  autoMergeWorktrees,
  runTaskQueueCommand,
} = require('./parallel');
const { getWorkerDoneState, syncWorkerTaskProgress } = require('./taskState');
const {
  parseTaskStatuses,
} = require('./notionRun');
const { buildStatusProps } = require('./notionSync');
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

function hasTaskQueueManagementFlags(cliArgs = {}) {
  return Boolean(cliArgs.setup || cliArgs.status || cliArgs.merge || cliArgs.clean || cliArgs.stopWorker);
}

function shouldUseNotionControlPlane(targetDir, cliArgs = {}, env = process.env, parseEnvFileFn = parseEnvFile) {
  const envPath = path.join(targetDir, '.sleepcode', '.env');
  const envMap = parseEnvFileFn(envPath);
  const notionKey = cliArgs.notionKey || env.NOTION_API_KEY || envMap.NOTION_API_KEY;
  const notionDb = cliArgs.notionDb || env.NOTION_DB_ID || envMap.NOTION_DB_ID;
  const explicitNotionArgs = Boolean(cliArgs.notionKey || cliArgs.notionDb || cliArgs.notionFilter);

  if (explicitNotionArgs) return true;
  return Boolean(notionKey && notionDb);
}

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

  const config = loadConfig(targetDir) || {};
  const defaultWorker = config.defaultWorker || undefined;
  const projectName = config.projectName || undefined;

  const runState = createRunStateStore();
  // onCancelPendingTask는 notionBindings 초기화 후 채워지는 레퍼런스
  const cancelTaskRef = { fn: null };
  const watchRuntime = createRunWatchRuntime({
    dbId,
    pollIntervalSec,
    projectName,
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
    onCancelPendingTask: (task, worker) => {
      if (cancelTaskRef.fn) cancelTaskRef.fn(task, worker);
    },
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

  // notionBindings 초기화 완료 후 취소 핸들러 등록
  cancelTaskRef.fn = (task) => {
    const schema = runState.getCurrentSchema();
    if (!task || !task.notionId || !schema) return;
    const props = {};
    const statusProps = buildStatusProps(schema, 'Idle');
    if (statusProps) Object.assign(props, statusProps);
    if (schema.run_prop) props[schema.run_prop] = { checkbox: false };
    notionUpdatePage(task.notionId, props);
    watchPushLog('SYSTEM', `${C.yellow}⊘ ${task.title} → Notion 취소 처리됨${C.reset}`);
  };

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
      createWorktrees: (d, w) => createWorktrees(d, w, (m) => watchPushLog('SYSTEM', m)),
      syncWorkerTaskProgress,
      defaultWorker,
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
      cleanupWorktrees: (d, w) => cleanupWorktrees(d, w, (m) => watchPushLog('SYSTEM', m)),
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
      createWorktrees: (d, w) => createWorktrees(d, w, (m) => watchPushLog('SYSTEM', m)),
      createRunTimestamp,
      createDynamicWorkerState,
      setWatchPhase,
      spawnRunWorker,
      scheduleRender,
      pushLog: watchPushLog,
      defaultWorker,
      applyTaskRunUpdatesFn: applyTaskRunUpdates,
    });
  }
  watchRuntime.pollingController.start();
}

function runWorker(cliProvider, cliArgs = {}, options = {}) {
  const targetDir = options.targetDir || process.cwd();
  const env = options.env || process.env;
  const parseEnvFileFn = options.parseEnvFileFn || parseEnvFile;
  const runTaskQueueCommandFn = options.runTaskQueueCommandFn || runTaskQueueCommand;
  const cmdWatchFn = options.cmdWatchFn || cmdWatch;

  if (hasTaskQueueManagementFlags(cliArgs) || !shouldUseNotionControlPlane(targetDir, cliArgs, env, parseEnvFileFn)) {
    return runTaskQueueCommandFn({ cliArgs, cliProvider, targetDir });
  }

  return cmdWatchFn(cliProvider);
}

module.exports = {
  runWorker,
  _internals: {
    cmdWatch,
    hasTaskQueueManagementFlags,
    shouldUseNotionControlPlane,
  },
};
