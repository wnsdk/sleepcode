const { C } = require('./constants');
const { isOverBudget, recordCost } = require('./config');
const { syncClaudeMd } = require('./files');
const { createRunDashboard } = require('./runDashboard');
const { spawnWorker } = require('./worker');
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
  handleTaskCompletedEvent,
  handleTaskStartedEvent,
  syncNextPendingTaskStatus,
} = require('./runNotionEvents');
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
  prepareParallelExecution,
  prepareSingleExecution,
} = require('./runExecution');
const {
  createActiveRunState,
  createIdleRunState,
  createRunTimestamp,
} = require('./runSession');
const {
  areAllWorkersSettled,
  mergeCompletedWorkerNow,
} = require('./runWorkerCompletion');
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
const { createRunSetup } = require('./runSetup');

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

  function stopWorkerProcesses(signal, runningOnly = false) {
    for (const ws of currentWorkerStates) {
      if (runningOnly && ws.status !== 'running') continue;
      if (!ws._proc) continue;
      try { ws._proc.kill(signal); } catch {}
    }
  }

  function stopWatchTimers() {
    if (pollingController) {
      pollingController.stopAll();
    }
  }

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
      stopWorkerProcesses('SIGINT', true);
    },
    onImmediateExit: () => {
      stopWatchTimers();
      stopWorkerProcesses();
    },
    onInterrupt: () => {
      stopWatchTimers();
      stopWorkerProcesses();
    },
  });

  const watchPushLog = (...args) => dashboard.pushLog(...args);
  const scheduleRender = () => dashboard.scheduleRender();
  const flushRender = () => dashboard.flushRender();
  const renderDashboard = () => dashboard.renderDashboard();

  function setWatchPhase(newPhase) {
    watchPhase = newPhase;
    dashboard.setWatchPhase();
  }

  function handleWorkerDone(completedWs) {
    scheduleRender();
    mergeCompletedWorkerNow({
      completedWorker: completedWs,
      targetDir,
      cliProvider,
      autoMergeWorktrees,
      pushLog: (message) => watchPushLog('SYSTEM', message),
    });

    if (areAllWorkersSettled(currentWorkerStates)) {
      finishExecution(currentNotionTasks, currentSchema, currentWorkerStates);
    }
  }

  // ─── Notion API 헬퍼 ───

  const notionPoll = () => notionSync.poll();
  const notionUpdatePage = (pageId, props) => notionSync.updatePage(pageId, props);
  const notionAppendContent = (pageId, text) => notionSync.appendContent(pageId, text);

  function handleTaskCompleted(payload) {
    handleTaskCompletedEvent({
      payload,
      schema: currentSchema,
      notionCompletedIds,
      updatePage: notionUpdatePage,
      pushLog: (message) => watchPushLog('SYSTEM', message),
    });
  }

  function handleTaskUiUpdated() {
    flushRender();
  }

  function handleTaskStarted(payload) {
    handleTaskStartedEvent({
      payload,
      schema: currentSchema,
      updatePage: notionUpdatePage,
      pushLog: (message) => watchPushLog('SYSTEM', message),
    });
  }

  // 태스크 완료 감지 시 다음 대기 태스크를 Running으로 업데이트
  const notionInProgressIds = new Set(); // 이미 Running으로 설정된 태스크 ID 추적

  function updateNextTaskStatus(workerPaths) {
    syncNextPendingTaskStatus({
      schema: currentSchema,
      tasks: currentNotionTasks,
      workerPaths,
      notionInProgressIds,
      updatePage: notionUpdatePage,
      getWorkerDoneState,
    });
  }

  function spawnRunWorker(ws) {
    spawnWorker(
      ws,
      py,
      () => handleWorkerDone(ws),
      scheduleRender,
      watchPushLog,
      cliProvider,
      handleTaskCompleted,
      handleTaskStarted,
      handleTaskUiUpdated
    );
  }

  // ─── 태스크 실행 ───

  function executeNotionTasks(tasks, schema) {
    const runState = createActiveRunState(tasks, schema);
    isExecuting = runState.isExecuting;
    execStartTime = runState.execStartTime;
    currentSchema = runState.currentSchema;
    currentNotionTasks = runState.currentNotionTasks;
    executingTaskIds = runState.executingTaskIds;
    const timestamp = createRunTimestamp();
    const executionPlan = buildExecutionPlan(tasks);
    const { workerGroups, workerNames, useParallel } = executionPlan;

    watchPushLog('SYSTEM', `${C.bold}▶ ${tasks.length}개 태스크 실행 시작${C.reset}`);

    // Notion 상태: 첫 번째 태스크만 Running, 나머지는 Pending + Run 해제
    notionInProgressIds.clear();
    applyTaskRunUpdates({
      tasks,
      schema,
      firstRunningTaskIds: getFirstTaskIdsByWorker(workerGroups),
      trackTasks: false,
      trackedTasks: currentNotionTasks,
      notionInProgressIds,
      updatePage: notionUpdatePage,
    });

    // task_queue.md 생성
    const tasksPath = runtimeTasksPath;

    if (useParallel) {
      watchPushLog('SYSTEM', `${C.cyan}병렬 모드${C.reset}: ${workerNames.join(', ')}`);
      const workerStates = prepareParallelExecution({
        targetDir,
        runtimeTasksPath: tasksPath,
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

      // 대시보드를 실행 모드로 전환
      currentWorkerStates = workerStates;
      setWatchPhase('executing');

      for (const ws of workerStates) {
        spawnRunWorker(ws);
      }
    } else {
      // 단일 모드
      const allTasks = Object.values(workerGroups).flat();
      watchPushLog('SYSTEM', `${C.cyan}단일 모드${C.reset}: ${allTasks.length}개 태스크`);
      const ws = prepareSingleExecution({
        targetDir,
        runtimeTasksPath: tasksPath,
        workerGroups,
        logDir,
        timestamp,
        syncClaudeMd,
        syncWorkerTaskProgress,
      });

      // 대시보드를 실행 모드로 전환
      currentWorkerStates = [ws];
      setWatchPhase('executing');

      spawnRunWorker(ws);
    }
  }

  function finishExecution(notionTasks, schema, workerStates) {
    watchPushLog('SYSTEM', `${C.bold}실행 완료 — Notion 업데이트${C.reset}`);

    const completion = summarizeExecutionResults({
      notionTasks,
      schema,
      workerStates,
      notionCompletedIds,
      getTaskCompletion: (workerRefs) => parseTaskStatuses(workerRefs, getWorkerDoneState),
    });

    // Notion 업데이트
    for (const result of completion.taskResults) {
      if (Object.keys(result.props).length > 0) {
        notionUpdatePage(result.task.id, result.props);
      }

      const icon = result.isDone ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
      watchPushLog('SYSTEM', `${icon} ${result.task.title} → ${result.newStatus}`);
    }

    // AI 보고 내용을 Notion 페이지 본문에 기록
    if (completion.reportText.trim()) {
      for (const task of notionTasks) {
        notionAppendContent(task.id, completion.reportText);
      }
      watchPushLog('SYSTEM', `${C.dim}Notion 페이지에 보고 기록 완료${C.reset}`);
    }

    // 비용 기록
    if (completion.totalCost > 0) {
      recordCost(targetDir, completion.totalCost, 'run');
    }

    // 병렬 실행 후 남은 브랜치 자동 머지 및 워크트리 정리
    finalizeParallelWorkers({
      targetDir,
      workerStates,
      cliProvider,
      autoMergeWorktrees,
      cleanupWorktrees,
      pushLog: (message) => watchPushLog('SYSTEM', message),
    });

    const idleState = createIdleRunState();
    isExecuting = idleState.isExecuting;
    executingTaskIds = idleState.executingTaskIds;
    currentSchema = idleState.currentSchema;
    currentNotionTasks = idleState.currentNotionTasks;
    notionCompletedIds = idleState.notionCompletedIds;
    currentWorkerStates = idleState.currentWorkerStates;
    execStartTime = idleState.execStartTime;
    setWatchPhase('waiting');
    watchPushLog('SYSTEM', `${C.dim}폴링 재개...${C.reset}`);

    // 실행 완료 후 즉시 폴링 — 실행 중 추가된 태스크를 바로 감지
    if (!dashboard.isGracefulShutdown()) {
      setTimeout(() => {
        if (pollingController) {
          pollingController.pollOnce();
        }
      }, 1000);
    }
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
      dashboard.dispose();
      console.log(`\n${C.yellow}graceful_stop 감지 — run 종료${C.reset}`);
      process.exit(0);
    },
  });

  pollingController.start();
}

module.exports = {
  runWorker: cmdWatch,
};
