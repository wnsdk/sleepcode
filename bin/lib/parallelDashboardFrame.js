const { C, SLEEPCODE_BADGE, notionLink } = require('./constants');
const { progressBar, padEndVisual } = require('./utils');
const { boxLine, renderMenuLineWithLayout } = require('./dashboard');
const { clipVisualText, formatElapsedSeconds } = require('./dashboardUtils');

function getParallelDashboardHeight(workerStates) {
  return 11 + workerStates.length * 2;
}

function buildParallelDashboardFrame({
  workerStates,
  budgetInfo,
  gracefulShutdown,
  menuState,
  startTime,
  width = 62,
  notionDbId = process.env.NOTION_DB_ID,
  now = Date.now,
  renderMenuLineWithLayoutFn = renderMenuLineWithLayout,
}) {
  const lines = [];
  const totalTasks = workerStates.reduce((sum, worker) => sum + worker.total, 0);
  const totalDone = workerStates.reduce((sum, worker) => sum + worker.done, 0);
  const activeCount = workerStates.filter((worker) => worker.status === 'running').length;
  const totalCost = workerStates.reduce((sum, worker) => sum + worker.cost, 0);

  lines.push(`${C.dim}╔${'═'.repeat(width + 2)}╗${C.reset}`);
  lines.push(boxLine(`${SLEEPCODE_BADGE} parallel  ${C.dim}${activeCount}/${workerStates.length} workers${C.reset}${notionLink(notionDbId)}`, width));
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
  const totalPct = totalTasks > 0 ? Math.round(totalDone / totalTasks * 100) : 0;
  const elapsed = Math.floor((now() - startTime) / 1000);
  lines.push(boxLine(`${C.dim}비용${C.reset} ${C.yellow}$${totalCost.toFixed(4)}${C.reset}  ${C.dim}·  경과${C.reset} ${C.cyan}${formatElapsedSeconds(elapsed)}${C.reset}  ${C.dim}·  진행${C.reset} ${totalDone}/${totalTasks} ${C.cyan}${totalPct}%${C.reset}`, width));

  if (budgetInfo) {
    const pct = Math.min(100, (budgetInfo.total / budgetInfo.budget * 100)).toFixed(0);
    const budgetBar = progressBar(Math.min(budgetInfo.total, budgetInfo.budget), budgetInfo.budget, 10);
    const warn = budgetInfo.over ? ` ${C.red}한도 도달!${C.reset}` : '';
    lines.push(boxLine(`${C.dim}주간${C.reset} ${C.yellow}$${budgetInfo.total.toFixed(2)}${C.reset}/${C.dim}$${budgetInfo.budget}${C.reset} (${pct}%) ${budgetBar}${warn}`, width));
  } else {
    lines.push(boxLine('', width));
  }

  lines.push(`${C.dim}╚${'═'.repeat(width + 2)}╝${C.reset}`);

  let menuLayout = null;
  if (gracefulShutdown) {
    lines.push(`  ${C.yellow}⏳ 마무리 중... 현재 작업 완료 후 종료됩니다${C.reset}`);
  } else {
    const menuRender = renderMenuLineWithLayoutFn(
      menuState.menuIndex,
      width,
      menuState.confirmPending,
      menuState._menuItems
    );
    lines.push(menuRender.line);
    menuLayout = { row: lines.length, items: menuRender.items };
  }
  lines.push(`${C.dim} ══ ${C.reset}${C.cyan}logs${C.reset}${C.dim} ${'═'.repeat(width - 6)}${C.reset}`);

  return {
    lines,
    menuLayout,
  };
}

module.exports = {
  buildParallelDashboardFrame,
  clipVisualText,
  formatElapsedSeconds,
  getParallelDashboardHeight,
};
