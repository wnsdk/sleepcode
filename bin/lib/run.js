const fs = require('fs');
const path = require('path');
const { C } = require('./constants');
const {
  loadEnvFileToProcessEnv,
  parseNotionDbId,
} = require('./utils');
const { detectPython } = require('./prerequisites');
const { isOverBudget, recordCost } = require('./config');
const { syncClaudeMd } = require('./files');
const { createRunDashboard } = require('./runDashboard');
const { spawnWorker } = require('./worker');
const { parseParallelTasks, createWorktrees, cleanupWorktrees, autoMergeWorktrees } = require('./parallel');
const { getWorkerDoneState, syncWorkerTaskProgress } = require('./taskState');
const {
  createNotionSyncClient,
} = require('./notionSync');
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
  appendTasksToQueueContent,
  buildTaskRunUpdates,
  getFirstTaskIdsByWorker,
  splitTasksByWorkerPresence,
} = require('./runWorkers');
const {
  ensureRuntimeDirs,
  getRuntimeGracefulStopPath,
  getRuntimeTaskQueuePath,
} = require('./runtimePaths');

function cmdWatch(cliProvider) {
  const targetDir = process.cwd();
  const scDir = path.join(targetDir, '.sleepcode');

  if (!fs.existsSync(scDir)) {
    console.error(`${C.red}.sleepcode/ 폴더가 없습니다. 먼저 'npx sleepcode init'으로 초기화하세요.${C.reset}`);
    process.exit(1);
  }

  // .env load
  const envPath = path.join(scDir, '.env');
  loadEnvFileToProcessEnv(envPath);

  // CLI 인자로 Notion 설정 오버라이드
  const { parseArgs } = require('./cli');
  const cliArgs = parseArgs();
  if (cliArgs.notionKey) process.env.NOTION_API_KEY = cliArgs.notionKey;
  if (cliArgs.notionDb) process.env.NOTION_DB_ID = parseNotionDbId(cliArgs.notionDb);
  if (cliArgs.notionFilter) process.env.NOTION_FILTER = cliArgs.notionFilter;

  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_DB_ID;

  if (!apiKey || !dbId) {
    console.error(`${C.red}Notion API Key와 DB ID가 필요합니다.${C.reset}`);
    console.log(`\n  ${C.cyan}npx sleepcode run --notion-key <KEY> --notion-db <DB_ID>${C.reset}`);
    console.log(`  ${C.dim}또는 .sleepcode/.env에 NOTION_API_KEY, NOTION_DB_ID를 설정하세요.${C.reset}`);
    process.exit(1);
  }

  const py = detectPython();
  if (!py) {
    console.error(`${C.red}python3이 필요합니다.${C.reset}`);
    process.exit(1);
  }

  let notionSync;
  try {
    notionSync = createNotionSyncClient({
      targetDir,
      pythonCommand: py.cmd,
      env: process.env,
    });
  } catch (e) {
    console.error(`${C.red}${e.message}${C.reset}`);
    process.exit(1);
  }

  const pollIntervalSec = parseInt(cliArgs.interval || '30', 10);
  const pollIntervalMs = pollIntervalSec * 1000;
  const { logsDir: logDir } = ensureRuntimeDirs(targetDir);
  const runtimeTasksPath = getRuntimeTaskQueuePath(targetDir);
  const gracefulStopPath = getRuntimeGracefulStopPath(targetDir);

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
  let pollTimer = null;
  let dashboardInterval = null;
  let taskProgressInterval = null;

  function stopWorkerProcesses(signal, runningOnly = false) {
    for (const ws of currentWorkerStates) {
      if (runningOnly && ws.status !== 'running') continue;
      if (!ws._proc) continue;
      try { ws._proc.kill(signal); } catch {}
    }
  }

  function stopWatchTimers() {
    clearInterval(pollTimer);
    clearInterval(dashboardInterval);
    clearInterval(taskProgressInterval);
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
      watchPushLog('SYSTEM', `${C.cyan}즉시 폴링 실행${C.reset}`);
      doPoll();
      renderDashboard();
    },
    onGracefulExit: () => {
      clearInterval(pollTimer);
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

  function applyRunTaskUpdates(tasks, schema, firstRunningTaskIds, options = {}) {
    const { trackTasks = true } = options;
    const updates = buildTaskRunUpdates(tasks, schema, firstRunningTaskIds);
    for (const update of updates) {
      if (trackTasks) currentNotionTasks.push(update.task);
      if (update.statusValue === 'Running') notionInProgressIds.add(update.task.id);
      if (Object.keys(update.props).length > 0) {
        notionUpdatePage(update.task.id, update.props);
      }
    }
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

  function appendTasksToWorkerQueue(ws, tasks, schema, options = {}) {
    const {
      errorPrefix = '',
      firstRunningTaskIds = new Set(),
      successMessage = '',
    } = options;
    const tasksPath = ws.tasksPath || path.join(ws.path, '.sleepcode', 'task_queue.md');

    try {
      const existingContent = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf-8') : '';
      const nextContent = appendTasksToQueueContent(existingContent, tasks);
      applyRunTaskUpdates(tasks, schema, firstRunningTaskIds, { trackTasks: true });
      fs.writeFileSync(tasksPath, nextContent);
      syncWorkerTaskProgress(ws, null, nextContent);
      if (successMessage) watchPushLog('SYSTEM', successMessage);
      return true;
    } catch (e) {
      if (errorPrefix) {
        watchPushLog('SYSTEM', `${errorPrefix}${e.message}${C.reset}`);
      }
      return false;
    }
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
    applyRunTaskUpdates(tasks, schema, getFirstTaskIdsByWorker(workerGroups), { trackTasks: false });

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
      setTimeout(doPoll, 1000);
    }
  }

  // ─── 실행 중 새 태스크 추가 (즉시 반영) ───

  function addTasksDuringExecution(newTasks, schema) {
    for (const task of newTasks) {
      executingTaskIds.add(task.id);
    }
    const { existingGroups: tasksForExisting, newGroups: tasksForNew } = splitTasksByWorkerPresence(
      newTasks,
      currentWorkerStates.map((ws) => ws.name)
    );

    // 1. 기존 워커에 태스크 추가: task_queue.md에 라인 추가
    for (const [workerName, tasks] of Object.entries(tasksForExisting)) {
      const ws = currentWorkerStates.find(w => w.name === workerName);
      if (!ws) continue;
      const ok = appendTasksToWorkerQueue(ws, tasks, schema, {
        errorPrefix: `${C.red}태스크 추가 실패 (${workerName}): `,
      });
      if (!ok) {
        continue;
      }
      for (const task of tasks) {
        watchPushLog('SYSTEM', `${C.green}+${C.reset} ${task.title} → ${C.cyan}${workerName}${C.reset} 에 추가`);
      }
    }

    // 2. 새로운 워커 그룹: worktree 생성 + 워커 스폰
    for (const [workerName, tasks] of Object.entries(tasksForNew)) {
      const isParallel = currentWorkerStates.length > 1 || currentWorkerStates[0]?.name !== 'main';
      const timestamp = createRunTimestamp();

      if (!isParallel && currentWorkerStates.length === 1 && currentWorkerStates[0].name === 'main') {
        // 단일 모드에서 main이 아닌 새 워커 → 병렬로 전환해야 하므로 worktree 생성
        const newWs = createDynamicWorkerState({
          targetDir,
          workerName,
          tasks,
          timestamp,
          logDir,
          createWorktrees,
        });
        if (newWs) {
          applyRunTaskUpdates(tasks, schema, new Set([tasks[0].id]), { trackTasks: true });
          currentWorkerStates.push(newWs);
          setWatchPhase('executing'); // 대시보드 높이 재계산

          watchPushLog('SYSTEM', `${C.green}▶${C.reset} 새 워커 ${C.cyan}${workerName}${C.reset} 시작 (${tasks.length}개 태스크)`);

          // 워커 스폰
          spawnRunWorker(newWs);
        } else {
          // worktree 생성 실패 시 main에 태스크 추가
          const ws = currentWorkerStates[0];
          const ok = appendTasksToWorkerQueue(ws, tasks, schema, {
            errorPrefix: '',
            successMessage: `${C.yellow}↷${C.reset} worktree 생성 실패 → main에 ${tasks.length}개 태스크 추가`,
          });
          if (!ok) {
            continue;
          }
        }
      } else {
        // 이미 병렬 모드 → 새 worktree 생성
        const newWs = createDynamicWorkerState({
          targetDir,
          workerName,
          tasks,
          timestamp,
          logDir,
          createWorktrees,
        });
        if (newWs) {
          applyRunTaskUpdates(tasks, schema, new Set([tasks[0].id]), { trackTasks: true });
          currentWorkerStates.push(newWs);
          setWatchPhase('executing');

          watchPushLog('SYSTEM', `${C.green}▶${C.reset} 새 워커 ${C.cyan}${workerName}${C.reset} 시작 (${tasks.length}개 태스크)`);

          spawnRunWorker(newWs);
        } else {
          watchPushLog('SYSTEM', `${C.red}워커 ${workerName} worktree 생성 실패${C.reset}`);
        }
      }
    }

    scheduleRender();
  }

  // ─── 폴링 루프 ───

  function doPoll() {
    lastPollTime = Date.now();

    // graceful_stop 체크
    if (fs.existsSync(gracefulStopPath)) {
      dashboard.dispose();
      console.log(`\n${C.yellow}graceful_stop 감지 — run 종료${C.reset}`);
      process.exit(0);
    }

    // 예산 체크
    const budgetCheck = isOverBudget(targetDir);
    if (budgetCheck && budgetCheck.over) {
      watchPushLog('SYSTEM', `${C.yellow}주간 한도 도달 — 대기${C.reset}`);
      renderDashboard();
      return;
    }

    const data = notionPoll();

    if (!data || data.error) {
      const errMsg = data && data.message ? `: ${data.message}` : '';
      watchPushLog('SYSTEM', `${C.red}폴링 실패${errMsg}${C.reset}`);
      return;
    }

    const schema = data.schema;
    pollInfo = buildPollInfo(data.tasks);
    const tasksToRun = selectTasksToRun(data.tasks, schema);

    // 실행 중일 때: 새로 추가된 태스크만 필터링하여 대기열에 추가
    if (isExecuting) {
      const newTasks = filterNewTasks(tasksToRun, executingTaskIds);
      if (newTasks.length > 0) {
        addTasksDuringExecution(newTasks, schema);
      }
      renderDashboard();
      return;
    }

    if (tasksToRun.length > 0) {
      executeNotionTasks(tasksToRun, schema);
    } else {
      renderDashboard();
    }
  }

  dashboard.start();

  // 대시보드 갱신 타이머 (카운트다운을 위해 1초 간격)
  dashboardInterval = setInterval(renderDashboard, 1000);

  // 5초마다 task_queue.md를 읽어 진행률 갱신 + 개별 태스크 Notion 상태 업데이트
  taskProgressInterval = setInterval(() => {
    if (watchPhase !== 'executing' || currentWorkerStates.length === 0) return;
    for (const ws of currentWorkerStates) {
      if (ws.status !== 'running') continue;
      const tp = ws.tasksPath || path.join(ws.path, '.sleepcode', 'task_queue.md');
      try {
        if (fs.existsSync(tp)) {
          const content = fs.readFileSync(tp, 'utf-8');
          syncWorkerTaskProgress(ws, null, content);
        }
      } catch {}
    }
    // 완료된 태스크 감지 → 다음 대기 태스크를 Running으로 업데이트
    updateNextTaskStatus(currentWorkerStates);
    scheduleRender();
  }, 5000);

  // 초기 폴링
  doPoll();

  // 주기적 폴링
  pollTimer = setInterval(doPoll, pollIntervalMs);
}

module.exports = {
  runWorker: cmdWatch,
};
