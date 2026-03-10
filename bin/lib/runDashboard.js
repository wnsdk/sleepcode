const fs = require('fs');

const { C } = require('./constants');
const { setupMenuInput } = require('./dashboard');
const {
  buildRunDashboardFrame,
  clipVisualText,
  formatElapsedSeconds,
  getRunDashboardHeight,
} = require('./runDashboardFrame');
const { createRunDashboardLogs } = require('./runDashboardLogs');
const { createRunDashboardTerminal } = require('./runDashboardTerminal');

function createRunDashboard({
  dbId,
  pollIntervalSec,
  projectName,
  getWatchPhase,
  getPollInfo,
  getLastPollTime,
  getWorkerStates,
  getExecStartTime,
  onPollNow,
  onGracefulExit,
  onImmediateExit,
  onInterrupt,
  onCancelPendingTask,
}) {
  const menuState = {
    menuIndex: 0,
    worktreeIndex: 0,
    taskPanelOpen: false,
    focusArea: 'worktree',
    taskPanelSelectedIndex: null,
    taskCancelConfirm: false,
  };
  let cleanupMenuInput = null;
  let gracefulShutdown = false;
  let renderPending = false;
  let renderTimer = null;

  let currentDashboardHeight = getRunDashboardHeight(getWatchPhase(), getWorkerStates());

  const terminal = createRunDashboardTerminal({
    getDashboardHeight: () => currentDashboardHeight,
    onResize: () => {
      renderDashboard();
      logs.renderLogs(true);
    },
  });

  const logs = createRunDashboardLogs({
    getDashboardHeight: () => currentDashboardHeight,
    isAltScreenActive: () => terminal.isActive(),
  });

  function renderDashboard() {
    if (!terminal.isActive()) return;

    // worktreeIndex 범위 보정
    const ws = getWorkerStates();
    if (ws.length > 0) {
      if (menuState.worktreeIndex == null || menuState.worktreeIndex < 0) {
        menuState.worktreeIndex = 0;
      } else if (menuState.worktreeIndex >= ws.length) {
        menuState.worktreeIndex = ws.length - 1;
      }
    }

    const lines = buildRunDashboardFrame({
      dbId,
      pollIntervalSec,
      projectName,
      watchPhase: getWatchPhase(),
      workerStates: ws,
      pollInfo: getPollInfo(),
      lastPollTime: getLastPollTime(),
      execStartTime: getExecStartTime(),
      gracefulShutdown,
      menuState,
    });

    currentDashboardHeight = lines.length;
    terminal.syncViewport(false);
    terminal.writeFrameLines(lines);
    if (logs.isScrolled()) logs.renderLogs();
  }

  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    renderTimer = setTimeout(() => {
      renderPending = false;
      renderTimer = null;
      renderDashboard();
    }, 200);
  }

  function flushRender() {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    renderPending = false;
    renderDashboard();
    logs.renderLogs(true);
  }

  function requestPollNow() {
    if (typeof onPollNow === 'function') onPollNow();
  }

  function requestGracefulExit() {
    if (gracefulShutdown) return;
    gracefulShutdown = true;
    logs.pushLog('SYSTEM', `${C.yellow}마무리 후 종료 요청 — 현재 작업 완료 후 종료됩니다${C.reset}`);
    if (typeof onGracefulExit === 'function') onGracefulExit();
    renderDashboard();
  }

  function handleCancelTask(worktreeIdx, taskIdx) {
    const workerStates = getWorkerStates();
    const worker = workerStates[worktreeIdx];
    if (!worker) return;

    const tasks = worker.taskEntries || [];
    const task = tasks[taskIdx];
    if (!task) return;

    const done = worker.done || 0;
    const isRunning = worker.status === 'running';
    const firstPendingIdx = isRunning ? done + 1 : done;
    if (taskIdx < firstPendingIdx) return; // 실행 중이거나 완료된 태스크는 취소 불가

    // task_queue.md에서 해당 태스크 라인 제거 (best-effort)
    const tasksPath = worker.tasksPath;
    if (tasksPath && fs.existsSync(tasksPath)) {
      try {
        const content = fs.readFileSync(tasksPath, 'utf-8');
        const lines = content.split('\n');
        const filteredLines = lines.filter((line) => {
          const trimmed = line.trimStart();
          if (!trimmed.match(/^- \[ \] /)) return true; // 태스크 라인이 아니면 유지
          if (task.notionId && trimmed.includes(`notion:${task.notionId}`)) return false;
          if (task.title && trimmed.startsWith(`- [ ] ${task.title}`)) return false;
          return true;
        });
        fs.writeFileSync(tasksPath, filteredLines.join('\n'));
      } catch (e) {
        process.stderr.write(`[cancel] task_queue.md 업데이트 실패: ${e.message}\n`);
      }
    }

    // 워커 상태에서 태스크 제거 및 total 조정
    worker.taskEntries.splice(taskIdx, 1);
    worker.total = Math.max(0, (worker.total || 0) - 1);

    // 선택 인덱스 조정
    const newFirstPendingIdx = isRunning ? worker.done + 1 : worker.done;
    const newLastPendingIdx = worker.taskEntries.length - 1;
    if (newLastPendingIdx < newFirstPendingIdx) {
      menuState.taskPanelSelectedIndex = null;
    } else {
      menuState.taskPanelSelectedIndex = Math.max(newFirstPendingIdx, Math.min(taskIdx, newLastPendingIdx));
    }
    menuState.taskCancelConfirm = false;

    // Notion 업데이트
    if (typeof onCancelPendingTask === 'function') {
      onCancelPendingTask(task, worker);
    }

    logs.pushLog('SYSTEM', `${C.yellow}⊘ 태스크 취소됨: ${task.title}${C.reset}`);
    renderDashboard();
  }

  function requestImmediateExit() {
    if (typeof onImmediateExit === 'function') onImmediateExit();
    dispose();
    console.log(`\n${C.yellow}즉시 종료됨${C.reset}`);
    process.exit(0);
  }

  function sigintHandler() {
    if (typeof onInterrupt === 'function') onInterrupt();
    dispose();
    console.log(`\n${C.yellow}run 종료${C.reset}`);
    process.exit(0);
  }

  function start() {
    terminal.start();

    cleanupMenuInput = setupMenuInput(
      menuState,
      renderDashboard,
      [
        { label: '즉시 폴링', noConfirm: true, handler: requestPollNow },
        { label: '즉시 종료', handler: requestImmediateExit },
        { label: '마무리 후 종료', handler: requestGracefulExit },
      ],
      requestImmediateExit,
      logs.handleScroll,
      {
        getWorktreeCount: () => getWorkerStates().length,
        getWorkerStates,
        onCancelTask: handleCancelTask,
      },
      {
        getScrollbarMetrics: logs.getScrollbarMetrics,
        getDashboardHeight: () => currentDashboardHeight,
        scrollToThumbTop: logs.scrollToThumbTop,
      }
    );

    process.stdout.on('resize', terminal.resizeHandler);
    process.on('SIGINT', sigintHandler);
    process.on('exit', terminal.cleanupAltScreen);

    renderDashboard();
    logs.renderLogs(true);
  }

  function setWatchPhase() {
    currentDashboardHeight = getRunDashboardHeight(getWatchPhase(), getWorkerStates());
    terminal.syncViewport(true);
    renderDashboard();
    logs.renderLogs(true);
  }

  function isGracefulShutdown() {
    return gracefulShutdown;
  }

  function dispose() {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    renderPending = false;
    if (cleanupMenuInput) {
      cleanupMenuInput();
      cleanupMenuInput = null;
    }
    process.stdout.removeListener('resize', terminal.resizeHandler);
    process.removeListener('SIGINT', sigintHandler);
    process.removeListener('exit', terminal.cleanupAltScreen);
    terminal.cleanupAltScreen();
  }

  return {
    dispose,
    flushRender,
    isGracefulShutdown,
    pushLog: logs.pushLog,
    renderDashboard,
    scheduleRender,
    setWatchPhase,
    start,
  };
}

module.exports = {
  clipVisualText,
  createRunDashboard,
  formatElapsedSeconds,
  getRunDashboardHeight,
};
