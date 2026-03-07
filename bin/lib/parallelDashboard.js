const { C, branchColor } = require('./constants');
const { setupMenuInput } = require('./dashboard');
const {
  buildParallelDashboardFrame,
  clipVisualText,
  formatElapsedSeconds,
  getParallelDashboardHeight,
} = require('./parallelDashboardFrame');

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
  const logBuffer = [];
  const menuState = { menuIndex: 0 };
  const dashboardHeight = getParallelDashboardHeight(workerStates);
  const startTime = Date.now();

  let altScreenActive = false;
  let cursorHidden = false;
  let logScroll = 0;
  let renderPending = false;
  let renderTimer = null;
  let cleanupMenuInput = null;
  let gracefulShutdown = false;

  function getLogRows() {
    const rows = process.stdout.rows || 24;
    return Math.max(0, rows - dashboardHeight);
  }

  function getMaxLogScroll() {
    const logRows = getLogRows();
    return Math.max(0, logBuffer.length - logRows);
  }

  function appendLogToScreen(line) {
    if (!altScreenActive || logScroll > 0) return;
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[${rows};1H`);
    process.stdout.write(`\n  ${line}\x1b[K`);
  }

  function renderLogs(force = false) {
    if (!altScreenActive) return;
    const logRows = getLogRows();
    if (logRows <= 0) return;

    const maxScroll = getMaxLogScroll();
    if (logScroll > maxScroll) logScroll = maxScroll;
    if (!force && logScroll === 0) return;

    const start = Math.max(0, logBuffer.length - logRows - logScroll);
    const slice = logBuffer.slice(start, start + logRows);
    for (let i = 0; i < logRows; i++) {
      const line = slice[i] || '';
      process.stdout.write(`\x1b[${dashboardHeight + 1 + i};1H`);
      process.stdout.write(`  ${line}\x1b[K`);
    }
    process.stdout.write('\x1b[1;1H');
  }

  function pushLog(workerName, message) {
    const tag = `${branchColor(workerName)}[${workerName}]${C.reset}`;
    const fullMessage = `${tag} ${message}`;
    logBuffer.push(fullMessage);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
    if (logScroll > 0) {
      logScroll = Math.min(logScroll + 1, getMaxLogScroll());
    }
    appendLogToScreen(fullMessage);
  }

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
    if (logScroll > 0) renderLogs();
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
    renderLogs(true);
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
    renderLogs(true);
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
    pushLog('SYSTEM', `${C.yellow}마무리 후 종료 요청 — 현재 작업 완료 후 종료됩니다${C.reset}`);
    if (typeof onGracefulExit === 'function') onGracefulExit();
    renderDashboard();
  }

  function immediateExit() {
    if (typeof onImmediateExit === 'function') onImmediateExit();
    dispose();
    console.log(`\n${C.yellow}즉시 종료됨${C.reset}`);
    process.exit(0);
  }

  function handleScroll(action) {
    const logRows = getLogRows();
    if (logRows <= 0) return false;
    const maxScroll = getMaxLogScroll();
    let next = logScroll;
    const page = Math.max(1, logRows - 1);

    switch (action) {
      case 'lineUp':
        next = Math.min(maxScroll, logScroll + 1);
        break;
      case 'lineDown':
        next = Math.max(0, logScroll - 1);
        break;
      case 'pageUp':
        next = Math.min(maxScroll, logScroll + page);
        break;
      case 'pageDown':
        next = Math.max(0, logScroll - page);
        break;
      case 'top':
        next = maxScroll;
        break;
      case 'bottom':
        next = 0;
        break;
      case 'wheelUp':
        next = Math.min(maxScroll, logScroll + 3);
        break;
      case 'wheelDown':
        next = Math.max(0, logScroll - 3);
        break;
      default:
        return false;
    }

    if (next === logScroll) return true;
    logScroll = next;
    renderLogs(true);
    return true;
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
      handleScroll
    );

    renderDashboard();
    renderLogs(true);
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
    pushLog,
    renderDashboard,
    scheduleRender,
    start,
  };
}

module.exports = {
  buildParallelDashboardFrame,
  clipVisualText,
  formatElapsedSeconds,
  createParallelDashboard,
  getParallelDashboardHeight,
  getCompletionNextSteps,
  summarizeWorkerOutcomes,
};
