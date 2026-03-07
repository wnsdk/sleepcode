const { C, SLEEPCODE_BADGE, notionLink, branchColor } = require('./constants');
const { progressBar, visualWidth, padEndVisual } = require('./utils');
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
  const dashboardHeight = 11 + workerStates.length * 2;
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

    const lines = [];
    const width = 62;
    const totalTasks = workerStates.reduce((sum, worker) => sum + worker.total, 0);
    const totalDone = workerStates.reduce((sum, worker) => sum + worker.done, 0);
    const activeCount = workerStates.filter((worker) => worker.status === 'running').length;
    const totalCost = workerStates.reduce((sum, worker) => sum + worker.cost, 0);

    lines.push(`${C.dim}╔${'═'.repeat(width + 2)}╗${C.reset}`);
    lines.push(boxLine(`${SLEEPCODE_BADGE} parallel  ${C.dim}${activeCount}/${workerStates.length} workers${C.reset}${notionLink(process.env.NOTION_DB_ID)}`, width));
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
      const diffTag = worker.difficultyLabel ? ` ${C.yellow}${worker.difficulty}${C.reset}` : '';
      lines.push(boxLine(`${statusIcon} ${C.bold}${padEndVisual(worker.name, 18)}${C.reset} ${bar} ${String(worker.done).padStart(2)}/${String(worker.total).padEnd(2)} ${C.cyan}${String(percent).padStart(3)}%${C.reset}${diffTag}`, width));
      if (worker.currentTask && worker.status === 'running') {
        lines.push(boxLine(`  ${C.dim}> ${clipVisualText(worker.currentTask, width - 6)}${C.reset}`, width));
      } else {
        lines.push(boxLine('', width));
      }
    }

    lines.push(`${C.dim}╠${'═'.repeat(width + 2)}╣${C.reset}`);
    const costStr = `$${totalCost.toFixed(4)}`;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = elapsed >= 3600
      ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
      : elapsed >= 60
        ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
        : `${elapsed}s`;
    const totalPct = totalTasks > 0 ? Math.round(totalDone / totalTasks * 100) : 0;
    lines.push(boxLine(`${C.dim}비용${C.reset} ${C.yellow}${costStr}${C.reset}  ${C.dim}·  경과${C.reset} ${C.cyan}${elapsedStr}${C.reset}  ${C.dim}·  진행${C.reset} ${totalDone}/${totalTasks} ${C.cyan}${totalPct}%${C.reset}`, width));

    const budgetInfo = getBudgetInfo(targetDir);
    if (budgetInfo) {
      const pct = Math.min(100, (budgetInfo.total / budgetInfo.budget * 100)).toFixed(0);
      const budgetBar = progressBar(Math.min(budgetInfo.total, budgetInfo.budget), budgetInfo.budget, 10);
      const warn = budgetInfo.over ? ` ${C.red}한도 도달!${C.reset}` : '';
      lines.push(boxLine(`${C.dim}주간${C.reset} ${C.yellow}$${budgetInfo.total.toFixed(2)}${C.reset}/${C.dim}$${budgetInfo.budget}${C.reset} (${pct}%) ${budgetBar}${warn}`, width));
    } else {
      lines.push(boxLine('', width));
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
  clipVisualText,
  createParallelDashboard,
  getCompletionNextSteps,
  summarizeWorkerOutcomes,
};
