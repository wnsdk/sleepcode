const { C } = require('./constants');
const { setupMenuInput } = require('./dashboard');
const {
  buildParallelDashboardFrame,
  clipVisualText,
  formatElapsedSeconds,
  getParallelDashboardHeight,
} = require('./parallelDashboardFrame');
const { createParallelDashboardLogs } = require('./parallelDashboardLogs');

function summarizeWorkerOutcomes(workerStates) {
  const failed = workerStates.filter((worker) => worker.status === 'failed');
  const done = workerStates.filter((worker) => worker.status === 'done');
  const stopped = workerStates.filter((worker) => worker.status === 'budget_stop');
  const alreadyMerged = workerStates.filter((worker) => worker.merged);
  const needsMerge = done.filter((worker) => !worker.merged);

  return {
    failed,
    done,
    stopped,
    alreadyMerged,
    needsMerge,
  };
}

function getCompletionNextSteps(summary) {
  if (summary.needsMerge.length > 0) {
    return [
      'npx sleepcode parallel --merge',
      'npx sleepcode parallel --clean',
    ];
  }

  if (summary.done.length > 0) {
    return ['npx sleepcode parallel --clean'];
  }

  return [
    'npx sleepcode parallel --merge',
    'npx sleepcode parallel --clean',
  ];
}

function createParallelDashboard({
  workerStates,
  targetDir,
  getBudgetInfo,
  onGracefulExit,
  onImmediateExit,
  onInterrupt,
}) {
  const MAX_LOG_BUFFER = 200;
  const menuState = { menuIndex: 0 };
  const dashboardHeight = getParallelDashboardHeight(workerStates);
  const startTime = Date.now();

  let altScreenActive = false;
  let cursorHidden = false;
  let renderPending = false;
  let renderTimer = null;
  let cleanupMenuInput = null;
  let gracefulShutdown = false;
  const logs = createParallelDashboardLogs({
    getDashboardHeight: () => dashboardHeight,
    isAltScreenActive: () => altScreenActive,
    maxBuffer: MAX_LOG_BUFFER,
  });

  function renderDashboard() {
    if (!altScreenActive) return;

    const { lines, menuLayout } = buildParallelDashboardFrame({
      workerStates,
      budgetInfo: getBudgetInfo(targetDir),
      gracefulShutdown,
      menuState,
      startTime,
    });
    menuState._menuLayout = menuLayout;

    for (let i = 0; i < lines.length; i++) {
      process.stdout.write(`\x1b[${i + 1};1H${lines[i]}\x1b[K`);
    }
    process.stdout.write('\x1b[1;1H');
    if (logs.getLogScroll() > 0) logs.renderLogs();
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

  function cleanupAltScreen() {
    if (!altScreenActive) return;
    altScreenActive = false;
    process.stdout.write('\x1b[r');
    process.stdout.write('\x1b[?1049l');
    if (cursorHidden) {
      process.stdout.write('\x1b[?25h');
      cursorHidden = false;
    }
  }

  function resizeHandler() {
    if (!altScreenActive) return;
    const rows = process.stdout.rows || 24;
    if (rows > dashboardHeight) {
      process.stdout.write(`\x1b[${dashboardHeight + 1};${rows}r`);
    }
    process.stdout.write('\x1b[2J');
    renderDashboard();
    logs.renderLogs(true);
  }

  function sigintHandler() {
    if (typeof onInterrupt === 'function') onInterrupt();
    dispose();
    console.log(`\n${C.yellow}중단됨${C.reset}`);
    process.exit(1);
  }

  function gracefulExit() {
    if (gracefulShutdown) return;
    gracefulShutdown = true;
    logs.pushLog('SYSTEM', `${C.yellow}마무리 후 종료 요청 — 현재 작업 완료 후 종료됩니다${C.reset}`);
    if (typeof onGracefulExit === 'function') onGracefulExit();
    renderDashboard();
  }

  function immediateExit() {
    if (typeof onImmediateExit === 'function') onImmediateExit();
    dispose();
    console.log(`\n${C.yellow}즉시 종료됨${C.reset}`);
    process.exit(0);
  }

  function start() {
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[?1049h');
      process.stdout.write('\x1b[H');
      process.stdout.write('\x1b[2J');
      process.stdout.write('\x1b[?25l');
      cursorHidden = true;
      const rows = process.stdout.rows || 24;
      if (rows > dashboardHeight) {
        process.stdout.write(`\x1b[${dashboardHeight + 1};${rows}r`);
      }
      altScreenActive = true;
    }

    process.stdout.on('resize', resizeHandler);
    process.on('SIGINT', sigintHandler);
    process.on('exit', cleanupAltScreen);

    cleanupMenuInput = setupMenuInput(
      menuState,
      renderDashboard,
      [
        { label: '마무리 후 종료', handler: gracefulExit },
        { label: '즉시 종료', handler: immediateExit },
      ],
      immediateExit,
      logs.handleScroll
    );

    renderDashboard();
    logs.renderLogs(true);
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
    process.stdout.removeListener('resize', resizeHandler);
    process.removeListener('SIGINT', sigintHandler);
    process.removeListener('exit', cleanupAltScreen);
    cleanupAltScreen();
  }

  return {
    dispose,
    flushRender,
    getDashboardHeight: () => dashboardHeight,
    pushLog: logs.pushLog,
    renderDashboard,
    scheduleRender,
    start,
  };
}

module.exports = {
  buildParallelDashboardFrame,
  createParallelDashboardLogs,
  clipVisualText,
  formatElapsedSeconds,
  createParallelDashboard,
  getParallelDashboardHeight,
  getCompletionNextSteps,
  summarizeWorkerOutcomes,
};
