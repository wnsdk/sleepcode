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
  defaultWorker,
  buildExecutionPlanFn = buildExecutionPlan,
  createActiveRunStateFn = createActiveRunState,
  createRunTimestampFn = createRunTimestamp,
  prepareParallelExecutionFn = prepareParallelExecution,
  applyTaskRunUpdatesFn = applyTaskRunUpdates,
  getFirstTaskIdsByWorkerFn = getFirstTaskIdsByWorker,
}) {
  const runState = createActiveRunStateFn(tasks, schema);
  setRunState(runState);

  const timestamp = createRunTimestampFn();
  const executionPlan = buildExecutionPlanFn(tasks, { defaultWorker });
  const { workerGroups, workerNames } = executionPlan;

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

  pushLog('SYSTEM', `${C.cyan}병렬 실행${C.reset}: ${workerNames.join(', ')}`);
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

  if (completion.totalCost > 0) {
    // 프로바이더별로 나눠서 기록
    const byProvider = completion.tokensByProvider || {};
    const providers = Object.keys(byProvider);
    if (providers.length > 1) {
      const totalTok = (completion.totalInputTokens || 0) + (completion.totalOutputTokens || 0);
      for (const [prov, tokens] of Object.entries(byProvider)) {
        const ratio = totalTok > 0 ? (tokens.input + tokens.output) / totalTok : 1 / providers.length;
        recordCostFn(targetDir, completion.totalCost * ratio, 'run', null, {
          provider: prov,
          inputTokens: tokens.input,
          outputTokens: tokens.output,
        });
      }
    } else if (providers.length === 1) {
      const prov = providers[0];
      const tokens = byProvider[prov];
      recordCostFn(targetDir, completion.totalCost, 'run', null, {
        provider: prov,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
      });
    } else {
      recordCostFn(targetDir, completion.totalCost, 'run');
    }
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
