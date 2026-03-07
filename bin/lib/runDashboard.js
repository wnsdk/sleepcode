const { C, SLEEPCODE_BADGE_WITH_VERSION, branchColor, notionLink } = require('./constants');
const { progressBar, visualWidth, padEndVisual } = require('./utils');
const { providerLabelWithModel } = require('./provider');
const { boxLine, renderMenuLineWithLayout, setupMenuInput } = require('./dashboard');

function clipVisualText(text, maxWidth) {
  const source = String(text || '');
  if (visualWidth(source) <= maxWidth) return source;

  let width = 0;
  let cut = 0;
  for (const ch of source) {
    const chWidth = visualWidth(ch);
    if (width + chWidth > maxWidth - 3) break;
    width += chWidth;
    cut += ch.length;
  }

  return source.slice(0, cut) + '...';
}

function getRunDashboardHeight(phase, workerStates) {
  if (phase !== 'executing' || !Array.isArray(workerStates) || workerStates.length === 0) {
    return 12;
  }
  return 8 + workerStates.length * 2;
}

function formatElapsedSeconds(elapsedSeconds) {
  const elapsed = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  if (elapsed >= 3600) {
    return `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`;
  }
  if (elapsed >= 60) {
    return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  }
  return `${elapsed}s`;
}

function createRunDashboard({
  dbId,
  pollIntervalSec,
  getWatchPhase,
  getPollInfo,
  getLastPollTime,
  getWorkerStates,
  getExecStartTime,
  onPollNow,
  onGracefulExit,
  onImmediateExit,
  onInterrupt,
}) {
  const MAX_LOG_BUFFER = 200;
  const menuState = { menuIndex: 0 };
  const logBuffer = [];

  let altScreenActive = false;
  let cleanupMenuInput = null;
  let currentDashboardHeight = getRunDashboardHeight(getWatchPhase(), getWorkerStates());
  let cursorHidden = false;
  let gracefulShutdown = false;
  let logScroll = 0;
  let renderPending = false;
  let renderTimer = null;

  function getLogRows() {
    const rows = process.stdout.rows || 24;
    return Math.max(0, rows - currentDashboardHeight);
  }

  function getMaxLogScroll() {
    const logRows = getLogRows();
    return Math.max(0, logBuffer.length - logRows);
  }

  function syncViewport(clearScreen = false) {
    currentDashboardHeight = getRunDashboardHeight(getWatchPhase(), getWorkerStates());
    if (!altScreenActive) return;

    const rows = process.stdout.rows || 24;
    if (rows > currentDashboardHeight) {
      process.stdout.write(`\x1b[${currentDashboardHeight + 1};${rows}r`);
    }
    if (clearScreen) {
      process.stdout.write('\x1b[2J');
    }
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
      process.stdout.write(`\x1b[${currentDashboardHeight + 1 + i};1H`);
      process.stdout.write(`  ${line}\x1b[K`);
    }
    process.stdout.write('\x1b[1;1H');
  }

  function pushLog(name, msg) {
    const timestamp = new Date().toLocaleTimeString();
    const color = branchColor(name);
    const formatted = name && name !== 'SYSTEM'
      ? `${C.dim}[${timestamp}]${C.reset} ${color}[${name}]${C.reset} ${msg}`
      : `${C.dim}[${timestamp}]${C.reset} ${msg}`;
    logBuffer.push(formatted);
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
    if (logScroll > 0) {
      logScroll = Math.min(logScroll + 1, getMaxLogScroll());
    }
    appendLogToScreen(formatted);
  }

  function renderDashboard() {
    if (!altScreenActive) return;

    syncViewport(false);

    const lines = [];
    const width = 62;
    const watchPhase = getWatchPhase();
    const workerStates = getWorkerStates();
    const pollInfo = getPollInfo();
    const lastPollTime = getLastPollTime();
    const execStartTime = getExecStartTime();

    lines.push(`${C.dim}╔${'═'.repeat(width + 2)}╗${C.reset}`);

    if (watchPhase === 'executing' && workerStates.length > 0) {
      const activeCount = workerStates.filter((worker) => worker.status === 'running').length;
      lines.push(boxLine(`${SLEEPCODE_BADGE_WITH_VERSION}  ${C.cyan}⟳${C.reset} ${activeCount}/${workerStates.length} workers${notionLink(dbId)}`, width));
      lines.push(`${C.dim}╠${'═'.repeat(width + 2)}╣${C.reset}`);

      for (const worker of workerStates) {
        const bar = progressBar(worker.done, worker.total, 15);
        const statusIcon = worker.status === 'running'
          ? `${C.cyan}⟳${C.reset}`
          : worker.status === 'done'
            ? `${C.green}✓${C.reset}`
            : worker.status === 'budget_stop'
              ? `${C.yellow}■${C.reset}`
              : `${C.red}✗${C.reset}`;
        const percent = worker.total > 0 ? Math.round(worker.done / worker.total * 100) : 0;
        const model = worker.provider
          ? `${C.dim}[${providerLabelWithModel(worker.provider, worker.model)}]${C.reset} `
          : '';
        const difficulty = worker.difficultyLabel
          ? ` ${C.yellow}${worker.difficulty}${C.reset}`
          : '';
        lines.push(boxLine(`${statusIcon} ${C.bold}${padEndVisual(worker.name, 18)}${C.reset} ${bar} ${String(worker.done).padStart(2)}/${String(worker.total).padEnd(2)} ${C.cyan}${String(percent).padStart(3)}%${C.reset} ${model}${difficulty}`, width));
        if (worker.currentTask && worker.status === 'running') {
          lines.push(boxLine(`  ${C.dim}> ${clipVisualText(worker.currentTask, width - 6)}${C.reset}`, width));
        } else {
          lines.push(boxLine('', width));
        }
      }

      lines.push(`${C.dim}╠${'═'.repeat(width + 2)}╣${C.reset}`);

      const totalCost = workerStates.reduce((sum, worker) => sum + (worker.cost || 0), 0);
      const totalDone = workerStates.reduce((sum, worker) => sum + worker.done, 0);
      const totalTasks = workerStates.reduce((sum, worker) => sum + worker.total, 0);
      const totalPct = totalTasks > 0 ? Math.round(totalDone / totalTasks * 100) : 0;
      const elapsed = execStartTime ? Math.floor((Date.now() - execStartTime) / 1000) : 0;
      const remaining = lastPollTime
        ? Math.max(0, pollIntervalSec - Math.floor((Date.now() - lastPollTime) / 1000))
        : pollIntervalSec;
      lines.push(boxLine(`${C.dim}비용${C.reset} ${C.yellow}$${totalCost.toFixed(4)}${C.reset} ${C.dim}·${C.reset} ${C.dim}경과${C.reset} ${C.cyan}${formatElapsedSeconds(elapsed)}${C.reset} ${C.dim}·${C.reset} ${C.cyan}${totalPct}%${C.reset} ${C.dim}·${C.reset} ${C.dim}폴링${C.reset} ${remaining}초`, width));
    } else {
      const remaining = lastPollTime
        ? Math.max(0, pollIntervalSec - Math.floor((Date.now() - lastPollTime) / 1000))
        : pollIntervalSec;
      lines.push(boxLine(`${SLEEPCODE_BADGE_WITH_VERSION}  ${C.dim}◆${C.reset} 대기 중${notionLink(dbId)}`, width));
      lines.push(`${C.dim}╠${'═'.repeat(width + 2)}╣${C.reset}`);
      lines.push(boxLine(`${C.dim}전체${C.reset} ${pollInfo.total}  ${C.dim}·  대기${C.reset} ${C.cyan}${pollInfo.pending}${C.reset}`, width));
      lines.push(`${C.dim}╠${'═'.repeat(width + 2)}╣${C.reset}`);
      lines.push(boxLine(`${C.dim}다음 폴링${C.reset} ${C.cyan}${remaining}초${C.reset}`, width));
    }

    lines.push(`${C.dim}╚${'═'.repeat(width + 2)}╝${C.reset}`);

    if (gracefulShutdown) {
      lines.push(`  ${C.yellow}⏳ 마무리 중... 현재 작업 완료 후 종료됩니다${C.reset}`);
      menuState._menuLayout = null;
    } else {
      const menuRender = renderMenuLineWithLayout(menuState.menuIndex, width, menuState.confirmPending, menuState._menuItems);
      lines.push(menuRender.line);
      menuState._menuLayout = { row: lines.length, items: menuRender.items };
    }
    lines.push(`${C.dim} ══ ${C.reset}${C.cyan}logs${C.reset}${C.dim} ${'═'.repeat(width - 6)}${C.reset}`);

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

  function handleScroll(action) {
    const logRows = getLogRows();
    if (logRows <= 0) return false;

    const maxScroll = getMaxLogScroll();
    const page = Math.max(1, logRows - 1);
    let next = logScroll;
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
    syncViewport(true);
    renderDashboard();
    renderLogs(true);
  }

  function sigintHandler() {
    if (typeof onInterrupt === 'function') onInterrupt();
    dispose();
    console.log(`\n${C.yellow}run 종료${C.reset}`);
    process.exit(0);
  }

  function requestPollNow() {
    if (typeof onPollNow === 'function') onPollNow();
  }

  function requestGracefulExit() {
    if (gracefulShutdown) return;
    gracefulShutdown = true;
    pushLog('SYSTEM', `${C.yellow}마무리 후 종료 요청 — 현재 작업 완료 후 종료됩니다${C.reset}`);
    if (typeof onGracefulExit === 'function') onGracefulExit();
    renderDashboard();
  }

  function requestImmediateExit() {
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
      altScreenActive = true;
      syncViewport(false);
    }

    cleanupMenuInput = setupMenuInput(
      menuState,
      renderDashboard,
      [
        { label: '즉시 폴링', noConfirm: true, handler: requestPollNow },
        { label: '즉시 종료', handler: requestImmediateExit },
        { label: '마무리 후 종료', handler: requestGracefulExit },
      ],
      requestImmediateExit,
      handleScroll
    );

    process.stdout.on('resize', resizeHandler);
    process.on('SIGINT', sigintHandler);
    process.on('exit', cleanupAltScreen);

    renderDashboard();
    renderLogs(true);
  }

  function setWatchPhase() {
    syncViewport(true);
    renderDashboard();
    renderLogs(true);
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
    process.stdout.removeListener('resize', resizeHandler);
    process.removeListener('SIGINT', sigintHandler);
    process.removeListener('exit', cleanupAltScreen);
    cleanupAltScreen();
  }

  return {
    dispose,
    flushRender,
    isGracefulShutdown,
    pushLog,
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
