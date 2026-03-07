const { C } = require('./constants');
const { recordCost } = require('./configBudget');
const { parseTaskStatuses } = require('./notionRun');
const {
  finalizeParallelWorkers,
  summarizeExecutionResults,
} = require('./runCompletion');
const {
  buildExecutionPlan,
  prepareParallelExecution,
  prepareSingleExecution,
} = require('./runExecution');
const {
  createActiveRunState,
  createIdleRunState,
  createRunTimestamp,
} = require('./runSession');
const {
  applyTaskRunUpdates,
  getFirstTaskIdsByWorker,
} = require('./runWorkers');

function executeNotionTasks({
  tasks,
  schema,
  targetDir,
  runtimeTasksPath,
  logDir,
  notionInProgressIds,
  updatePage,
  pushLog,
  setWatchPhase,
  setRunState,
  setWorkerStates,
  spawnRunWorker,
  finishExecution,
  syncClaudeMd,
  parseParallelTasks,
  createWorktrees,
  syncWorkerTaskProgress,
  buildExecutionPlanFn = buildExecutionPlan,
  createActiveRunStateFn = createActiveRunState,
  createRunTimestampFn = createRunTimestamp,
  prepareParallelExecutionFn = prepareParallelExecution,
  prepareSingleExecutionFn = prepareSingleExecution,
  applyTaskRunUpdatesFn = applyTaskRunUpdates,
  getFirstTaskIdsByWorkerFn = getFirstTaskIdsByWorker,
}) {
  const runState = createActiveRunStateFn(tasks, schema);
  setRunState(runState);

  const timestamp = createRunTimestampFn();
  const executionPlan = buildExecutionPlanFn(tasks);
  const { workerGroups, workerNames, useParallel } = executionPlan;

  pushLog('SYSTEM', `${C.bold}▶ ${tasks.length}개 태스크 실행 시작${C.reset}`);

  notionInProgressIds.clear();
  applyTaskRunUpdatesFn({
    tasks,
    schema,
    firstRunningTaskIds: getFirstTaskIdsByWorkerFn(workerGroups),
    trackTasks: false,
    trackedTasks: runState.currentNotionTasks,
    notionInProgressIds,
    updatePage,
  });

  if (useParallel) {
    pushLog('SYSTEM', `${C.cyan}병렬 모드${C.reset}: ${workerNames.join(', ')}`);
    const workerStates = prepareParallelExecutionFn({
      targetDir,
      runtimeTasksPath,
      workerGroups,
      timestamp,
      logDir,
      syncClaudeMd,
      parseParallelTasks,
      createWorktrees,
      syncWorkerTaskProgress,
    });

    if (workerStates.length === 0) {
      finishExecution(tasks, schema, []);
      return;
    }

    setWorkerStates(workerStates);
    setWatchPhase('executing');
    for (const workerState of workerStates) {
      spawnRunWorker(workerState);
    }
    return;
  }

  const allTasks = Object.values(workerGroups).flat();
  pushLog('SYSTEM', `${C.cyan}단일 모드${C.reset}: ${allTasks.length}개 태스크`);
  const workerState = prepareSingleExecutionFn({
    targetDir,
    runtimeTasksPath,
    workerGroups,
    logDir,
    timestamp,
    syncClaudeMd,
    syncWorkerTaskProgress,
  });

  setWorkerStates([workerState]);
  setWatchPhase('executing');
  spawnRunWorker(workerState);
}

function finishExecution({
  notionTasks,
  schema,
  workerStates,
  notionCompletedIds,
  targetDir,
  cliProvider,
  autoMergeWorktrees,
  cleanupWorktrees,
  updatePage,
  appendContent,
  pushLog,
  applyIdleState,
  setWatchPhase,
  getWorkerDoneState,
  dashboard,
  pollingController,
  summarizeExecutionResultsFn = summarizeExecutionResults,
  parseTaskStatusesFn = parseTaskStatuses,
  recordCostFn = recordCost,
  finalizeParallelWorkersFn = finalizeParallelWorkers,
  createIdleRunStateFn = createIdleRunState,
  schedule = setTimeout,
}) {
  pushLog('SYSTEM', `${C.bold}실행 완료 — Notion 업데이트${C.reset}`);

  const completion = summarizeExecutionResultsFn({
    notionTasks,
    schema,
    workerStates,
    notionCompletedIds,
    getTaskCompletion: (workerRefs) => parseTaskStatusesFn(workerRefs, getWorkerDoneState),
  });

  for (const result of completion.taskResults) {
    if (Object.keys(result.props).length > 0) {
      updatePage(result.task.id, result.props);
    }

    const icon = result.isDone ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    pushLog('SYSTEM', `${icon} ${result.task.title} → ${result.newStatus}`);
  }

  if (completion.reportText.trim()) {
    for (const task of notionTasks) {
      appendContent(task.id, completion.reportText);
    }
    pushLog('SYSTEM', `${C.dim}Notion 페이지에 보고 기록 완료${C.reset}`);
  }

  if (completion.totalCost > 0) {
    recordCostFn(targetDir, completion.totalCost, 'run');
  }

  finalizeParallelWorkersFn({
    targetDir,
    workerStates,
    cliProvider,
    autoMergeWorktrees,
    cleanupWorktrees,
    pushLog,
  });

  applyIdleState(createIdleRunStateFn());
  setWatchPhase('waiting');
  pushLog('SYSTEM', `${C.dim}폴링 재개...${C.reset}`);

  if (!dashboard.isGracefulShutdown()) {
    schedule(() => {
      if (pollingController) {
        pollingController.pollOnce();
      }
    }, 1000);
  }
}

module.exports = {
  executeNotionTasks,
  finishExecution,
};
