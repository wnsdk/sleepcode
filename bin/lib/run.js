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
  isSingleMainWorkerMode,
  startDynamicWorker,
  trackDynamicTaskIds,
} = require('./runDynamicTasks');
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
  appendWorkerTasks,
  applyTaskRunUpdates,
  getFirstTaskIdsByWorker,
  splitTasksByWorkerPresence,
} = require('./runWorkers');
const { createRunNotionBindings } = require('./runNotionBindings');
const { createRunSetup } = require('./runSetup');
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

  let isExecuting = false;
  let executingTaskIds = new Set(); // 현재 실행 중인 Notion task ID들
  let currentSchema = null; // 현재 실행에서 사용 중인 schema
  let currentNotionTasks = []; // 현재 실행 중인 Notion task 목록 (finishExecution에서 참조)
  let notionCompletedIds = new Set(); // 완료 즉시 Notion 업데이트된 task ID들

  // ─── 대시보드 상태 ───
  let watchPhase = 'waiting'; // 'waiting' | 'executing'
  let pollInfo = { total: 0, pending: 0 };
  let lastPollTime = null;
  let currentWorkerStates = [];
  let execStartTime = null;
  let pollingController = null;

  const dashboard = createRunDashboard({
    dbId,
    pollIntervalSec,
    getWatchPhase: () => watchPhase,
    getPollInfo: () => pollInfo,
    getLastPollTime: () => lastPollTime,
    getWorkerStates: () => currentWorkerStates,
    getExecStartTime: () => execStartTime,
    onPollNow: () => {
      if (pollingController) {
        pollingController.pollNow();
      }
    },
    onGracefulExit: () => {
      if (pollingController) {
        pollingController.stopPolling();
      }
      stopWorkerProcesses(currentWorkerStates, 'SIGINT', true);
    },
    onImmediateExit: () => {
      stopWatchTimers(pollingController);
      stopWorkerProcesses(currentWorkerStates);
    },
    onInterrupt: () => {
      stopWatchTimers(pollingController);
      stopWorkerProcesses(currentWorkerStates);
    },
  });

  const watchPushLog = (...args) => dashboard.pushLog(...args);
  const scheduleRender = () => dashboard.scheduleRender();
  const flushRender = () => dashboard.flushRender();
  const renderDashboard = () => dashboard.renderDashboard();
  const notionInProgressIds = new Set(); // 이미 Running으로 설정된 태스크 ID 추적
  const notionBindings = createRunNotionBindings({
    notionSync,
    getCurrentSchema: () => currentSchema,
    getCurrentNotionTasks: () => currentNotionTasks,
    getNotionCompletedIds: () => notionCompletedIds,
    notionInProgressIds,
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
    watchPhase = newPhase;
    dashboard.setWatchPhase();
  }

  function spawnRunWorker(ws) {
    spawnManagedRunWorker({
      workerState: ws,
      py,
      onDone: () => handleRunWorkerDone({
        completedWorker: ws,
        currentWorkerStates,
        targetDir,
        cliProvider,
        autoMergeWorktrees,
        pushLog: (message) => watchPushLog('SYSTEM', message),
        scheduleRender,
        finishExecution,
        currentNotionTasks,
        currentSchema,
      }),
      scheduleRender,
      pushLog: watchPushLog,
      cliProvider,
      handleTaskCompleted,
      handleTaskStarted,
      handleTaskUiUpdated
    });
  }

  function applyRunState(nextState) {
    isExecuting = nextState.isExecuting;
    execStartTime = nextState.execStartTime;
    currentSchema = nextState.currentSchema;
    currentNotionTasks = nextState.currentNotionTasks;
    executingTaskIds = nextState.executingTaskIds;
  }

  function applyIdleState(idleState) {
    isExecuting = idleState.isExecuting;
    executingTaskIds = idleState.executingTaskIds;
    currentSchema = idleState.currentSchema;
    currentNotionTasks = idleState.currentNotionTasks;
    notionCompletedIds = idleState.notionCompletedIds;
    currentWorkerStates = idleState.currentWorkerStates;
    execStartTime = idleState.execStartTime;
  }

  // ─── 태스크 실행 ───

  function executeNotionTasks(tasks, schema) {
    executeRunTasks({
      tasks,
      schema,
      targetDir,
      runtimeTasksPath,
      logDir,
      notionInProgressIds,
      updatePage: notionUpdatePage,
      pushLog: watchPushLog,
      setWatchPhase,
      setRunState: applyRunState,
      setWorkerStates: (workerStates) => {
        currentWorkerStates = workerStates;
      },
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
      notionCompletedIds,
      targetDir,
      cliProvider,
      autoMergeWorktrees,
      cleanupWorktrees,
      updatePage: notionUpdatePage,
      appendContent: notionAppendContent,
      pushLog: watchPushLog,
      applyIdleState,
      setWatchPhase,
      getWorkerDoneState,
      dashboard,
      pollingController,
      summarizeExecutionResultsFn: summarizeExecutionResults,
      parseTaskStatusesFn: parseTaskStatuses,
      recordCostFn: recordCost,
      finalizeParallelWorkersFn: finalizeParallelWorkers,
      createIdleRunStateFn: createIdleRunState,
    });
  }

  // ─── 실행 중 새 태스크 추가 (즉시 반영) ───

  function addTasksDuringExecution(newTasks, schema) {
    trackDynamicTaskIds(executingTaskIds, newTasks);
    const { existingGroups: tasksForExisting, newGroups: tasksForNew } = splitTasksByWorkerPresence(
      newTasks,
      currentWorkerStates.map((ws) => ws.name)
    );

    // 1. 기존 워커에 태스크 추가: task_queue.md에 라인 추가
    for (const [workerName, tasks] of Object.entries(tasksForExisting)) {
      const ws = currentWorkerStates.find(w => w.name === workerName);
      if (!ws) continue;
      const result = appendWorkerTasks({
        workerState: ws,
        tasks,
        schema,
        trackedTasks: currentNotionTasks,
        notionInProgressIds,
        updatePage: notionUpdatePage,
        syncWorkerTaskProgress,
        onError: (error) => {
          watchPushLog('SYSTEM', `${C.red}태스크 추가 실패 (${workerName}): ${error.message}${C.reset}`);
        },
      });
      if (!result.ok) {
        continue;
      }
      for (const task of tasks) {
        watchPushLog('SYSTEM', `${C.green}+${C.reset} ${task.title} → ${C.cyan}${workerName}${C.reset} 에 추가`);
      }
    }

    // 2. 새로운 워커 그룹: worktree 생성 + 워커 스폰
    for (const [workerName, tasks] of Object.entries(tasksForNew)) {
      const newWs = startDynamicWorker({
        currentWorkerStates,
        workerName,
        tasks,
        schema,
        targetDir,
        logDir,
        createWorktrees,
        createRunTimestamp,
        createDynamicWorkerState,
        applyRunTaskUpdates: ({ tasks, schema, firstRunningTaskIds, options }) => applyTaskRunUpdates({
          tasks,
          schema,
          firstRunningTaskIds,
          trackTasks: options && Object.prototype.hasOwnProperty.call(options, 'trackTasks')
            ? options.trackTasks
            : true,
          trackedTasks: currentNotionTasks,
          notionInProgressIds,
          updatePage: notionUpdatePage,
        }),
        setWatchPhase,
        pushLog: (message) => watchPushLog('SYSTEM', message),
        spawnRunWorker,
      });

      if (newWs) {
        continue;
      }

      if (isSingleMainWorkerMode(currentWorkerStates)) {
        const ws = currentWorkerStates[0];
        const result = appendWorkerTasks({
          workerState: ws,
          tasks,
          schema,
          trackedTasks: currentNotionTasks,
          notionInProgressIds,
          updatePage: notionUpdatePage,
          syncWorkerTaskProgress,
          onSuccess: () => {
            watchPushLog('SYSTEM', `${C.yellow}↷${C.reset} worktree 생성 실패 → main에 ${tasks.length}개 태스크 추가`);
          },
        });
        if (!result.ok) {
          continue;
        }
      } else {
        watchPushLog('SYSTEM', `${C.red}워커 ${workerName} worktree 생성 실패${C.reset}`);
      }
    }

    scheduleRender();
  }

  pollingController = createRunPollingController({
    targetDir,
    gracefulStopPath,
    pollIntervalMs,
    notionPoll,
    isOverBudget,
    buildPollInfo,
    selectTasksToRun,
    filterNewTasks,
    getIsExecuting: () => isExecuting,
    getExecutingTaskIds: () => executingTaskIds,
    getWatchPhase: () => watchPhase,
    getCurrentWorkerStates: () => currentWorkerStates,
    setLastPollTime: (value) => {
      lastPollTime = value;
    },
    setPollInfo: (value) => {
      pollInfo = value;
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
  });

  pollingController.start();
}

module.exports = {
  runWorker: cmdWatch,
};
